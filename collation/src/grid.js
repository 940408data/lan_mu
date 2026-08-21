/**
 * collation · G2/G3 网格基模块（src/grid.js）
 *
 * 基础层 = grid-transcribe.json（视觉逐格，规范不变）；本模块旁挂 overlay：
 *   G2a 旧OCR（shanben-v2 页文字流）→ 逐格：页级编辑对齐（页码一一对应）
 *   G2b 现代点校本（儒藏本_ocr）→ 逐格：预清洗（LaTeX/页眉/校记/页码）后，
 *       章题硬锚 + n-gram 软锚分段，全书流编辑对齐（页码不对应）
 *   G3  标签：start→j/z（复用 transcribe.colsOfPage 列规则）+ 章题/尾题锚→
 *       sections 与 title/preface/colophon
 *
 * 参校层只记差异（variants），不改基础层；fixes 恒为空（G4 未实施，
 * 改字必须走裁决通道，见 docs/网格基流程重构方案.md §4.1）。
 *
 * 输入不含现代本连续文本入库：overlay.variants 只存逐字意见与差异片段。
 */
'use strict';
const crypto = require('crypto');
const path = require('path');
const { normChar } = require('./align');
const { colsOfPage } = require('./transcribe');

// ── 归一化（仅供对齐比较，不改任何源字）──
const STRIP = /[，。！？；：、""''「」『』《》〈〉（）〔〕○〇①-⑩·—…\s？！↑↓]/g;
const canonCh = (ch) => normChar(ch);
const canon = (s) => [...s.replace(STRIP, '')].map(normChar).join('');

// ── 章题锚（大学：右經一章/右傳之X章；中庸：右第X章 收束式）──
const CHAPTER_RE = /右(經一章|傳之[首一二三四五六七八九十]+章|第[一二三四五六七八九十百]+章)/g;
const PREFACE_END_RE = /淳熙[己已]酉[^\s]{0,14}新安朱熹序/; // 序尾锚（收束序节；容错视觉误识 己→已）

// ── 锚规则派生：works.anchors 登记优先（登记式适配），未登记回落双书默认（右X章收束式）──
//  登记例（editions.yaml）：
//    anchors: { mode: pian, pianNames: [學而, 爲政, …] }  # 篇题开节式（论语：學而第一/爲政第二…）
//  篇名登记可写原刻异体（如「爲」）；匹配目标为归一格串（canon 后），
//  故每个篇名生成「原字形｜归一字形」双写 alternation（如 爲政｜為政）。
function deriveAnchors(work) {
  const a = (work && work.anchors) || {};
  if (a.mode === 'pian' && Array.isArray(a.pianNames) && a.pianNames.length) {
    const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const names = a.pianNames.map(n => {
      const c = [...String(n)].map(canonCh).join('');
      return String(n) === c ? esc(n) : `${esc(n)}|${esc(c)}`;
    }).join('|');
    // 《孟子》篇题是「公孫丑章句上」式完整标题，不带《论语》的「第X」后缀。
    // 保留 pian 模式以复用 G3 开节逻辑；含「章句」时按完整篇题匹配。
    const chapterSuffix = a.pianNames.some(n => /章句[上下]$/.test(String(n)))
      ? ''
      : '第[一二三四五六七八九十百]+';
    return { mode: 'pian', chapterRE: new RegExp(`(${names})${chapterSuffix}`, 'g'), prefaceEndRE: null };
  }
  return { mode: 'you', chapterRE: CHAPTER_RE, prefaceEndRE: PREFACE_END_RE };
}

