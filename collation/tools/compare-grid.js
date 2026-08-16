#!/usr/bin/env node
/**
 * collation · 逐格 vs 列级对比分析（tools/compare-grid.js）
 * 对比 grid-transcribe.json（逐格）与 grid.json（列级）的还原效果
 *
 * 用法: node collation/tools/compare-grid.js <书名>
 */
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const workId = args[0];
if (!workId) { console.error('用法: node collation/tools/compare-grid.js <书名>'); process.exit(1); }

const dataDir = path.join(__dirname, '..', 'data', workId);
const transcribeFile = path.join(dataDir, 'grid-transcribe.json');
const columnFile = path.join(dataDir, 'grid.json');
const logFile = path.join(dataDir, 'grid-transcribe-log.json');

if (!fs.existsSync(transcribeFile)) { console.error(`找不到 ${transcribeFile}`); process.exit(1); }
if (!fs.existsSync(columnFile)) { console.error(`找不到 ${columnFile}`); process.exit(1); }

const transcribe = JSON.parse(fs.readFileSync(transcribeFile, 'utf8'));
const column = JSON.parse(fs.readFileSync(columnFile, 'utf8'));
const log = fs.existsSync(logFile) ? JSON.parse(fs.readFileSync(logFile, 'utf8')) : { logs: [] };

console.log(`\n=== 逐格 vs 列级 对比分析 ===`);
console.log(`书名: ${workId}`);
console.log(`逐格数据页数: ${transcribe.pages.length}`);
console.log(`列级数据页数: ${column.pages.length}`);

// 费用统计
console.log(`\n--- 费用统计（${log.logs.length} 页样本）---`);
const totalInputTokens = log.logs.reduce((s, l) => s + (l.usage?.prompt_tokens || 0), 0);
const totalOutputTokens = log.logs.reduce((s, l) => s + (l.usage?.completion_tokens || 0), 0);
const totalCost = log.logs.reduce((s, l) => s + l.cost, 0);
const avgCost = log.logs.length ? totalCost / log.logs.length : 0;

console.log(`总输入 token: ${totalInputTokens.toLocaleString()}`);
console.log(`总输出 token: ${totalOutputTokens.toLocaleString()}`);
console.log(`总费用: ¥${totalCost.toFixed(4)}`);
console.log(`平均每页输入: ${log.logs.length ? Math.round(totalInputTokens / log.logs.length).toLocaleString() : 0} token`);
console.log(`平均每页输出: ${log.logs.length ? Math.round(totalOutputTokens / log.logs.length).toLocaleString() : 0} token`);
console.log(`平均每页费用: ¥${avgCost.toFixed(4)}`);

// 全书预测
const daxuePages = 39;  // 大学章句
const zhongyongPages = 78;  // 中庸章句（从 layout.json 可知）
console.log(`\n--- 全书费用预测 ---`);
console.log(`大学章句 (${daxuePages} 页): ¥${(avgCost * daxuePages).toFixed(2)}`);
console.log(`中庸章句 (${zhongyongPages} 页): ¥${(avgCost * zhongyongPages).toFixed(2)}`);
console.log(`两书合计: ¥${(avgCost * (daxuePages + zhongyongPages)).toFixed(2)}`);

// 对比分析：逐格数据的优势
console.log(`\n--- 逐格数据还原验证 ---`);

// 找几页对比
const commonPages = transcribe.pages.filter(tp => 
  column.pages.some(cp => cp.n === tp.n)
).slice(0, 3);

for (const tp of commonPages) {
  const cp = column.pages.find(p => p.n === tp.n);
  if (!cp) continue;
  
  console.log(`\n第 ${tp.n} 页对比:`);
  
  // 逐格数据统计
  const tCells = tp.cells.length;
  const tFilled = tp.cells.filter(c => c.char && c.char.trim()).length;
  const tEmpty = tCells - tFilled;
  
  // 列级数据统计
  const cCols = cp.cols.length;
  const cText = cp.cols.reduce((s, c) => s + (c.text || '').length, 0);
  
  console.log(`  逐格: ${tCells} 格（填充 ${tFilled} / 空 ${tEmpty}）`);
  console.log(`  列级: ${cCols} 列，共 ${cText} 字`);
  
  // 检查双行夹注情况
  const zhuCols = cp.cols.filter(c => c.type === 'z');
  if (zhuCols.length > 0) {
    console.log(`  注列数: ${zhuCols.length}`);
    // 逐格数据中注列的字符分布
    const zhuColNums = new Set(zhuCols.map(c => c.col));
    const zhuCells = tp.cells.filter(c => zhuColNums.has(c.col));
    const zhuFilled = zhuCells.filter(c => c.char && c.char.trim()).length;
    console.log(`  逐格注列填充: ${zhuFilled}/${zhuCells.length}`);
  }
}

// 展示一页的完整网格还原
console.log(`\n--- 第 3 页 16×15 网格还原（逐格数据）---`);
const page3 = transcribe.pages.find(p => p.n === 3);
if (page3) {
  const COLS = 16, ROWS = 15;
  console.log(`  列: ` + Array.from({length: COLS}, (_, i) => String(i+1).padStart(2)).join(' '));
  for (let row = 1; row <= ROWS; row++) {
    const rowStr = Array.from({length: COLS}, (_, col) => {
      const cell = page3.cells.find(c => c.col === col+1 && c.row === row);
      return cell ? (cell.char || '·').padStart(2) : ' ·';
    }).join(' ');
    console.log(`R${String(row).padStart(2)}: ${rowStr}`);
  }
  
  // 标注经注类型
  const cp3 = column.pages.find(p => p.n === 3);
  if (cp3) {
    console.log(`\n  列类型: ${Array.from({length: COLS}, (_, i) => {
      const col = cp3.cols.find(c => c.col === i+1);
      return col ? (col.type === 'j' ? '经' : '注') : '?';
    }).join(' ')}`);
    console.log(`  起始: ${Array.from({length: COLS}, (_, i) => {
      const cell = page3.cells.find(c => c.col === i+1 && c.start);
      if (!cell) return ' ·';
      if (cell.start === '頂格' || cell.start === '顶格') return '顶';
      if (cell.start === '退一格') return '退1';
      if (cell.start === '退两格') return '退2';
      return ' ·';
    }).join(' ')}`);
  }
}

console.log(`\n--- 结论 ---`);
console.log(`
逐格 gridTranscribe 的优势：
  ✓ 每个字有明确的 (col, row) 坐标，可严格还原版面
  ✓ 空格显式标记（char:""），区分"无字"和"识别失败"
  ✓ 双行夹注可区分左右行（通过 row 坐标）
  ✓ 版心/鱼尾位置精确到格

列级 gridColumns 的局限：
  ✗ 文字是连续字符串，无法确定每个字的行号
  ✗ 双行夹注混为一个字符串，无法区分左右行
  ✗ 无法标记列内空行位置

费用方面：
  ✓ 覆校模型平均每页 ¥${avgCost.toFixed(4)}
  ✓ 大学章句全书预测 ¥${(avgCost * daxuePages).toFixed(2)}
  ✓ 中庸章句全书预测 ¥${(avgCost * zhongyongPages).toFixed(2)}
`);
