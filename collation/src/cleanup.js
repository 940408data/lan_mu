/**
 * collation · P1.5 双本清洗（src/cleanup.js）
 *
 * 原始 OCR 永不改写。每页按可解释规则拆成正文流与旁文本流：
 * body / section_heading / annotation 进入后续对校；脚注、校记、页眉、页码、
 * 封面等另存审计记录。无 bbox 的旧 Markdown 以页码+行号降级溯源。
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { loadWork } = require('./io');
const { loadM2Base } = require('./base');

const BODY_KINDS = new Set(['body', 'section_heading', 'annotation']);
const FOOTNOTE_REF = /\$\s*\^\s*\{?\s*([\d①-⑳]+)\s*\}?\s*\$|\^\{\s*([\d①-⑳]+)\s*\}/g;
const FOOTNOTE_LINE = /^[①-⑳]/;
const PAGE_NUMBER = /^(?:第?[一二三四五六七八九十百千〇零两兩\d]+頁|[—–-]?\d{1,4}[—–-]?)$/;
const APPARATUS_EDITION = /(?:司禮監本|[吴吳]本|元甲本|仿元本|他本|諸本|各本)/;
const APPARATUS_ACTION = /(?:本作|本有|本無|有「[^」]*」字|無「[^」]*」字|據.+(?:改|補)|原(?:作|脫|奪)|校改)/;
const LATEX_LEFTOVER = /\$|\^\{\s*[\d①-⑳]+\s*\}/;
// 现代整理本页末常附刊记/校正署名，不属于正文；需在对齐前整体剥离。
const COLOPHON_LINE = /(?:章句畢$|從政郎.*校正)/;

function hash(text) {
  return crypto.createHash('sha256').update(text || '', 'utf8').digest('hex');
}

function compact(text) {
  return (text || '').replace(/\s+/g, '');
}

function makeContext(work) {
  const title = compact(work.title || '');
  const core = title.replace(/章句|集注/g, '');
  const headings = new Set([
    title,
    `${title}序`,
    `${core}章句序`,
  ].filter(Boolean));
  return { title, core, headings, seenHeadings: new Set(), seenCoreHeading: false };
}

function sourceOf(lineNo) {
  return { lines: [lineNo], bbox: null };
}

function addRegion(page, state, attrs) {
  const region = {
    id: `p${page.page}-r${String(++state.regionNo).padStart(3, '0')}`,
    kind: attrs.kind,
    text: attrs.text,
    readingOrder: ++state.readingOrder,
    source: sourceOf(attrs.lineNo),
    confidence: attrs.confidence,
    rule: attrs.rule,
  };
  if (attrs.sourceText != null && attrs.sourceText !== attrs.text) region.sourceText = attrs.sourceText;
  if (attrs.ref != null) region.ref = attrs.ref;
  page.regions.push(region);
  if (!BODY_KINDS.has(region.kind)) page.excluded.push(region);
  return region;
}

function splitInlineApparatus(text) {
  // 仅处理带明确版本名且位于行尾的校记；“程子曰……當作……”属于原注，不动。
  const marks = ['，', '；'];
  for (let i = text.length - 1; i >= 0; i--) {
    if (!marks.includes(text[i])) continue;
    const tail = text.slice(i + 1).trim();
    if (APPARATUS_EDITION.test(tail) && APPARATUS_ACTION.test(tail)) {
      return { body: text.slice(0, i).trimEnd(), note: tail };
    }
  }
  return { body: text, note: '' };
}

function stripFootnoteRefs(text) {
  const refs = [];
  const clean = text.replace(FOOTNOTE_REF, (_m, a, b) => {
    refs.push(a || b);
    return '';
  }).replace(/[ \t]{2,}/g, ' ');
  return { text: clean, refs };
}

function cleanPage(pg, ed, ctx) {
  const page = {
    page: pg.n,
    sourceHash: hash(pg.raw != null ? pg.raw : pg.lines.join('\n')),
    regions: [],
    excluded: [],
    bodyText: '',
  };
  const state = { regionNo: 0, readingOrder: 0 };
  const lines = pg.lines.map(s => s.trim()).filter(Boolean);
  const whole = compact(lines.join(''));

  if (pg.isCover || (ed.role === 'shanben' && lines.length <= 2 && whole.length <= 12 && /宋本|章句全?$/.test(whole))) {
    lines.forEach((text, i) => addRegion(page, state, {
      kind: 'cover', text, lineNo: i + 1, confidence: 1, rule: 'explicit-cover',
    }));
    return page;
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const lineNo = i + 1;
    const next = lines[i + 1];

    // 仅在现代本页末识别刊记，避免正文中的普通“校正”语句被误删。
    if (ed.role === 'xiandai' && i >= lines.length - 3 && COLOPHON_LINE.test(compact(raw))) {
      addRegion(page, state, {
        kind: 'colophon', text: raw, lineNo, confidence: 0.99, rule: 'tail-colophon',
      });
      continue;
    }

    // 版心书题被 OCR 拆成“大”/“學”两行。
    if (next && compact(raw).length === 1 && compact(next).length === 1 && compact(raw + next) === ctx.core) {
      const afterPair = lines[i + 2] || '';
      const structural = !ctx.seenCoreHeading && i === 0 && new RegExp(`^${compact(raw)}[，,]`).test(compact(afterPair));
      if (structural) ctx.seenCoreHeading = true;
      addRegion(page, state, {
        kind: structural ? 'section_heading' : 'running_head',
        text: raw + next,
        sourceText: `${raw}\n${next}`,
        lineNo,
        confidence: 1,
        rule: structural ? 'split-structural-heading' : 'split-running-head',
      });
      i++;
      continue;
    }

    const c = compact(raw);
    if (c === ctx.core && ctx.core.length <= 4) {
      addRegion(page, state, {
        kind: 'running_head', text: raw, lineNo, confidence: 0.99, rule: 'isolated-book-core',
      });
      continue;
    }

    if (ctx.headings.has(c)) {
      const first = !ctx.seenHeadings.has(c);
      ctx.seenHeadings.add(c);
      addRegion(page, state, {
        kind: first ? 'section_heading' : 'running_head', text: raw, lineNo,
        confidence: 0.99, rule: first ? 'first-structural-heading' : 'repeated-running-head',
      });
      continue;
    }

    if (FOOTNOTE_LINE.test(raw)) {
      addRegion(page, state, {
        kind: 'footnote', text: raw, lineNo, confidence: 1, rule: 'numbered-footnote-line',
      });
      continue;
    }

    if ((i === 0 || i === lines.length - 1) && PAGE_NUMBER.test(c)) {
      addRegion(page, state, {
        kind: 'page_number', text: raw, lineNo, confidence: 0.98, rule: 'edge-page-number',
      });
      continue;
    }

    if (APPARATUS_EDITION.test(raw) && APPARATUS_ACTION.test(raw) && raw.length <= 120 && /^[「『①-⑳]|^原/.test(raw)) {
      addRegion(page, state, {
        kind: 'collation_note', text: raw, lineNo, confidence: 0.98, rule: 'standalone-edition-apparatus',
      });
      continue;
    }

    const refResult = stripFootnoteRefs(raw);
    for (const ref of refResult.refs) addRegion(page, state, {
      kind: 'footnote_ref', text: ref, sourceText: raw, lineNo, ref,
      confidence: 1, rule: 'latex-footnote-ref',
    });

    const inline = splitInlineApparatus(refResult.text);
    if (inline.body.trim()) addRegion(page, state, {
      kind: inline.body.trimStart().startsWith('○') ? 'annotation' : 'body',
      text: inline.body.trim(), sourceText: raw, lineNo, confidence: 1, rule: 'body-line',
    });
    if (inline.note) addRegion(page, state, {
      kind: 'collation_note', text: inline.note, sourceText: raw, lineNo,
      confidence: 0.98, rule: 'inline-edition-apparatus',
    });
  }

  page.bodyText = page.regions
    .filter(r => BODY_KINDS.has(r.kind))
    .sort((a, b) => a.readingOrder - b.readingOrder)
    .map(r => r.text)
    .join('\n');
  return page;
}

function qualityOf(pages, ctx) {
  const bodyText = pages.map(p => p.bodyText).filter(Boolean).join('\n\n');
  const bodyLines = bodyText.split(/\r?\n/).map(compact).filter(Boolean);
  const latex = bodyLines.filter(x => LATEX_LEFTOVER.test(x));
  const isolatedTitle = pages.flatMap(p => p.regions)
    .filter(r => (r.kind === 'body' || r.kind === 'annotation') && compact(r.text) === ctx.core);
  const unknown = pages.flatMap(p => p.regions).filter(r => r.kind === 'unknown');
  const blockers = [];
  if (latex.length) blockers.push(`正文仍有 ${latex.length} 处脚注/LaTex 标记`);
  if (isolatedTitle.length) blockers.push(`正文仍有 ${isolatedTitle.length} 处孤立书题`);
  if (unknown.length) blockers.push(`尚有 ${unknown.length} 个 unknown 区域`);
  return { publishable: blockers.length === 0, blockers, latexLeftovers: latex.length, isolatedTitles: isolatedTitle.length, unknown: unknown.length };
}

function cleanEdition(ed, work) {
  const ctx = makeContext(work);
  const pages = ed.pages.map(pg => cleanPage(pg, ed, ctx));
  const regions = pages.flatMap(p => p.regions);
  const byKind = {};
  for (const r of regions) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
  const bodyText = pages.map(p => p.bodyText).filter(Boolean).join('\n\n');
  return {
    schemaVersion: 1,
    work: work.id,
    edition: ed.id,
    role: ed.role,
    level: ed.level,
    source: ed.source || 'ocr-markdown',
    m2: ed.m2 || null,
    pages,
    bodyText,
    stats: {
      pages: pages.length,
      regions: regions.length,
      bodyChars: compact(bodyText).length,
      excluded: pages.reduce((n, p) => n + p.excluded.length, 0),
      byKind,
    },
    quality: qualityOf(pages, ctx),
  };
}

function shanbenV2Edition(workId, fallback, m2 = loadM2Base(workId)) {
  const data = m2.data;
  return {
    ...fallback,
    source: `shanben-v2:${data.source || 'unknown'}`,
    m2: {
      // 公开产物不写入 worktree 绝对路径，保留仓库内可复核的相对定位。
      file: `collation/data/${workId}/shanben-v2.json`,
      source: m2.source,
      stats: m2.stats,
      pendingFile: `collation/data/${workId}/pending-verify.json`,
      pendingCount: m2.pendingCount,
      sha256: m2.sha256,
    },
    pages: data.pages.map(p => ({
      n: p.n,
      lines: [p.text],
      raw: p.text,
      isCover: p.n === 1 && p.text.length <= 12 && /宋本|章句全?$/.test(p.text),
    })),
  };
}

function cleanWork(workId) {
  const loaded = loadWork(workId);
  const m2 = loadM2Base(workId);
  const shanben = shanbenV2Edition(workId, loaded.shanben, m2);
  return {
    work: loaded.work,
    shanben: cleanEdition(shanben, loaded.work),
    xiandai: cleanEdition(loaded.xiandai, loaded.work),
  };
}

function publicSummary(cleaned) {
  return {
    schemaVersion: cleaned.shanben.schemaVersion,
    work: cleaned.work.id,
    shanben: {
      source: cleaned.shanben.source,
      stats: cleaned.shanben.stats,
      quality: cleaned.shanben.quality,
      m2: cleaned.shanben.m2 ? {
        source: cleaned.shanben.m2.source,
        sha256: cleaned.shanben.m2.sha256,
        pendingVerify: cleaned.shanben.m2.pendingCount,
      } : null,
    },
    xiandai: { source: cleaned.xiandai.source, stats: cleaned.xiandai.stats, quality: cleaned.xiandai.quality },
  };
}

module.exports = {
  BODY_KINDS,
  cleanEdition,
  cleanWork,
  publicSummary,
  splitInlineApparatus,
  stripFootnoteRefs,
};