// ── 编辑对齐 a(参校) × b(格串) → ops[{t,a,b,ai,bi}] ──
function editOps(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    dp[i][j] = Math.min(dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), dp[i - 1][j] + 1, dp[i][j - 1] + 1);
  const ops = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      ops.push({ t: a[i - 1] === b[j - 1] ? '=' : 'sub', a: a[i - 1], b: b[j - 1], ai: i - 1, bi: j - 1 }); i--; j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      ops.push({ t: 'ins', a: a[i - 1], b: null, ai: i - 1, bi: j }); i--;
    } else {
      ops.push({ t: 'del', a: null, b: b[j - 1], ai: i, bi: j - 1 }); j--;
    }
  }
  return ops.reverse();
}

// ── 基础层装载：grid-transcribe.json → 扁平格序列（col 升序、列内 row 升序）──
// gridStr 为归一串（供对齐），strIdx[k] = gridStr 第 k 字对应的 flat 格下标。
// ○ 等符号格不进 gridStr，但保留在 flat 里（索引映射不断裂，坐标永远可回溯）。
// 重复叶排除（layout.json specialPages kind=dupPage）：影印本同版面重复拍摄，
// 基础层照录两份；装载时按登记跳过副本（不改基础层文件本身，铁律不破）。
const STRIP_ONE = new RegExp(STRIP.source); // 无 g 标志：单字 test 安全
const stripCh = (ch) => STRIP_ONE.test(ch);
function loadBaseGrid(tr, dataDir) {
  const skip = new Set();
  try {
    const lay = JSON.parse(require('fs').readFileSync(path.join(dataDir || path.join(__dirname, '..', 'data', tr.work || ''), 'layout.json'), 'utf8'));
    for (const sp of lay.specialPages || []) if (sp.kind === 'dupPage') for (const n of sp.pages || []) skip.add(n);
  } catch {}
  const pages = (tr.pages || []).filter(pg => !skip.has(pg.n)).map(pg => ({
    n: pg.n,
    cells: (pg.cells || [])
      .slice().sort((x, y) => x.col - y.col || x.row - y.row)
      .filter(c => (c.char || '').trim().length > 0)
      .map(c => ({ page: pg.n, col: c.col, row: c.row, char: [...c.char.trim()][0], start: c.start || null })),
  }));
  const flat = pages.flatMap(p => p.cells);
  let gridStr = '';
  const strIdx = [];
  flat.forEach((c, i) => {
    if (stripCh(c.char)) return;
    gridStr += canonCh(c.char);
    strIdx.push(i);
  });
  return { tr, pages, flat, gridStr, strIdx, cellOf: (k) => flat[strIdx[k]] };
}

// ── G2a：旧OCR（shanben-v2 页文字流）→ 逐格（页级） ──
function alignOldOcr(base, v2) {
  const v2Map = new Map((v2.pages || []).map(p => [p.n, p.text]));
  const r = { agree: 0, sub: [], missing: [], extra: [] };
  let cellOff = 0;
  for (const pg of base.pages) {
    const cells = pg.cells;
    const old = v2Map.get(pg.n);
    // 页内归一串与 cells 的索引映射（○ 等符号格不进串）
    let bCanon = '';
    const bIdx = [];
    cells.forEach((c, i) => {
      if (stripCh(c.char)) return;
      bCanon += canonCh(c.char);
      bIdx.push(i);
    });
    if (!old) { r.missing.push({ page: pg.n, after: cells[0] ? { col: cells[0].col, row: cells[0].row } : null, text: '(shanben-v2 缺页)', whole: true }); cellOff += cells.length; continue; }
    const aCanon = canon(old);
    // 双向索引：aCanon[k] ↔ old 原字序（canon 过滤后需重放原字）
    const aOrig = [...old.replace(STRIP, '')];
    if (aOrig.length !== aCanon.length) throw new Error(`p${pg.n} canon 长度不一致（内部错误）`);
    const ops = editOps(aCanon, bCanon);
    const runs = { insStart: -1, insTxt: '' };
    const flushIns = (atBi) => {
      if (runs.insStart >= 0) {
        const after = atBi > 0 ? cells[bIdx[atBi - 1]] : null;
        r.missing.push({ page: pg.n, after: after ? { col: after.col, row: after.row } : null, text: runs.insTxt });
        runs.insStart = -1; runs.insTxt = '';
      }
    };
    for (const op of ops) {
      if (op.t === '=') { flushIns(op.bi); r.agree++; }
      else if (op.t === 'sub') {
        flushIns(op.bi);
        const cell = cells[bIdx[op.bi]];
        r.sub.push({
          page: pg.n, col: cell.col, row: cell.row, grid: cell.char, old: aOrig[op.ai],
          ctxSb: bCanon.slice(Math.max(0, op.bi - 10), op.bi) + '【' + cell.char + '】' + bCanon.slice(op.bi + 1, op.bi + 11),
          ctxOld: aCanon.slice(Math.max(0, op.ai - 10), op.ai) + '【' + aOrig[op.ai] + '】' + aCanon.slice(op.ai + 1, op.ai + 11),
        });
      } else if (op.t === 'ins') {
        if (runs.insStart < 0) { runs.insStart = op.bi; runs.insTxt = ''; }
        runs.insTxt += aOrig[op.ai];
      } else { // del：格有旧无
        flushIns(op.bi);
        const cell = cells[bIdx[op.bi]];
        r.extra.push({ page: pg.n, col: cell.col, row: cell.row, grid: cell.char });
      }
    }
    flushIns(cells.length);
    cellOff += cells.length;
  }
  return r;
}

