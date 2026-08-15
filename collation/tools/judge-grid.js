#!/usr/bin/env node
/**
 * collation · M3 全量经注判定（tools/judge-grid.js）——版面结构先行
 * 对善本正文页逐页 gridColumns（列级：每列起始顶格/退格 + 列文字），由规则判经注：
 *   顶格=经(j)、退格=注(z)。产 grid.json（页×列×{col,type,start,text}）。
 * 断点续传（已判页跳过）、并行、初校开思考/conf低升覆校。
 *
 * 用法: node collation/tools/judge-grid.js <书名> --pages=8-36 [--conc=3] [--cols=16] [--rows=15]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { renderPage, gridColumns } = require('../src/vision');
const { INPUT_DATA } = require('../src/io');

const args = process.argv.slice(2);
const flags = {}, pos = [];
for (const a of args) { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) flags[m[1]] = m[2] ?? true; else pos.push(a); }
const workId = pos[0];
if (!workId || !flags.pages) { console.error('用法: node collation/tools/judge-grid.js <书名> --pages=8-36 [--conc=3]'); process.exit(1); }
const conc = parseInt(flags.conc || '3', 10);
const layout = { cols: parseInt(flags.cols || '16', 10), rows: parseInt(flags.rows || '15', 10) };
const [pStart, pEnd] = String(flags.pages).split('-').map(Number);
const dataDir = path.join(__dirname, '..', 'data', workId);
const pdfDir = path.join(INPUT_DATA, workId, '当涂郡本_pdf');
const outPath = path.join(dataDir, 'grid.json');
function pad(n) { return String(n).padStart(4, '0'); }

let done = {};
if (fs.existsSync(outPath)) { try { JSON.parse(fs.readFileSync(outPath, 'utf8')).pages.forEach(p => done[p.n] = p); } catch {} }

(async () => {
  const queue = [];
  for (let pg = pStart; pg <= (pEnd || pStart); pg++) if (!done[pg]) queue.push(pg);
  console.log(`版面经注判定：${pStart}-${pEnd} 页，已判 ${Object.keys(done).length}，待判 ${queue.length}，conc=${conc}，网格 ${layout.cols}×${layout.rows}`);
  let idx = 0, cnt = 0;
  async function worker() {
    while (idx < queue.length) {
      const pg = queue[idx++];
      const pdfPath = path.join(pdfDir, `page_${pad(pg)}.pdf`);
      if (!fs.existsSync(pdfPath)) continue;
      try {
        const { b64 } = renderPage(pdfPath, 1, 150);
        const r = await gridColumns(b64, layout);
        cnt++;
        if (r.err || !r.obj) { console.log(`page_${pad(pg)}: ${r.err || '解析失败'}`); continue; }
        const cols = (Array.isArray(r.obj) ? r.obj : []).map(c => ({
          col: c.col, start: c.start, type: c.start === '顶格' ? 'j' : 'z', text: c.text || '',
        }));
        const j = cols.filter(c => c.type === 'j').length, z = cols.length - j;
        done[pg] = { n: pg, engine: r.engine, conf: r.conf, cols };
        console.log(`page_${pad(pg)}: ${cols.length}列 经${j}/注${z} conf=${(r.conf || 0).toFixed(2)} (${r.engine}) [${cnt}/${queue.length}]`);
        fs.writeFileSync(outPath, JSON.stringify({ work: workId, layout, pages: Object.values(done).sort((a, b) => a.n - b.n) }, null, 2));
      } catch (e) { console.log(`page_${pad(pg)}: 失败 ${e.message}`); }
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  const pages = Object.values(done).sort((a, b) => a.n - b.n);
  fs.writeFileSync(outPath, JSON.stringify({ work: workId, layout, pages }, null, 2));
  const tj = pages.reduce((s, p) => s + p.cols.filter(c => c.type === 'j').length, 0);
  const tz = pages.reduce((s, p) => s + p.cols.filter(c => c.type === 'z').length, 0);
  console.log(`✓ grid.json：${pages.length} 页，经 ${tj} 列 / 注 ${tz} 列`);
})().catch(e => { console.error('✗', e); process.exit(1); });
