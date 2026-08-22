#!/usr/bin/env node
/**
 * collation · 逐格转写（tools/grid-transcribe.js）——版面逐格还原
 * 对善本正文页逐页 gridTranscribe（逐格：col/row/char/start），
 * 产 grid-transcribe.json（页×格×{col,row,char,start}）。
 * 用于验证逐格数据能否严格还原 16×15 版面。
 *
 * 用法: node collation/tools/grid-transcribe.js <书名> --pages=8-36 [选项]
 *   --force-deep: 强制使用覆校模型（qwen3.8-max），跳过初校
 *   --endpoint=URL: 自定义 API 端点
 *   --model=NAME: 自定义模型名称
 *   --api-key=KEY: 自定义 API key（或设置环境变量）
 *   --suffix=NAME: 输出文件后缀（如 --suffix=gpt5，输出 grid-transcribe-gpt5.json）
 *   --input-price=N: 输入价格（元/百万token 或 美元/百万token）
 *   --output-price=N: 输出价格
 *   --currency=USD|CNY: 货币单位（默认 CNY）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { renderPage, gridTranscribe } = require('../src/vision');
const { INPUT_DATA, loadConfig, pagePdfPath, inputBookOf } = require('../src/io');
const { loadM2Base } = require('../src/base');

const args = process.argv.slice(2);
const flags = {}, pos = [];
for (const a of args) { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) flags[m[1]] = m[2] ?? true; else pos.push(a); }
const workId = pos[0];
if (!workId || !flags.pages) { console.error('用法: node collation/tools/grid-transcribe.js <书名> --pages=8-36 [选项]'); process.exit(1); }
const conc = parseInt(flags.conc || '1', 10);
const imageDir = flags['image-dir'] ? path.resolve(String(flags['image-dir'])) : null;
const forceDeep = !!flags['force-deep'];
const customEndpoint = flags.endpoint || null;
const customModel = flags.model || null;
const customKey = flags['api-key'] || process.env.CUSTOM_API_KEY || process.env.TEAMO_API_KEY || null;
const suffix = flags.suffix ? '-' + flags.suffix : '';
const currency = (flags.currency || 'CNY').toUpperCase();
const inputPrice = parseFloat(flags['input-price'] || '0');
const outputPrice = parseFloat(flags['output-price'] || '0');

const dataDir = path.join(__dirname, '..', 'data', workId);
const m2 = loadM2Base(workId);
const layoutFile = path.join(dataDir, 'layout.json');
const savedLayout = fs.existsSync(layoutFile) ? JSON.parse(fs.readFileSync(layoutFile, 'utf8')) : {};
const layout = { cols: parseInt(flags.cols || savedLayout.cols || '16', 10), rows: parseInt(flags.rows || savedLayout.rows || '15', 10) };
const [pStart, pEnd] = String(flags.pages).split('-').map(Number);
const { editions, works } = loadConfig();
// PDF 页路径：平铺优先，分卷书（input_data/<书>/<卷>/）按页码路由（io.pagePdfPath）
const outPath = path.join(dataDir, `grid-transcribe${suffix}.json`);
const logPath = path.join(dataDir, `grid-transcribe${suffix}-log.json`);
function pad(n) { return String(n).padStart(4, '0'); }
function pageImage(pg) {
  if (!imageDir) return null;
  const names = [`page_${pad(pg)}.png`, `page-${pad(pg)}.png`, `${pad(pg)}.png`];
  const file = names.map(n => path.join(imageDir, n)).find(fs.existsSync);
  if (!file) throw new Error(`找不到预渲染页图：${names.join(' / ')}（目录 ${imageDir}）`);
  return fs.readFileSync(file).toString('base64');
}

// 费用计算
const PRICING = {
  'qwen3.8-max': { input: 12, output: 36, currency: 'CNY' },
  'qwen3.7-plus': { input: 2, output: 8, currency: 'CNY' },
};
function calcCost(model, usage) {
  if (!usage) return 0;
  let pricing;
  if (inputPrice > 0 || outputPrice > 0) {
    pricing = { input: inputPrice, output: outputPrice, currency };
  } else {
    pricing = PRICING[model] || { input: 36, output: 36, currency: 'CNY' };
  }
  const inputCost = (usage.prompt_tokens || 0) / 1000000 * pricing.input;
  const outputCost = (usage.completion_tokens || 0) / 1000000 * pricing.output;
  return { cost: inputCost + outputCost, currency: pricing.currency };
}

let done = {};
let pageLogs = [];
if (fs.existsSync(outPath)) {
  try {
    const old = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    if (old.base?.sha256 === m2.sha256) old.pages.forEach(p => done[p.n] = p);
    else console.log(`⚠ grid-transcribe${suffix}.json 属旧 M2 底本，清空旧页并重跑`);
  } catch {}
}
if (fs.existsSync(logPath)) {
  try {
    const oldLog = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    if (oldLog.base?.sha256 === m2.sha256) pageLogs = oldLog.logs || [];
    else pageLogs = [];
  } catch {}
}

const gridFile = path.join(dataDir, 'grid.json');
const grid = fs.existsSync(gridFile) ? JSON.parse(fs.readFileSync(gridFile, 'utf8')) : { pages: [] };

(async () => {
  const queue = [];
  for (let pg = pStart; pg <= (pEnd || pStart); pg++) if (!done[pg]) queue.push(pg);
  const modelDisplay = customModel || (forceDeep ? '覆校(qwen3.8-max)' : '初校→覆校自动路由');
  console.log(`逐格转写：${pStart}-${pEnd} 页，已完成 ${Object.keys(done).length}，待转 ${queue.length}，conc=${conc}，网格 ${layout.cols}×${layout.rows}`);
  console.log(`模型: ${modelDisplay}`);
  if (customEndpoint) console.log(`端点: ${customEndpoint}`);
  let idx = 0, cnt = 0;
  async function worker() {
    while (idx < queue.length) {
      const pg = queue[idx++];
      const pdfPath = pagePdfPath(inputBookOf(workId), editions[works[workId].shanben].pdfDir, pg);
      if (!fs.existsSync(pdfPath)) continue;
      try {
        const startTime = Date.now();
        const rendered = imageDir ? { b64: pageImage(pg) } : (await renderPage(pdfPath, 1, 150));
        const b64 = rendered.b64;
        const renderTime = Date.now() - startTime;
        
        const apiStart = Date.now();
        const r = await gridTranscribe(b64, layout, { 
          forceDeep, 
          customEndpoint, 
          customModel, 
          customKey 
        });
        const apiTime = Date.now() - apiStart;
        // 清理 pdftoppm 临时 PNG（renderPage 写 os.tmpdir()/vpage-XXXX，用完即删防 /tmp 占满）
        if (!imageDir && rendered.file) { try { fs.rmSync(path.dirname(rendered.file), { recursive: true, force: true }); } catch {} }
        
        cnt++;
        if (r.err || !r.obj) { console.log(`page_${pad(pg)}: ${r.err || '解析失败'}`); continue; }
        const cells = Array.isArray(r.obj) ? r.obj : [];
        const filled = cells.filter(c => c.char && c.char.trim());
        const empty = cells.filter(c => !c.char || !c.char.trim());
        const colSet = new Set(cells.map(c => c.col));
        done[pg] = { n: pg, engine: r.engine, conf: r.conf, cells };
        
        const model = customModel || (r.engine?.match(/覆校\(([^)]+)\)|初校\(([^)]+)\)/)?.[1] || r.engine?.match(/覆校\(([^)]+)\)|初校\(([^)]+)\)/)?.[2] || 'unknown');
        const { cost, currency: costCurrency } = calcCost(model, r.usage);
        
        const logEntry = {
          page: pg,
          engine: r.engine,
          model,
          usage: r.usage,
          cost,
          currency: costCurrency,
          filled: filled.length,
          empty: empty.length,
          cells: cells.length,
          renderTime,
          apiTime,
          totalTime: renderTime + apiTime,
        };
        pageLogs.push(logEntry);
        
        const conf = typeof r.conf === 'number' ? r.conf.toFixed(2) : 'n/a';
        const tokens = r.usage ? `输入${r.usage.prompt_tokens || 0}/输出${r.usage.completion_tokens || 0}` : 'n/a';
        const costStr = `${costCurrency === 'USD' ? '$' : '¥'}${cost.toFixed(4)}`;
        console.log(`page_${pad(pg)}: ${colSet.size}列 填充${filled.length}格/空${empty.length}格 conf=${conf} (${r.engine}) tokens[${tokens}] 费用${costStr} 耗时${(logEntry.totalTime/1000).toFixed(1)}s [${cnt}/${queue.length}]`);
        
        fs.writeFileSync(outPath, JSON.stringify({
          work: workId,
          model: customModel || null,
          endpoint: customEndpoint || null,
          base: { file: 'shanben-v2.json', sha256: m2.sha256, pendingVerify: m2.pendingCount },
          layout,
          pages: Object.values(done).sort((a, b) => a.n - b.n)
        }, null, 2));
        fs.writeFileSync(logPath, JSON.stringify({
          work: workId,
          model: customModel || null,
          endpoint: customEndpoint || null,
          base: { file: 'shanben-v2.json', sha256: m2.sha256, pendingVerify: m2.pendingCount },
          logs: pageLogs
        }, null, 2));
      } catch (e) { console.log(`page_${pad(pg)}: 失败 ${e.message}`); }
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  const pages = Object.values(done).sort((a, b) => a.n - b.n);
  fs.writeFileSync(outPath, JSON.stringify({
    work: workId,
    model: customModel || null,
    endpoint: customEndpoint || null,
    base: { file: 'shanben-v2.json', sha256: m2.sha256, pendingVerify: m2.pendingCount },
    layout,
    pages
  }, null, 2));
  
  // 汇总统计
  let totalCells = 0, totalFilled = 0, totalEmpty = 0;
  pages.forEach(p => {
    totalCells += p.cells.length;
    totalFilled += p.cells.filter(c => c.char && c.char.trim()).length;
    totalEmpty += p.cells.filter(c => !c.char || !c.char.trim()).length;
  });
  
  const totalInputTokens = pageLogs.reduce((s, l) => s + (l.usage?.prompt_tokens || 0), 0);
  const totalOutputTokens = pageLogs.reduce((s, l) => s + (l.usage?.completion_tokens || 0), 0);
  const totalCost = pageLogs.reduce((s, l) => s + l.cost, 0);
  const avgCost = pageLogs.length ? totalCost / pageLogs.length : 0;
  const avgTime = pageLogs.length ? pageLogs.reduce((s, l) => s + l.totalTime, 0) / pageLogs.length / 1000 : 0;
  const cur = pageLogs[0]?.currency || 'CNY';
  const curSymbol = cur === 'USD' ? '$' : '¥';
  
  console.log(`\n✓ grid-transcribe${suffix}.json：${pages.length} 页，总格 ${totalCells}（填充 ${totalFilled} / 空 ${totalEmpty}）`);
  console.log(`\n=== 费用统计 ===`);
  console.log(`总输入 token: ${totalInputTokens.toLocaleString()}`);
  console.log(`总输出 token: ${totalOutputTokens.toLocaleString()}`);
  console.log(`总费用: ${curSymbol}${totalCost.toFixed(4)}`);
  console.log(`平均每页输入: ${pageLogs.length ? Math.round(totalInputTokens / pageLogs.length).toLocaleString() : 0} token`);
  console.log(`平均每页输出: ${pageLogs.length ? Math.round(totalOutputTokens / pageLogs.length).toLocaleString() : 0} token`);
  console.log(`平均每页费用: ${curSymbol}${avgCost.toFixed(4)}`);
  console.log(`平均每页耗时: ${avgTime.toFixed(1)}s`);
  
  const daxuePages = grid.pages?.length || 39;
  const zhongyongPages = 78;
  console.log(`\n=== 预测全书费用 ===`);
  console.log(`当前样本: ${pageLogs.length} 页`);
  console.log(`大学章句 (${daxuePages} 页): ${curSymbol}${(avgCost * daxuePages).toFixed(2)}`);
  console.log(`中庸章句 (${zhongyongPages} 页): ${curSymbol}${(avgCost * zhongyongPages).toFixed(2)}`);
  console.log(`两书合计: ${curSymbol}${(avgCost * (daxuePages + zhongyongPages)).toFixed(2)}`);
})().catch(e => { console.error('✗', e); process.exit(1); });