// ── G2b 预清洗：LaTeX / 页眉 / 校记 / 页码（剥除内容全部留痕） ──
function precleanModern(lines, ctx) {
  const excluded = [];
  const counts = new Map();
  const compacted = lines.map(l => l.trim()).filter(Boolean);
  for (const l of compacted) {
    const c = l.replace(STRIP, '').replace(/\d+/g, '');
    if (c) counts.set(c, (counts.get(c) || 0) + 1);
  }
  const out = [];
  const seenHeading = new Set(); // 首现保留（首行常为真章题/序题，与页眉同名）
  for (const raw of compacted) {
    let line = raw;
    // ① LaTeX 脚注标记（行内剥除）
    const before = line;
    line = line.replace(/\$\^?\{?[\d①-⑳\s]*\}?\$?/g, '').replace(/\^\{\s*[\d①-⑳]+\s*\}/g, '').trim();
    if (line !== before) excluded.push({ kind: 'latex', text: before });
    if (!line) continue;
    const c = line.replace(STRIP, '').replace(/\d+/g, '');
    // ② 页眉：短行（≤12 字符）且重复出现 ≥2 次；首现保留（防误剥首行真章题）
    if ([...c].length <= 12 && !/[。！？]$/.test(line) && counts.get(c) >= 2) {
      const first = !seenHeading.has(c);
      seenHeading.add(c);
      if (first) excluded.push({ kind: 'heading-first-kept', text: line }); // 留痕但保留
      else if (ctx.headings.has(c) || counts.get(c) > 2) { excluded.push({ kind: 'running-head', text: line }); continue; }
    }
    // ③ 校记：脚注序号开头，或含版本对校用语
    if (/^[①-⑳]/.test(line) || (/司禮監本|監本|吳本|吴本/.test(line) && [...c].length <= 60)) {
      excluded.push({ kind: 'collation-note', text: line });
      continue;
    }
    // ④ 页码 / 刊记署名行 / 卷尾题（論語卷第一 等，分卷书儒藏本每卷末行）
    if (/^\d+$/.test(line) || /從政郎.*校正|章句畢$/.test(line) || /^.{0,8}卷第[一二三四五六七八九十百]+$/.test(line)) {
      excluded.push({ kind: /^[\d]+$/.test(line) ? 'page-number' : 'colophon', text: line });
      continue;
    }
    // ⑤ 行内括注校记〔…本作…〕剥除
    const inline = line.replace(/〔[^〕]*(?:本作|作)[^〕]*〕/g, '');
    if (inline !== line) excluded.push({ kind: 'inline-note', text: line.slice(inline.length ? line.indexOf('〔') : 0) });
    out.push(inline);
  }
  return { lines: out, excluded };
}

