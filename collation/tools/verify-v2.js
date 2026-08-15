#!/usr/bin/env node
/**
 * collation · M2 收尾·覆校仲裁（tools/verify-v2.js）
 * 读 pending-verify.json（真疑难差异，带上下文），按页分组 → 每页渲染善本扫描 +
 * verifyChars 批量问"善本实印何字"（初校开思考，conf低升覆校）→ 直改回填 shanben-v2.json（终态唯一）
 * + verify-report.json（留痕，含维持/改字/待人工）。
 *
 * 用法: node collation/tools/verify-v2.js <书名> [--conc=3] [--limit=N]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { renderPage, verifyChars } = require('../src/vision');
const { INPUT_DATA, loadConfig } = require('../src/io');

const args = process.argv.slice(2);
const flags = {}, pos = [];
for (const a of args) { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) flags[m[1]] = m[2] ?? true; else pos.push(a); }
const workId = pos[0];
if (!workId) { console.error('用法: node collation/tools/verify-v2.js <书名> [--conc=3] [--limit=N]'); process.exit(1); }
const dataDir = path.join(__dirname, '..', 'data', workId);
const pending = JSON.parse(fs.readFileSync(path.join(dataDir, 'pending-verify.json'), 'utf8'));
const v2 = JSON.parse(fs.readFileSync(path.join(dataDir, 'shanben-v2.json'), 'utf8'));
const limit = parseInt(flags.limit || '0', 10);
const conc = parseInt(flags.conc || '3', 10);

const { editions, works } = loadConfig();
const pdfDir = path.join(INPUT_DATA, workId, editions[works[workId].shanben].pdfDir);
function pad(n) { return String(n).padStart(4, '0'); }

// 按页分组
const byPage = {};
pending.forEach(p => { (byPage[p.page] = byPage[p.page] || []).push(p); });
const pageList = Object.keys(byPage).map(Number).sort((a, b) => a - b);
let queue = pageList.slice(0, limit || pageList.length);

(async () => {
  const report = [];
  let idx = 0, done = 0;
  async function worker() {
    while (idx < queue.length) {
      const pg = queue[idx++];
      const items = byPage[pg];
      const pdfPath = path.join(pdfDir, `page_${pad(pg)}.pdf`);
      try {
        const { b64 } = renderPage(pdfPath, 1, 150);
        const r = await verifyChars(b64, items);
        done++;
        if (r.deferred || r.err || !r.obj) { console.log(`page_${pad(pg)}: ${r.err || r.reason || '解析失败'}`); items.forEach(it => report.push({ ...it, verdict: 'deferred' })); continue; }
        const arr = Array.isArray(r.obj) ? r.obj : [r.obj];
        items.forEach((it, k) => {
          const a = arr.find(x => x.i === k + 1) || arr[k];
          const real = a && a.char;
          const changed = real && real !== it.old;
          report.push({ ...it, char: real, conf: a && a.conf, note: a && a.note, engine: r.engine, changed: !!changed });
          if (changed) {  // 善本实字 ≠ 旧OCR → 回填 shanben-v2
            const pgObj = v2.pages.find(x => x.n === pg);
            if (pgObj && pgObj.text[it.ai] === it.old) pgObj.text = pgObj.text.slice(0, it.ai) + real + pgObj.text.slice(it.ai + 1);
          }
        });
        console.log(`page_${pad(pg)}: ${items.length} 处仲裁 (${r.engine}) [${done}/${queue.length}]`);
      } catch (e) { console.log(`page_${pad(pg)}: 失败 ${e.message}`); items.forEach(it => report.push({ ...it, verdict: 'error', note: String(e.message) })); }
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  // ③ 终态唯一：直改 shanben-v2.json（不再产出 -final 中间态；build-v2 重跑亦按 verify-report 应用，幂等）
  fs.writeFileSync(path.join(dataDir, 'shanben-v2.json'), JSON.stringify(v2, null, 2));
  fs.writeFileSync(path.join(dataDir, 'verify-report.json'), JSON.stringify(report, null, 2));
  const changed = report.filter(x => x.changed).length;
  const deferred = report.filter(x => x.verdict === 'deferred' || x.verdict === 'error').length;
  console.log(`✓ 覆校 ${report.length} 处：改字 ${changed}（旧OCR误读，已回填善本实字）、维持旧 ${report.length - changed - deferred}、失败/待人工 ${deferred}`);
  console.log('  → shanben-v2.json（终态）+ verify-report.json');
})().catch(e => { console.error('✗', e); process.exit(1); });
