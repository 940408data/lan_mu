#!/usr/bin/env node
/**
 * 史记 G1 → manuscript text.yaml 直出
 * 将 grid-transcribe.json 转为 manuscript 引擎所需的 text.yaml 格式。
 * 史记无注文，全部为 j 块（经文大字单行）。
 * 用法: node collation/tools/grid-to-manuscript.js <书名> <新作品id> [--write]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const args = process.argv.slice(2);
const flags = {}, pos = [];
for (const a of args) { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) flags[m[1]] = m[2] ?? true; else pos.push(a); }
const [workId, newId] = pos;
if (!workId || !newId) { console.error('用法: node collation/tools/grid-to-manuscript.js <书名> <新作品id> [--write]'); process.exit(1); }

const dataDir = path.join(__dirname, '..', 'data', workId);
const trFile = path.join(dataDir, 'grid-transcribe.json');
if (!fs.existsSync(trFile)) { console.error('✗ 无 ' + trFile); process.exit(1); }

const tr = JSON.parse(fs.readFileSync(trFile, 'utf8'));
const N_COLS = tr.layout.cols;
const N_ROWS = tr.layout.rows;

// 按页→列→行排序，提取文字
const sections = [];
let secName = null;
let blocks = [];

for (const pg of tr.pages) {
  // 按 col 升序（自右向左），row 升序（自上而下）
  const cells = (pg.cells || []).sort((a, b) => a.col - b.col || a.row - b.row);
  
  // 检测篇题列（col1 且 row1 有字且字数少 = 篇题）
  const col1Cells = cells.filter(c => c.col === 1);
  const col1Text = col1Cells.map(c => c.char).join('');
  
  let isTitlePage = false;
  if (col1Text && col1Text.length <= 6 && !col1Text.includes('者') && !col1Text.includes('之')) {
    // 可能是篇题页
    isTitlePage = true;
  }
  
  // 提取所有列的文字
  const colTexts = [];
  for (let col = 1; col <= N_COLS; col++) {
    const colCells = cells.filter(c => c.col === col);
    const text = colCells.map(c => c.char).join('');
    if (text) colTexts.push({ col, text });
  }
  
  if (isTitlePage && colTexts.length > 0 && colTexts[0].text.length <= 6) {
    // 篇题页：首列为标题
    if (blocks.length > 0) {
      sections.push({ id: secName, name: secName, blocks });
      blocks = [];
    }
    secName = colTexts[0].text;
    // 剩余列作为经文
    const remainingText = colTexts.slice(1).map(c => c.text).join('');
    if (remainingText) blocks.push({ type: 'j', text: remainingText });
  } else {
    // 普通页：所有列合并为经文
    const pageText = colTexts.map(c => c.text).join('');
    if (pageText) {
      if (blocks.length === 0 && !secName) {
        secName = '正文';
      }
      blocks.push({ type: 'j', text: pageText });
    }
  }
}

if (blocks.length > 0) {
  sections.push({ id: secName || '正文', name: secName || '正文', blocks });
}

const doc = { sections };
const totalChars = sections.reduce((s, sec) => s + sec.blocks.reduce((s2, b) => s2 + (b.text ? b.text.length : 0), 0), 0);

console.log(`${workId} → ${newId}: ${sections.length} sections, ${totalChars} chars`);

if (flags.write) {
  const outDir = path.join(__dirname, '..', '..', 'works', newId);
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'text.yaml');
  fs.writeFileSync(outFile, YAML.stringify(doc, { lineWidth: 0 }));
  console.log('✓ 写入 ' + outFile + ' (' + Math.round(fs.statSync(outFile).size / 1024) + ' KB)');

  // 坐标快照 grid.yaml（[col,row,char] 三元组，只含有字格）——manuscript 引擎按坐标直出，
  // 与 songke-facsimile 同一还原纪律：页/列/行全真，空格/空列由 layout 隐含自然留白。
  const gridDoc = {
    work: workId,
    layout: { cols: N_COLS, rows: N_ROWS },
    pages: (tr.pages || []).map((pg) => ({
      n: pg.n,
      cells: (pg.cells || []).filter((c) => String(c.char || '').trim())
        .map((c) => [c.col, c.row, String(c.char).trim()]),
    })),
    labels: [], sections: [], fixes: [], marks: [],
  };
  const gridFile = path.join(outDir, 'grid.yaml');
  fs.writeFileSync(gridFile, YAML.stringify(gridDoc, { lineWidth: 0 }));
  const nCells = gridDoc.pages.reduce((s, p) => s + p.cells.length, 0);
  console.log('✓ 写入 ' + gridFile + '（' + gridDoc.pages.length + ' 半葉 ' + nCells + ' 有字格）');
} else {
  console.log('(dry-run) 加 --write 写入 works/' + newId + '/text.yaml + grid.yaml');
}
