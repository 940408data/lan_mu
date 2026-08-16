#!/usr/bin/env node
/**
 * collation · 逐格→分栏（tools/build-songke-transcribe.js）
 * 读 grid-transcribe.json（逐格 col/row/char/start），聚合为列（text+start+type），
 * 合并连续同 type 列为段，产经注分栏善本点校本。
 * 在逐格干净底本（qwen3.8-max）上判经注+版面还原，替代列级 gridColumns(3.7-plus 不稳)。
 *
 * 用法: node collation/tools/build-songke-transcribe.js <书名> [--pages=2,9]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const flags = {}, pos = [];
for (const a of args) { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) flags[m[1]] = m[2] ?? true; else pos.push(a); }
const workId = pos[0];
if (!workId) { console.error('用法: node collation/tools/build-songke-transcribe.js <书名> [--pages=2,9]'); process.exit(1); }
const dataDir = path.join(__dirname, '..', 'data', workId);
const trFile = path.join(dataDir, 'grid-transcribe.json');
if (!fs.existsSync(trFile)) { console.error(`找不到 ${trFile}（先跑 grid-transcribe.js）`); process.exit(1); }
const tr = JSON.parse(fs.readFileSync(trFile, 'utf8'));

let textRange = null;
try { const L = JSON.parse(fs.readFileSync(path.join(dataDir, 'layout.json'), 'utf8')); if (L.textPages) textRange = L.textPages; } catch {}

const pageFilter = flags.pages ? new Set(String(flags.pages).split(',').map(Number)) : null;
const title = (tr.work || workId).replace(/章句/, '章句');

/** 逐格→列聚合：按 col 分组、row 升序，列 text=char 连接，start 取首字标记或按 row 推，type=顶格→j/退格→z */
function colsOf(page) {
  const byCol = {};
  for (const c of page.cells || []) { (byCol[c.col] ||= []).push(c); }
  const cols = [];
  for (const col of Object.keys(byCol).map(Number).sort((a, b) => a - b)) {
    const cells = byCol[col].sort((a, b) => a.row - b.row);
    const text = cells.map(c => c.char || '').filter(s => s).join('');
    if (!text) continue;
    let start = cells.find(c => c.start)?.start;
    if (!start) {
      const r = cells[0]?.row;
      start = r === 1 ? '顶格' : (r === 2 ? '退一格' : '退两格');
    }
    const type = (start === '顶格' || start === '頂格') ? 'j' : 'z';
    cols.push({ col, start, type, text });
  }
  return cols;
}

const blocks = [];
const outOfRange = [];
for (const pg of tr.pages) {
  if (pageFilter && !pageFilter.has(pg.n)) continue;
  if (textRange && (pg.n < textRange[0] || pg.n > textRange[1])) outOfRange.push(pg.n);
  for (const c of colsOf(pg)) {
    const last = blocks[blocks.length - 1];
    if (last && last.type === c.type) last.text += c.text;
    else blocks.push({ type: c.type, text: c.text, page: pg.n });
  }
}

const lines = [
  `# ${title} · 善本点校本（经注分栏·逐格还原）`,
  '',
  `> 底本：当涂郡斋刊递修本（公开善本）。逐格 gridTranscribe（qwen3.8-max）还原：每格 col/row/char/start，聚合为列判经注（顶格=j/退格=z）。`,
  '',
];
for (const b of blocks) {
  lines.push(b.type === 'j' ? `**【經】** ${b.text}` : `**【注】** ${b.text}`);
  lines.push('');
}
const outPath = path.join(dataDir, 'output', '善本点校本-分栏-逐格.md');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.join('\n'));
const j = blocks.filter(b => b.type === 'j').length, z = blocks.length - j;
console.log(`✓ 逐格→分栏：${blocks.length} 段（经 ${j} / 注 ${z}）→ ${outPath}`);
if (outOfRange.length) console.warn(`⚠ ${outOfRange.length} 页超正文页域（${outOfRange.join(',')}，疑序/题跋）已纳入分栏，请人工确认。`);
console.log('--- 全部段预览 ---');
blocks.forEach(b => console.log(`  [${b.type === 'j' ? '经' : '注'}] p${b.page} ${b.text.slice(0, 32)}`));
