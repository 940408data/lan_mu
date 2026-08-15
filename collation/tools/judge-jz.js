#!/usr/bin/env node
/**
 * collation · M3 经注大小学批量判定（tools/judge-jz.js）
 * 对善本正文页逐页 judgeJZ（初校开思考，conf低升覆校）→ jz.json（页×列×j/z×字）。
 * 序页（全大字）与书末题跋页可 --skip 跳过。并行 + 断点（已判页跳过）。
 *
 * 用法: node collation/tools/judge-jz.js <书名> --pages=8-36 [--conc=2] [--dpi=150]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { renderPage, judgeJZ } = require('../src/vision');
const { INPUT_DATA } = require('../src/io');

const args = process.argv.slice(2);
const flags = {}, pos = [];
for (const a of args) { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) flags[m[1]] = m[2] ?? true; else pos.push(a); }
const workId = pos[0];
if (!workId || !flags.pages) { console.error('用法: node collation/tools/judge-jz.js <书名> --pages=8-36 [--conc=2]'); process.exit(1); }
const dpi = parseInt(flags.dpi || '150', 10);
const conc = parseInt(flags.conc || '2', 10);
const [pStart, pEnd] = String(flags.pages).split('-').map(Number);
const dataDir = path.join(__dirname, '..', 'data', workId);
const pdfDir = path.join(INPUT_DATA, workId, '当涂郡本_pdf');
const outPath = path.join(dataDir, 'jz.json');
function pad(n) { return String(n).padStart(4, '0'); }

// 断点：已判页跳过
let done = {};
if (fs.existsSync(outPath)) { try { JSON.parse(fs.readFileSync(outPath, 'utf8')).pages.forEach(p => done[p.n] = p); } catch {} }

(async () => {
  const queue = [];
  for (let pg = pStart; pg <= (pEnd || pStart); pg++) if (!done[pg]) queue.push(pg);
  console.log(`经注判定：共 ${pEnd - pStart + 1} 页，已判 ${Object.keys(done).length}，待判 ${queue.length}，conc=${conc}`);
  let idx = 0, cnt = 0;
  async function worker() {
    while (idx < queue.length) {
      const pg = queue[idx++];
      const pdfPath = path.join(pdfDir, `page_${pad(pg)}.pdf`);
      if (!fs.existsSync(pdfPath)) { console.log(`page_${pad(pg)} 缺PDF`); continue; }
      try {
        const { b64 } = renderPage(pdfPath, 1, dpi);
        const r = await judgeJZ(b64, workId.replace('章句', '章句'));
        cnt++;
        if (r.err || !r.obj) { console.log(`page_${pad(pg)}: ${r.err || '解析失败'}`); continue; }
        const cols = Array.isArray(r.obj) ? r.obj : [];
        done[pg] = { n: pg, engine: r.engine, conf: r.conf, cols };
        const j = cols.filter(c => c.type === 'j').length, z = cols.filter(c => c.type === 'z').length;
        console.log(`page_${pad(pg)}: ${cols.length}列 经${j}/注${z} conf=${(r.conf || 0).toFixed(2)} (${r.engine}) [${cnt}/${queue.length}]`);
        // 增量保存（断点）
        fs.writeFileSync(outPath, JSON.stringify({ work: workId, pages: Object.values(done).sort((a, b) => a.n - b.n) }, null, 2));
      } catch (e) { console.log(`page_${pad(pg)}: 失败 ${e.message}`); }
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  const pages = Object.values(done).sort((a, b) => a.n - b.n);
  fs.writeFileSync(outPath, JSON.stringify({ work: workId, pages }, null, 2));
  const totalJ = pages.reduce((s, p) => s + (p.cols || []).filter(c => c.type === 'j').length, 0);
  const totalZ = pages.reduce((s, p) => s + (p.cols || []).filter(c => c.type === 'z').length, 0);
  console.log(`✓ jz.json：${pages.length} 页，经 ${totalJ} 列 / 注 ${totalZ} 列`);
})().catch(e => { console.error('✗', e); process.exit(1); });
