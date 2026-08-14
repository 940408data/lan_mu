#!/usr/bin/env node
/**
 * collation · M2 视觉重 OCR + 与旧 OCR 互证（tools/recollate.js）
 * 原则：不单一依赖视觉——两路 OCR 逐字比对，一致采信、相异标记（后续覆校仲裁/人工）。
 *
 * 用法:
 *   node collation/tools/recollate.js <书名> --pages=8-10 [--dpi=150] [--out=...]
 * 产出（每页）:
 *   { page, agree: 一致率, nOld, nVis, diffs:[{pos,old,vis}], visText }
 * 两路归一（去空白/标点/○、异体归一）后编辑距离对齐，统计一致率。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { renderPage, ocrPage } = require('../src/vision');
const { loadWork, INPUT_DATA } = require('../src/io');
const { normChar } = require('../src/align');

const args = process.argv.slice(2);
const flags = {}, pos = [];
for (const a of args) { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) flags[m[1]] = m[2] ?? true; else pos.push(a); }
const workId = pos[0];
if (!workId || !flags.pages) { console.error('用法: node collation/tools/recollate.js <书名> --pages=8-10'); process.exit(1); }
const dpi = parseInt(flags.dpi || '150', 10);
const [pStart, pEnd] = String(flags.pages).split('-').map(Number);

function pad(n) { return String(n).padStart(4, '0'); }
/** 归一为可比字串：去空白/标点/○/书题，异体归一 */
function canon(s) {
  return [...s.replace(/[，。！？；：、""''「」『』《》（）○\s〔〕？?]/g, '')]
    .map(c => normChar(c)).join('');
}

/** 编辑距离对齐两路字串，返回差异点 [{pos,old,vis}] 与一致数 */
function diffChars(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    dp[i][j] = Math.min(dp[i-1][j-1] + (a[i-1]===b[j-1]?0:1), dp[i-1][j]+1, dp[i][j-1]+1);
  const diffs = []; let match = 0;
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i-1] === b[j-1] && dp[i][j] === dp[i-1][j-1]) { match++; i--; j--; }
    else if (dp[i][j] === dp[i-1][j-1] + 1) { diffs.push({ pos: i-1, old: a[i-1], vis: b[j-1] }); i--; j--; }
    else if (dp[i][j] === dp[i-1][j] + 1) { diffs.push({ pos: i-1, old: a[i-1], vis: '∅' }); i--; }
    else { diffs.push({ pos: i, old: '∅', vis: b[j-1] }); j--; }
  }
  while (i > 0) { diffs.push({ pos: i-1, old: a[i-1], vis: '∅' }); i--; }
  while (j > 0) { diffs.push({ pos: 0, old: '∅', vis: b[j-1] }); j--; }
  return { diffs: diffs.reverse(), match, total: Math.max(m, n) };
}

(async () => {
  const { shanben } = loadWork(workId);
  const pdfDir = path.join(INPUT_DATA, workId, '当涂郡本_pdf');
  const ocrDir = path.join(INPUT_DATA, workId, '当涂郡本_ocr');
  const conc = parseInt(flags.conc || '5', 10);
  const pages = [];
  for (let pg = pStart; pg <= (pEnd || pStart); pg++) pages.push(pg);
  const out = [];
  let idx = 0, done = 0;
  async function worker() {
    while (idx < pages.length) {
      const pg = pages[idx++];
      const pdfPath = path.join(pdfDir, `page_${pad(pg)}.pdf`);
      const oldPath = path.join(ocrDir, `page_${pad(pg)}.md`);
      if (!fs.existsSync(pdfPath) || !fs.existsSync(oldPath)) { console.log(`page ${pg} 缺文件，跳过`); continue; }
      const oldText = fs.readFileSync(oldPath, 'utf8');
      try {
        const { b64 } = renderPage(pdfPath, 1, dpi);
        const t0 = Date.now();
        const r = await ocrPage(b64);
        const visText = r.text || '';
        const a = canon(oldText), b = canon(visText);
        const { diffs, match, total } = diffChars(a, b);
        const agree = total ? (match / total * 100).toFixed(1) : '0';
        done++;
        console.log(`page_${pad(pg)}: 一致率 ${agree}% (旧${a.length}/视${b.length}/异${diffs.length}) ${r.engine} ${((Date.now()-t0)/1000).toFixed(0)}s [${done}/${pages.length}]`);
        out.push({ page: pg, agree: parseFloat(agree), nOld: a.length, nVis: b.length, nDiff: diffs.length, diffs, visText });
      } catch (e) {
        console.log(`page_${pad(pg)}: 失败 ${e.message}`);
        out.push({ page: pg, error: String(e.message) });
      }
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  out.sort((x, y) => x.page - y.page);
  const outPath = flags.out || path.join(__dirname, '..', 'data', workId, `recollate-${pStart}-${pEnd||pStart}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  const ok = out.filter(o => o.agree != null);
  const avg = ok.length ? (ok.reduce((s, o) => s + o.agree, 0) / ok.length).toFixed(1) : '0';
  console.log(`✓ ${ok.length}/${pages.length} 页，平均一致率 ${avg}%`);
  console.log('→', outPath);
})().catch(e => { console.error('✗', e); process.exit(1); });
