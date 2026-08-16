#!/usr/bin/env node
/**
 * collation · 逐格还原验证（tools/verify-grid-reconstruct.js）
 * 读取现有 grid.json（列级数据），尝试展开为 16×15 逐格网格，
 * 分析列级数据在还原时的信息缺失点。
 *
 * 用法: node collation/tools/verify-grid-reconstruct.js <书名> [--page=N]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const flags = {}, pos = [];
for (const a of args) { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) flags[m[1]] = m[2] ?? true; else pos.push(a); }
const workId = pos[0];
if (!workId) { console.error('用法: node collation/tools/verify-grid-reconstruct.js <书名> [--page=N]'); process.exit(1); }

const dataDir = path.join(__dirname, '..', 'data', workId);
const gridFile = path.join(dataDir, 'grid.json');
const layoutFile = path.join(dataDir, 'layout.json');

if (!fs.existsSync(gridFile)) { console.error(`找不到 ${gridFile}`); process.exit(1); }
const grid = JSON.parse(fs.readFileSync(gridFile, 'utf8'));
const layout = fs.existsSync(layoutFile) ? JSON.parse(fs.readFileSync(layoutFile, 'utf8')) : { cols: 16, rows: 15 };
const { cols: COLS, rows: ROWS } = layout;
const targetPage = flags.page ? parseInt(flags.page, 10) : null;

console.log(`\n=== 逐格还原验证 ===`);
console.log(`书名: ${workId}`);
console.log(`网格: ${COLS}列 × ${ROWS}行 = ${COLS * ROWS} 格/页`);
console.log(`总页数: ${grid.pages.length}`);
console.log(`理论总格数: ${grid.pages.length * COLS * ROWS}`);

// 分析函数：将列级 text 展开到 row 维度
function analyzePage(page) {
  const { n, cols: pageCols } = page;
  const totalCells = COLS * ROWS;
  
  // 构建 16×15 网格
  const grid = [];
  for (let row = 1; row <= ROWS; row++) {
    for (let col = 1; col <= COLS; col++) {
      grid.push({ col, row, char: '', source: 'empty' });
    }
  }
  
  const issues = [];
  
  for (const col of pageCols) {
    const text = col.text || '';
    const chars = [...text]; // 按 Unicode 字符拆分
    
    // 计算起始行
    let startRow = 1;
    if (col.start === '退一格') startRow = 2;
    else if (col.start === '退两格') startRow = 3;
    
    const availableRows = ROWS - startRow + 1; // 从 startRow 到底的行数
    
    if (chars.length > availableRows) {
      issues.push(`col ${col.col}: ${chars.length}字 > 可用${availableRows}行（start=${col.start}），溢出${chars.length - availableRows}字`);
    }
    if (chars.length === 0 && col.type === 'j') {
      issues.push(`col ${col.col}: 经列空列（可能为版心/鱼尾/空白）`);
    }
    
    // 按顺序填入（假设无空行、无双行夹注）
    for (let i = 0; i < chars.length && i < availableRows; i++) {
      const row = startRow + i;
      const cell = grid.find(c => c.col === col.col && c.row === row);
      if (cell) {
        cell.char = chars[i];
        cell.source = 'text';
      }
    }
    
    // 标记起始位置
    if (chars.length > 0) {
      const startCell = grid.find(c => c.col === col.col && c.row === startRow);
      if (startCell) startCell.start = col.start;
    }
  }
  
  const filled = grid.filter(c => c.char).length;
  const empty = grid.filter(c => !c.char).length;
  
  return { n, totalCells, filled, empty, issues, grid };
}

// 分析所有页或指定页
const pagesToAnalyze = targetPage ? grid.pages.filter(p => p.n === targetPage) : grid.pages;
if (targetPage && pagesToAnalyze.length === 0) {
  console.error(`页 ${targetPage} 不存在，可用页: ${grid.pages.map(p => p.n).join(', ')}`);
  process.exit(1);
}

let totalIssues = 0;
let pagesWithOverflow = 0;
let emptyCols = 0;

const summary = [];

for (const page of pagesToAnalyze) {
  const result = analyzePage(page);
  summary.push(result);
  
  if (result.issues.length > 0) {
    const overflows = result.issues.filter(i => i.includes('溢出'));
    if (overflows.length > 0) pagesWithOverflow++;
    totalIssues += result.issues.length;
    emptyCols += result.issues.filter(i => i.includes('空列')).length;
  }
}

// 输出汇总
console.log(`\n--- 汇总统计 ---`);
console.log(`分析页数: ${summary.length}`);
console.log(`有溢出问题的页: ${pagesWithOverflow}`);
console.log(`总问题数: ${totalIssues}`);
console.log(`空列数（经列无文字）: ${emptyCols}`);

// 如果有溢出，显示前几个
if (pagesWithOverflow > 0) {
  console.log(`\n--- 溢出示例（前5页）---`);
  let shown = 0;
  for (const s of summary) {
    if (shown >= 5) break;
    const overflows = s.issues.filter(i => i.includes('溢出'));
    if (overflows.length > 0) {
      console.log(`\n第 ${s.n} 页:`);
      overflows.forEach(i => console.log(`  ${i}`));
      shown++;
    }
  }
}

// 详细展示指定页的网格
if (targetPage) {
  const result = summary[0];
  console.log(`\n--- 第 ${targetPage} 页 16×15 网格还原 ---`);
  console.log(`填充: ${result.filled}/${result.totalCells} 格 (${(result.filled/result.totalCells*100).toFixed(1)}%)`);
  console.log(`空: ${result.empty} 格`);
  if (result.issues.length > 0) {
    console.log(`问题:`);
    result.issues.forEach(i => console.log(`  ⚠ ${i}`));
  }
  
  // 打印可视化网格（列头 + 每行）
  console.log(`\n  列: ` + Array.from({length: COLS}, (_, i) => String(i+1).padStart(2)).join(' '));
  for (let row = 1; row <= ROWS; row++) {
    const rowStr = Array.from({length: COLS}, (_, col) => {
      const cell = result.grid.find(c => c.col === col+1 && c.row === row);
      return cell ? (cell.char || '·').padStart(2) : ' ·';
    }).join(' ');
    console.log(`R${String(row).padStart(2)}: ${rowStr}`);
  }
  
  // 标注经注类型
  console.log(`\n  列类型: ${result.grid.slice(0, COLS).map((c, i) => {
    const col = pagesToAnalyze[0]?.cols?.find(pc => pc.col === i+1);
    return col ? (col.type === 'j' ? '经' : '注') : '?';
  }).join(' ')}`);
  console.log(`  起始: ${result.grid.slice(0, COLS).map((c, i) => {
    const col = pagesToAnalyze[0]?.cols?.find(pc => pc.col === i+1);
    if (!col) return '?';
    if (col.start === '顶格') return '顶';
    if (col.start === '退一格') return '退1';
    if (col.start === '退两格') return '退2';
    return '?';
  }).join(' ')}`);
}

// 输出缺失信息分析
console.log(`\n--- 列级数据 vs 逐格数据：信息缺失分析 ---`);
console.log(`
列级 grid.json 提供:
  ✓ 每列经注类型 (j/z)
  ✓ 每列起始位置 (顶格/退一格/退两格)
  ✓ 每列全部文字 (连续字符串)

列级 grid.json 缺失（逐格 gridTranscribe 可补）:
  ✗ 每列文字的行号分布（哪个字在第几行）
  ✗ 列内空行位置（文字是否中断）
  ✗ 双行夹注的左右行区分（注列两行小字各是什么）
  ✗ 版心/鱼尾/页码等装饰元素的精确位置
  ✗ 空格的显式标记（无字的格 vs 有字但识别失败）

结论: 列级数据可做"结构正确的版面框图"，
      逐格数据才能"严格还原每个格的内容"。
`);
