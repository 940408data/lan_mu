#!/usr/bin/env node
/**
 * collation · M2 收尾·覆校仲裁（tools/verify-v2.js）
 * 读 pending-verify.json（真疑难差异，带上下文），按页分组 → 每页渲染善本扫描 +
 * verifyChars 批量问"善本实印何字"（初校开思考，conf低升覆校）→ 直改回填 shanben-v2.json（终态唯一）
 * + verify-report.json（留痕，含维持/改字/待人工）。
 *
 * 用法: node collation/tools/verify-v2.js <书名> [--conc=3] [--limit=N]
 *       [--start-page=N] [--page-count=N] [--image-dir=DIR]
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
const startPage = flags['start-page'] == null ? null : parseInt(flags['start-page'], 10);
const pageCount = flags['page-count'] == null ? null : parseInt(flags['page-count'], 10);
const imageDir = flags['image-dir'] ? path.resolve(String(flags['image-dir'])) : null;
if (startPage != null && !Number.isFinite(startPage)) throw new Error('--start-page 必须是数字');
if (pageCount != null && (!Number.isFinite(pageCount) || pageCount < 1)) throw new Error('--page-count 必须是正整数');

const { editions, works } = loadConfig();
const pdfDir = path.join(INPUT_DATA, workId, editions[works[workId].shanben].pdfDir);
function pad(n) { return String(n).padStart(4, '0'); }

// 按页分组
const byPage = {};
pending.forEach(p => { (byPage[p.page] = byPage[p.page] || []).push(p); });
const pageList = Object.keys(byPage).map(Number).sort((a, b) => a - b);
// 分批按物理页号选择，便于中途审阅和断点续跑；--limit 保留为“前 N 页”兼容参数。
let queue = pageList.filter(pg => startPage == null || pg >= startPage);
if (pageCount != null && startPage != null) queue = queue.filter(pg => pg < startPage + pageCount);
if (limit) queue = queue.slice(0, limit);
function itemKey(x) { return `${x.page}:${x.ai}`; }
function pageImage(pg) {
  if (!imageDir) return null;
  const names = [`page_${pad(pg)}.png`, `page-${pad(pg)}.png`, `${pad(pg)}.png`];
  const file = names.map(n => path.join(imageDir, n)).find(fs.existsSync);
  if (!file) throw new Error(`找不到预渲染页图：${names.join(' / ')}（目录 ${imageDir}）`);
  return fs.readFileSync(file).toString('base64');
}

(async () => {
  // verify-report 是累计审查日志。当前批次只替换所选页，保留已完成批次，
  // 这样可安全地按页重跑，也不会让后续 build-v2 丢失此前已确认的实字。
  const reportPath = path.join(dataDir, 'verify-report.json');
  let report = [];
  if (fs.existsSync(reportPath)) {
    const prior = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    if (Array.isArray(prior)) report = prior;
  }
  const queuePages = new Set(queue);
  report = report.filter(x => !queuePages.has(Number(x.page)));
  const batchReport = [];
  let idx = 0, done = 0;
  async function worker() {
    while (idx < queue.length) {
      const pg = queue[idx++];
      const items = byPage[pg];
      const pdfPath = path.join(pdfDir, `page_${pad(pg)}.pdf`);
      try {
        // 受限运行环境中 Node 不能创建 pdftoppm 子进程；用 --image-dir
        // 可由外部先渲染 PNG，再把同一页送入视觉模型。正常环境仍保留内置渲染。
        const b64 = imageDir ? pageImage(pg) : renderPage(pdfPath, 1, 150).b64;
        const r = await verifyChars(b64, items);
        done++;
        if (r.deferred || r.err || !r.obj) { console.log(`page_${pad(pg)}: ${r.err || r.reason || '解析失败'}`); items.forEach(it => batchReport.push({ ...it, verdict: 'deferred' })); continue; }
        const arr = Array.isArray(r.obj) ? r.obj : [r.obj];
        items.forEach((it, k) => {
          const a = arr.find(x => x.i === k + 1) || arr[k];
          const real = a && a.char;
          const changed = real && real !== it.old;
          batchReport.push({ ...it, char: real, conf: a && a.conf, note: a && a.note, engine: r.engine, changed: !!changed });
          if (changed) {  // 善本实字 ≠ 旧OCR → 回填 shanben-v2
            const pgObj = v2.pages.find(x => x.n === pg);
            if (pgObj && pgObj.text[it.ai] === it.old) pgObj.text = pgObj.text.slice(0, it.ai) + real + pgObj.text.slice(it.ai + 1);
          }
        });
        console.log(`page_${pad(pg)}: ${items.length} 处仲裁 (${r.engine}) [${done}/${queue.length}]`);
      } catch (e) { console.log(`page_${pad(pg)}: 失败 ${e.message}`); items.forEach(it => batchReport.push({ ...it, verdict: 'error', note: String(e.message) })); }
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  // ③ 终态唯一：直改 shanben-v2.json（不再产出 -final 中间态；build-v2 重跑亦按 verify-report 应用，幂等）
  report.push(...batchReport);
  report.sort((a, b) => Number(a.page) - Number(b.page) || Number(a.ai) - Number(b.ai));
  fs.writeFileSync(path.join(dataDir, 'shanben-v2.json'), JSON.stringify(v2, null, 2));
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  // pending 是可续跑队列：已拿到实字（含“维持旧 OCR”）的条目移出，
  // 未处理页及 deferred/error 条目保留，避免分批 --limit 覆校时误报已完成。
  const reported = new Map(report.map(x => [itemKey(x), x]));
  const remaining = pending.filter(it => {
    const r = reported.get(itemKey(it));
    return !r || !r.char || r.verdict === 'deferred' || r.verdict === 'error';
  });
  fs.writeFileSync(path.join(dataDir, 'pending-verify.json'), JSON.stringify(remaining, null, 2));
  const changed = batchReport.filter(x => x.changed).length;
  const deferred = batchReport.filter(x => x.verdict === 'deferred' || x.verdict === 'error').length;
  console.log(`✓ 本批覆校 ${batchReport.length} 处：改字 ${changed}（旧OCR误读，已回填善本实字）、维持旧 ${batchReport.length - changed - deferred}、失败/待人工 ${deferred}`);
  console.log(`  → 累计报告 ${report.length} 处；shanben-v2.json（终态）+ verify-report.json；pending-verify 剩余 ${remaining.length} 条`);
})().catch(e => { console.error('✗', e); process.exit(1); });