// ── G2b：现代本全书流 → 逐格（章题硬锚 + n-gram 软锚分段）──
function alignModern(base, modernRaw, ctx) {
  const pre = precleanModern(modernRaw.split(/\r?\n/), ctx);
  const modern = canon(pre.lines.join('\n'));
  const W = 14, MIN_GAP = 150;
  const chapterRE = ctx.chapterRE || CHAPTER_RE;

  // 硬锚：两侧章题序列
  const hard = [];
  const mChapters = [...modern.matchAll(chapterRE)];
  const gChapters = [...base.gridStr.matchAll(chapterRE)];
  if (mChapters.length && mChapters.length === gChapters.length) {
    for (let k = 0; k < mChapters.length; k++)
      hard.push({ ai: mChapters[k].index, bi: gChapters[k].index, key: mChapters[k][0], kind: 'chapter' });
  }
  // 软锚：格串 n-gram 在 modern 中唯一命中
  const soft = [];
  let lastB = -Infinity;
  for (let bi = 0; bi + W <= base.gridStr.length; bi += 7) {
    const key = base.gridStr.slice(bi, bi + W);
    const first = modern.indexOf(key);
    if (first >= 0 && modern.indexOf(key, first + 1) < 0 && bi - lastB >= MIN_GAP) {
      soft.push({ ai: first, bi, key, kind: 'ngram' }); lastB = bi;
    }
  }
  // 合并 + 单调化
  const all = [...hard, ...soft].sort((x, y) => x.bi - y.bi);
  const anchors = [];
  let lastA = -1, lastB2 = -1;
  for (const a of all) {
    if (a.bi > lastB2 && a.ai > lastA) { anchors.push(a); lastB2 = a.bi; lastA = a.ai; }
  }
  // 分段
  const segs = [];
  let pB = 0, pA = 0;
  for (const a of anchors) { segs.push({ b0: pB, b1: a.bi, a0: pA, a1: a.ai }); pB = a.bi; pA = a.ai; }
  segs.push({ b0: pB, b1: base.gridStr.length, a0: pA, a1: modern.length });

  const r = { agree: 0, sub: [], missing: [], extra: [], preclean: pre.excluded, anchors: { hard: hard.length, soft: soft.length, kept: anchors.length, segs: segs.length }, unanchoredSegs: segs.filter(s => s.b1 - s.b0 > 2000).length };
  for (const s of segs) {
    const a = modern.slice(s.a0, s.a1), b = base.gridStr.slice(s.b0, s.b1);
    if (!a.length && !b.length) continue;
    const ops = editOps(a, b);
    let runStart = -1, runTxt = '';
    const flush = (atBi) => {
      if (runStart >= 0) {
        const cellBefore = atBi > 0 ? base.cellOf(s.b0 + atBi - 1) : (s.b0 > 0 ? base.cellOf(s.b0 - 1) : null);
        r.missing.push({ page: cellBefore ? cellBefore.page : null, after: cellBefore ? { col: cellBefore.col, row: cellBefore.row } : null, text: runTxt });
        runStart = -1; runTxt = '';
      }
    };
    for (const op of ops) {
      if (op.t === '=') { flush(op.bi); r.agree++; }
      else if (op.t === 'sub') {
        flush(op.bi);
        const cell = base.cellOf(s.b0 + op.bi);
        r.sub.push({
          page: cell.page, col: cell.col, row: cell.row, grid: cell.char, modern: a[op.ai],
          ctxSb: b.slice(Math.max(0, op.bi - 10), op.bi) + '【' + cell.char + '】' + b.slice(op.bi + 1, op.bi + 11),
          ctxXd: a.slice(Math.max(0, op.ai - 10), op.ai) + '【' + a[op.ai] + '】' + a.slice(op.ai + 1, op.ai + 11),
        });
      } else if (op.t === 'ins') {
        if (runStart < 0) { runStart = op.bi; runTxt = ''; }
        runTxt += a[op.ai];
      } else {
        flush(op.bi);
        const cell = base.cellOf(s.b0 + op.bi);
        r.extra.push({ page: cell.page, col: cell.col, row: cell.row, grid: cell.char });
      }
    }
    flush(b.length);
  }
  return r;
}

