#!/usr/bin/env node
/**
 * collation · M6 进引擎：grid.json / grid-transcribe.json（版面经注结构）→ works/<id>/ 四件套（tools/build-works.js）
 * 产出兰木 songke 引擎可直接构建的作品目录：text.yaml（经注分栏）+ meta.yaml + seals/ornaments。
 * 善本底独立成新作品（如 daxue-songben），不动既有通行本（daxue）。
 *
 * 用法: node collation/tools/build-works.js 大学章句 daxue-songben --base=daxue
 *   --from=transcribe            版面判定改用逐格转写（路线 B），替代 grid.json（路线 A）
 *   --pages=7-76 | --pages=2,5   显式页域（序卷等非正文卷用，覆盖 layout.textPages）
 *   --section-name=中庸章句序     无章锚单节卷（如序）的首节名；--section-id 改 id（默认 xu）
 *   --subtitle=…                 覆盖 subtitle（默认 当涂郡斋刊递修本 · 经注分栏）
 *   --book=id --book-title=…     覆盖 meta.book.id/title（默认 newId/meta.title）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const args = process.argv.slice(2);
const flags = {}, pos = [];
for (const a of args) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  // kebab-case 转 camelCase（如 --section-name → flags.sectionName）
  if (m) flags[m[1].replace(/-(\w)/g, (_, c) => c.toUpperCase())] = m[2] ?? true;
  else pos.push(a);
}
const [workId, newId] = pos;
if (!workId || !newId) { console.error('用法: node collation/tools/build-works.js <书名> <新作品id> [--base=daxue]'); process.exit(1); }
const baseId = flags.base || 'daxue';
const dataDir = path.join(__dirname, '..', 'data', workId);
const { loadM2Base } = require('../src/base');
const m2 = loadM2Base(workId);

// 版面判定来源：默认 grid.json（路线 A 列级判定）；--from=transcribe 改用逐格转写（路线 B）
let grid;
if (flags.from === 'transcribe') {
  const { transcribeToGrid } = require('../src/transcribe');
  const trFile = path.join(dataDir, 'grid-transcribe.json');
  if (!fs.existsSync(trFile)) { console.error(`找不到 ${trFile}（先跑 grid-transcribe.js）`); process.exit(1); }
  const tr = JSON.parse(fs.readFileSync(trFile, 'utf8'));
  if (!tr.base || tr.base.sha256 !== m2.sha256) {
    throw new Error('M6 grid-transcribe.json 不是当前 M2 shanben-v2 新底本生成；请先重跑 grid-transcribe.js');
  }
  grid = transcribeToGrid(tr);
} else {
  grid = JSON.parse(fs.readFileSync(path.join(dataDir, 'grid.json'), 'utf8'));
  if (!grid.base || grid.base.sha256 !== m2.sha256) {
    throw new Error('M6 grid.json 不是当前 M2 shanben-v2 新底本生成；请先重跑 judge-grid.js 与 build-songke.js');
  }
}
if (m2.pendingCount) throw new Error(`M6 不能使用仍有 ${m2.pendingCount} 处待覆校的 M2 底本；请先完成 verify-v2.js`);
const worksDir = path.join(__dirname, '..', '..', 'works');

// 页域：layout.json 可声明 textPages，将序、题跋、封底另留在独立卷，不混入正文作品。
// --pages=a-b 或 --pages=2,5 显式覆盖（序卷等非正文卷用）。
let pageSel = null;
try {
  const layout = JSON.parse(fs.readFileSync(path.join(dataDir, 'layout.json'), 'utf8'));
  if (Array.isArray(layout.textPages) && layout.textPages.length === 2) pageSel = { range: layout.textPages };
} catch {}
if (flags.pages) {
  const v = String(flags.pages);
  if (/^\d+\s*-\s*\d+$/.test(v)) { const [a, b] = v.split('-').map(Number); pageSel = { range: [a, b] }; }
  else pageSel = { set: new Set(v.split(',').map(Number)) };
}
const inPage = n => !pageSel || (pageSel.range ? (n >= pageSel.range[0] && n <= pageSel.range[1]) : pageSel.set.has(n));

// 1) grid 列 → 合并连续同 type 为段（经注分栏 blocks，限正文页域）
const blocks = [];
for (const pg of grid.pages) {
  if (!inPage(pg.n)) continue;
  for (const col of pg.cols) {
    const t = (col.text || '').trim();
    if (!t) continue;
    const last = blocks[blocks.length - 1];
    if (last && last.type === col.type) last.text += t;
    else blocks.push({ type: col.type, text: t });
  }
}

// 2) 按章节锚点分 sections（大学：右經一章/右傳之X章 起新节；中庸：右第X章 收前节）
const sections = [];
let cur = { id: 'jing', name: '經一章', blocks: [] };
let secN = 0, zhongyongMode = false;
for (const b of blocks) {
  const mZhongyong = b.text.match(/右第([一二三四五六七八九十百]+)章/);
  const mDaxue = b.text.match(/右(傳之[首一二三四五六七八九十]+章|經一章)/);
  if (mZhongyong) {
    zhongyongMode = true;
    cur.blocks.push(b);
    sections.push(cur); secN++;
    cur = { id: 'zhang' + (secN + 1), name: '第' + mZhongyong[1] + '章', blocks: [] };
    continue;
  }
  if (mDaxue && /右傳之/.test(mDaxue[1]) && cur.blocks.length) {
    sections.push(cur); secN++;
    cur = { id: 'zhuan' + secN, name: mDaxue[1].replace('右', ''), blocks: [] };
  }
  cur.blocks.push(b);
}
sections.push(cur);
if (zhongyongMode && sections[0].id === 'jing') sections[0].name = '首章';
// 序卷等无章锚的单节卷：--section-name/--section-id 重命名首节（如 中庸章句序/xu）
if (flags.sectionName && sections.length === 1 && !zhongyongMode) {
  sections[0].name = flags.sectionName;
  sections[0].id = flags.sectionId || 'xu';
}

// 3) 统计 expect
// 引擎按 tokens 计字：句读和排版括号不占字格；同时按 Unicode code point
// 计数，避免𠋣等扩展区字被 JS UTF-16 String.length 算成两个。
const NON_TOKENS = new Set([...'。！？？，、；：「」『』（）〈〉—·']);
const countTokens = text => [...text].filter(ch => !NON_TOKENS.has(ch)).length;
const jChars = blocks.filter(b => b.type === 'j').reduce((s, b) => s + countTokens(b.text), 0);
const zChars = blocks.filter(b => b.type === 'z').reduce((s, b) => s + countTokens(b.text), 0);

// 4) 生成 text.yaml
let textYaml = `# ${grid.work || workId}（当涂郡斋刊递修本·善本底）：j 为经传大字，z 为章句小字。版面结构先行：顶格经/退格注。\nsections:\n`;
for (const sec of sections) {
  textYaml += `  - id: ${sec.id}\n    name: ${sec.name}\n    blocks:\n`;
  for (const b of sec.blocks) textYaml += `      - { type: ${b.type}, text: ${b.text} }\n`;
}

// 5) meta.yaml：以 base 作品为模板改 id/title/book/expect
const baseMeta = YAML.parse(fs.readFileSync(path.join(worksDir, baseId, 'meta.yaml'), 'utf8'));
const meta = {
  ...baseMeta,
  id: newId,
  title: (baseMeta.title || '大學章句') + '（善本底）',
  subtitle: flags.subtitle || '当涂郡斋刊递修本 · 经注分栏',
  // 版面列/葉数由 typeset-songke 根据文本动态重排，不把旧分支的数值带过来；
  // 这里锁定可复核的字数基准，避免 null 被误当成校验值。
  expect: { chars: jChars + zChars, jChars, zChars },
};
if (meta.book) meta.book = { ...meta.book, id: flags.book || newId, title: flags.bookTitle || meta.title };

// 6) 写四件套
const outDir = path.join(worksDir, newId);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'text.yaml'), textYaml);
fs.writeFileSync(path.join(outDir, 'meta.yaml'), YAML.stringify(meta));
for (const f of ['seals.yaml', 'ornaments.yaml']) {
  const src = path.join(worksDir, baseId, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(outDir, f));
}
console.log(`✓ works/${newId} 四件套：${sections.length} sections，${blocks.length} blocks（经字 ${jChars} / 注字 ${zChars}）`);
console.log(`  text.yaml + meta.yaml + seals/ornaments（模板 works/${baseId}）`);
