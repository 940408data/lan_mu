#!/usr/bin/env node
/**
 * collation · M6 进引擎：grid.json（版面经注结构）→ works/<id>/ 四件套（tools/build-works.js）
 * 产出兰木 songke 引擎可直接构建的作品目录：text.yaml（经注分栏）+ meta.yaml + seals/ornaments。
 * 善本底独立成新作品（如 daxue-songben），不动既有通行本（daxue）。
 *
 * 用法: node collation/tools/build-works.js 大学章句 daxue-songben [--base=daxue]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const args = process.argv.slice(2);
const flags = {}, pos = [];
for (const a of args) { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) flags[m[1]] = m[2] ?? true; else pos.push(a); }
const [workId, newId] = pos;
if (!workId || !newId) { console.error('用法: node collation/tools/build-works.js <书名> <新作品id> [--base=daxue]'); process.exit(1); }
const baseId = flags.base || 'daxue';
const dataDir = path.join(__dirname, '..', 'data', workId);
const grid = JSON.parse(fs.readFileSync(path.join(dataDir, 'grid.json'), 'utf8'));
// 正文页域：layout.json textPages 限定（序/题跋另成卷，不混入正文作品）
let textRange = null;
try {
  const layout = JSON.parse(fs.readFileSync(path.join(dataDir, 'layout.json'), 'utf8'));
  if (layout.textPages) textRange = layout.textPages;
} catch {}
const worksDir = path.join(__dirname, '..', '..', 'works');

// 1) grid 列 → 合并连续同 type 为段（经注分栏 blocks，限正文页域）
const blocks = [];
for (const pg of grid.pages) {
  if (textRange && (pg.n < textRange[0] || pg.n > textRange[1])) continue;
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
    // 中庸章标在章末：归入当前节后闭节
    zhongyongMode = true;
    cur.blocks.push(b);
    sections.push(cur); secN++;
    cur = { id: 'zhang' + (secN + 1), name: '第' + mZhongyong[1] + '章', blocks: [] };
    continue;
  }
  if (mDaxue && /右傳之/.test(mDaxue[1]) && cur.blocks.length) { sections.push(cur); secN++; cur = { id: 'zhuan' + secN, name: mDaxue[1].replace('右', ''), blocks: [] }; }
  cur.blocks.push(b);
}
sections.push(cur);
// 中庸首节命名：题辞+首章（仅中庸模式）
if (zhongyongMode && sections[0].id === 'jing') sections[0].name = '首章';

// 3) 统计 expect
const jChars = blocks.filter(b => b.type === 'j').reduce((s, b) => s + b.text.length, 0);
const zChars = blocks.filter(b => b.type === 'z').reduce((s, b) => s + b.text.length, 0);

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
  subtitle: '当涂郡斋刊递修本 · 经注分栏',
  expect: { chars: jChars + zChars, jChars, zChars, columns: null, halves: null, leaves: null },
};
if (meta.book) meta.book = { ...meta.book, id: newId, title: meta.title };

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