// ── G3：标签（列级 j/z + 章题 title + sections）──
function labelGrid(base, modernAligned, anchors) {
  anchors = anchors || { mode: 'you', chapterRE: CHAPTER_RE, prefaceEndRE: PREFACE_END_RE };
  // 1) 章题格坐标：格串中的章题锚 → flat 索引区间（经 strIdx 映射）
  const chapterCells = [];
  for (const m of base.gridStr.matchAll(anchors.chapterRE)) {
    const from = base.cellOf(m.index), to = base.cellOf(m.index + m[0].length - 1);
    chapterCells.push({ text: m[0], raw: m[0], fromIdx: m.index, toIdx: m.index + m[0].length - 1, from: { page: from.page, col: from.col, row: from.row }, to: { page: to.page, col: to.col, row: to.row } });
  }
  // 2) 列级 j/z（复用 colsOfPage：start 頂格=j）
  const labels = [];
  const colRoles = new Map(); // "p:c" -> j|z
  for (const pg of base.pages) {
    for (const col of colsOfPage({ cells: pg.cells.map(c => ({ ...c, char: c.char, start: c.start })) })) {
      colRoles.set(`${pg.n}:${col.col}`, col.type);
      labels.push({ page: pg.n, col: col.col, role: col.type, text: col.text });
    }
  }
  // 3) 章题列覆盖为 title
  for (const ch of chapterCells) {
    for (let p = ch.from.page; p <= ch.to.page; p++) {
      const c0 = p === ch.from.page ? ch.from.col : 1;
      const c1 = p === ch.to.page ? ch.to.col : 16;
      for (let c = c0; c <= c1; c++) {
        const k = `${p}:${c}`;
        if (colRoles.has(k)) { colRoles.set(k, 'title'); const lab = labels.find(l => l.page === p && l.col === c); if (lab) lab.role = 'title'; }
      }
    }
  }
  // 4) sections：双模式——收束式（右X章，双书）与篇题开节式（论语：篇题锚处开节）
  //    收束式：锚 k 收束其前正文；新节名 = 下一锚章名去「右」；序尾锚收束 xu。
  //    开节式：篇题锚即节起点（锚块=title 列，G5 skip）；锚前内容（卷题/撰人）不入节。
  //    大学：[xu, jing:經一章, zhuan1:傳之首章..zhuan10:傳之十章]
  //    中庸：[xu, zhang1:首章, zhang2:第二章..zhang33:第三十三章]
  //    论语：[pian1:學而第一, pian2:爲政第二, …]（锚前卷題不入节）
  const sections = [];
  const endAt = (idx) => {
    const k = Math.max(0, Math.min(base.gridStr.length - 1, idx));
    const c = base.cellOf(k);
    return { page: c.page, col: c.col, row: c.row };
  };
  if (anchors.mode === 'pian') {
    chapterCells.forEach((ch, k) => {
      const toIdx = k + 1 < chapterCells.length ? chapterCells[k + 1].fromIdx - 1 : base.gridStr.length - 1;
      if (ch.fromIdx > toIdx) return;
      sections.push({ id: 'pian' + (k + 1), name: ch.text, from: endAt(ch.fromIdx), to: endAt(toIdx) });
    });
    return { labels, sections, chapterCells, zhongyongMode: false, anchorMode: 'pian' };
  }
  let zhongyongMode = chapterCells.some(ch => /右第.+章/.test(ch.text));
  // 边界点（格串索引 + 在此处并始的新节元数据）
  const bounds = [];
  if (chapterCells.length) bounds.push({ idx: -1, sec: { id: 'xu', name: '序' } }); // -1 = 格串头
  const prefEnd = anchors.prefaceEndRE ? base.gridStr.search(anchors.prefaceEndRE) : -1;
  const prefEndTo = prefEnd >= 0 && anchors.prefaceEndRE ? prefEnd + anchors.prefaceEndRE.exec(base.gridStr)[0].length - 1 : -1;
  if (prefEndTo >= 0) {
    bounds.push({ idx: prefEndTo, sec: zhongyongMode ? { id: 'zhang1', name: '首章' } : { id: 'jing', name: '經一章' } });
  }
  chapterCells.forEach((ch, k) => {
    const isLast = k === chapterCells.length - 1;
    if (isLast) return; // 尾锚不开节，其 to 即尾节终点
    if (k === 0 && prefEndTo < 0) return; // 无序尾锚时首锚仅作边界（退化，不重复开节）
    // 收束式：锚 k 收束其前正文；锚 k.to 处开的新节由下一锚（k+1）收束，
    // 故新节名 = 下一锚章名去「右」（大学 傳之首章…；中庸 第二章…），两书同构。
    const sec = zhongyongMode
      ? { id: 'zhang' + (k + 2), name: chapterCells[k + 1].text.replace('右', '') }
      : { id: 'zhuan' + (k + 1), name: chapterCells[k + 1].text.replace('右', '') };
    bounds.push({ idx: ch.toIdx, sec });
  });
  for (let i = 0; i < bounds.length; i++) {
    const fromIdx = bounds[i].idx + 1;
    const toIdx = i === bounds.length - 1 ? base.gridStr.length - 1 : bounds[i + 1].idx;
    if (fromIdx > toIdx) continue;
    sections.push({ id: bounds[i].sec.id, name: bounds[i].sec.name, from: endAt(fromIdx), to: endAt(toIdx) });
  }
  return { labels, sections, chapterCells, zhongyongMode, anchorMode: anchors.mode };
}

