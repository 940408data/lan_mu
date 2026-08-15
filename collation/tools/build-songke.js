#!/usr/bin/env node
/**
 * collation · M3 收尾：grid.json → 经注分栏善本点校本（tools/build-songke.js）
 * 按 gridColumns 判定的列级经注结构（顶格=经 j / 退格=注 z），把连续同类型列合并为段，
 * 产出经注分栏的善本点校本 markdown。文字取 grid.json 的视觉转写（覆校过），
 * 异文夹注取 verdicts.json 的 resolved 定论。
 *
 * 用法: node collation/tools/build-songke.js <书名>
 */
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const flags = {}, pos = [];
for (const a of args) { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) flags[m[1]] = m[2] ?? true; else pos.push(a); }
const workId = pos[0];
if (!workId) { console.error('用法: node collation/tools/build-songke.js <书名>'); process.exit(1); }
const dataDir = path.join(__dirname, '..', 'data', workId);
const grid = JSON.parse(fs.readFileSync(path.join(dataDir, 'grid.json'), 'utf8'));
// 正文页域：layout.json textPages 限定（序/题跋不混入正文点校本）
let textRange = null;
try {
  const layout = JSON.parse(fs.readFileSync(path.join(dataDir, 'layout.json'), 'utf8'));
  if (layout.textPages) textRange = layout.textPages;
} catch {}
let verdicts = [];
try { verdicts = JSON.parse(fs.readFileSync(path.join(dataDir, 'verdicts.json'), 'utf8')); } catch {}

const title = (grid.work || workId).replace(/章句/, '章句');

// 逐页按列顺序，连续同 type 合并为段（限正文页域）
const blocks = [];
for (const pg of grid.pages) {
  if (textRange && (pg.n < textRange[0] || pg.n > textRange[1])) continue;
  for (const col of pg.cols) {
    const t = (col.text || '').trim();
    if (!t) continue;
    const last = blocks[blocks.length - 1];
    if (last && last.type === col.type) last.text += t;
    else blocks.push({ type: col.type, text: t, page: pg.n });
  }
}

const lines = [
  `# ${title} · 善本点校本（经注分栏）`,
  '',
  `> 底本：当涂郡斋刊递修本（公开善本）。版面结构先行：${grid.layout ? grid.layout.cols + '列×' + grid.layout.rows + '行' : ''}网格。`,
  grid.method
    ? `> 经注判定：${grid.method}。文字经两路 OCR 互证 + 覆校仲裁。`
    : `> 经注判定：顶格为经、退格为注（版面网格+规则客观判定，经兰木结构核验）。文字经两路 OCR 互证 + 覆校仲裁。`,
  '',
];
for (const b of blocks) {
  lines.push(b.type === 'j' ? `**【經】** ${b.text}` : `**【注】** ${b.text}`);
  lines.push('');
}
const outPath = path.join(dataDir, 'output', '善本点校本-分栏.md');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.join('\n'));
const j = blocks.filter(b => b.type === 'j').length, z = blocks.length - j;
console.log(`✓ 经注分栏善本点校本：${blocks.length} 段（经 ${j} / 注 ${z}）→ ${outPath}`);
console.log('--- 前 6 段预览 ---');
blocks.slice(0, 6).forEach(b => console.log(`  [${b.type === 'j' ? '经' : '注'}] ${b.text.slice(0, 30)}`));