// ── 主入口 ──
function buildOverlay(workId, opts = {}) {
  const fs = require('fs');
  const dataDir = path.join(__dirname, '..', 'data', workId);
  const tr = JSON.parse(fs.readFileSync(path.join(dataDir, 'grid-transcribe.json'), 'utf8'));
  const v2 = JSON.parse(fs.readFileSync(path.join(dataDir, 'shanben-v2.json'), 'utf8'));
  const base = loadBaseGrid(tr, dataDir);
  const baseSha = crypto.createHash('sha256').update(fs.readFileSync(path.join(dataDir, 'grid-transcribe.json'))).digest('hex');

  // 作品登记（editions.yaml）：锚规则派生 + 现代本卷路由所需 edition 目录名
  let work = null, ioMod = null;
  try { ioMod = require('./io'); work = ioMod.loadConfig().works[workId] || null; } catch { work = null; }
  const anchors = deriveAnchors(work);

  const oldOcr = alignOldOcr(base, v2);

  // 现代本（可选：无输入目录时跳过 G2b；分卷书按基础层首页码路由到同卷儒藏目录）
  let modern = null;
  const inputRoot = opts.inputRoot || path.join(__dirname, '..', '..', '..', 'input_data');
  const inputBook = (work && work.inputBook) || workId;
  let mdir = path.join(inputRoot, inputBook, '儒藏本_ocr');
  let headings = new Set();
  if (opts.modern !== false) {
    if (!fs.existsSync(mdir) && ioMod && work) {
      // 分卷书：基础层首页码 → 当涂卷名 → 同名卷的儒藏目录（页码全局连续）
      const firstPage = base.pages.length ? base.pages[0].n : null;
      const vol = firstPage != null ? ioMod.volumeOfPage(inputBook, ioMod.loadConfig().editions[work.shanben].ocrDir, firstPage) : null;
      const cand = vol ? path.join(inputRoot, inputBook, vol, ioMod.loadConfig().editions[work.xiandai].ocrDir) : null;
      if (cand && fs.existsSync(cand)) {
        mdir = cand;
        console.log(`分卷书路由：基础层首页 p${firstPage} → 卷「${vol}」→ ${mdir}`);
      }
    }
    if (fs.existsSync(mdir)) {
      // 页眉集：书名/序名（editions.yaml title 为繁体，与儒藏本 OCR 一致）
      const title = (work && work.title) || workId;
      headings = new Set([title, `${title.replace(/章句$/, '')}章句序`, '朱熹章句']);
      const raw = fs.readdirSync(mdir).filter(f => /^page_\d+\.md$/.test(f)).sort()
        .map(f => fs.readFileSync(path.join(mdir, f), 'utf8')).join('\n');
      modern = alignModern(base, raw, { headings, chapterRE: anchors.chapterRE });
    }
  }

  const g3 = labelGrid(base, modern, anchors);

  // j/z 对照（与现行 grid.json 列级判定）
  let jzCheck = null;
  const gridPath = path.join(dataDir, 'grid.json');
  if (fs.existsSync(gridPath)) {
    const grid = JSON.parse(fs.readFileSync(gridPath, 'utf8'));
    let match = 0, total = 0, diffs = [];
    for (const pg of grid.pages || []) for (const col of pg.cols || []) {
      const lab = g3.labels.find(l => l.page === pg.n && l.col === col.col);
      if (!lab || lab.role === 'title') continue; // title 列不参与 j/z 对照（章题列本非经注对立）
      total++;
      if (lab.role === col.type) match++;
      else if (diffs.length < 30) diffs.push({ page: pg.n, col: col.col, gridJson: col.type, overlay: lab.role, text: (col.text || '').slice(0, 14) });
    }
    jzCheck = { match, total, ratio: total ? +(match / total).toFixed(4) : 0, diffs };
  }

  const overlay = {
    schemaVersion: 1,
    work: workId,
    base: { file: 'grid-transcribe.json', sha256: baseSha },
    stats: {
      pages: base.pages.length, cells: base.flat.length,
      oldOcr: { agree: oldOcr.agree, sub: oldOcr.sub.length, missing: oldOcr.missing.length, extra: oldOcr.extra.length },
      modern: modern ? { agree: modern.agree, sub: modern.sub.length, missing: modern.missing.length, extra: modern.extra.length, anchors: modern.anchors, unanchoredSegs: modern.unanchoredSegs } : null,
      labels: { cols: g3.labels.length, titles: g3.labels.filter(l => l.role === 'title').length },
      sections: g3.sections.length,
    },
    variants: { oldOcr, modern },
    labels: g3.labels,
    sections: g3.sections,
    fixes: [],
  };
  const report = {
    work: workId,
    cells: base.flat.length,
    oldOcrAgree: oldOcr.agree / Math.max(1, oldOcr.agree + oldOcr.sub.length + oldOcr.extra.length),
    modernAgree: modern ? modern.agree / Math.max(1, modern.agree + modern.sub.length + modern.extra.length) : null,
    preclean: modern ? modern.preclean.reduce((m, e) => { m[e.kind] = (m[e.kind] || 0) + 1; return m; }, {}) : null,
    zhongyongMode: g3.zhongyongMode,
    anchorMode: g3.anchorMode,
    sections: g3.sections.map(s => `${s.id}:${s.name}`),
    jzCheck,
  };
  return { overlay, report };
}

module.exports = { buildOverlay, loadBaseGrid, alignOldOcr, alignModern, labelGrid, deriveAnchors, canon, canonCh, precleanModern };
