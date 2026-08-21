#!/usr/bin/env node
/**
 * collation · 网格基精校台生成器（tools/grid-review.js）
 * 从「基础层 grid-transcribe + overlay（参校/标签）」生成单文件离线 HTML：
 *   - 每页 16×15 竖排网格（direction:rtl，列自右向左，同宋刻版面）
 *   - 经(j)大字/注(z)小字/章题(title)底色，疑问格红框标注（sub/extra/夺文锚点）
 *   - 点击疑问格 → 面板显示：格字、旧OCR字、现代点校字、机器参考建议、人工选择（可保存本地）
 *   - 列级纵偏移（colShifts）：视觉识别整列错位时，调列首一格，全列实时联动
 *   - 句子级夺文（missing runs）单独列表可裁
 *   - 导出裁决 JSON → tools/grid-review-merge.js 合入 overlay.fixes（唯一改字通道）
 *
 * 布局：右侧悬浮栏（rail）承载全部控件，为版面让出左侧全幅空间（参考 songke-facsimile 引擎）。
 * 输出到私有目录 input_data/<书>/_derived/collation/output/（含现代本字，不入公开产物）。
 * 用法:
 *   node collation/tools/grid-review.js <书名> [--image-dir=DIR] [--open]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { privateWorkDir } = require('../src/paths');

const args = process.argv.slice(2);
const flags = {}, pos = [];
for (const a of args) { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) flags[m[1]] = m[2] ?? true; else pos.push(a); }
const workId = pos[0];
if (!workId) { console.error('用法: node collation/tools/grid-review.js <书名> [--image-dir=DIR]'); process.exit(1); }
const dataDir = path.join(__dirname, '..', 'data', workId);

// ── 装载基础层 + overlay ──
const tr = JSON.parse(fs.readFileSync(path.join(dataDir, 'grid-transcribe.json'), 'utf8'));
const ov = JSON.parse(fs.readFileSync(path.join(dataDir, 'grid-overlay.json'), 'utf8'));

// 疑问索引：坐标 → 意见
const qIdx = new Map(); // "p:c:r" -> {old, modern, extraOld, extraMod}
const put = (p, c, r, k, v) => {
  const key = `${p}:${c}:${r}`;
  if (!qIdx.has(key)) qIdx.set(key, {});
  qIdx.get(key)[k] = v;
};
for (const s of ov.variants.oldOcr.sub || []) put(s.page, s.col, s.row, 'old', s.old);
for (const s of ov.variants.modern?.sub || []) put(s.page, s.col, s.row, 'modern', s.modern);
for (const e of ov.variants.oldOcr.extra || []) put(e.page, e.col, e.row, 'extraOld', true);
for (const e of ov.variants.modern?.extra || []) put(e.page, e.col, e.row, 'extraMod', true);
// 夺文 run 挂 after 格
const runs = [];
for (const [src, key] of [['oldOcr', '旧OCR'], ['modern', '今本']]) {
  if (!ov.variants[src]) continue;
  for (const m of ov.variants[src].missing || []) {
    runs.push({ src, srcLabel: key, page: m.page, after: m.after, text: m.text, whole: !!m.whole });
    if (m.after) put(m.page, m.after.col, m.after.row, 'missAfter', { src: key, text: m.text });
  }
}
// 标签索引："p:c" -> role
const lab = new Map((ov.labels || []).map(l => [`${l.page}:${l.col}`, l.role]));

// ── G4 校书官意见索引（若已跑 grid-officer.js；基础层指纹锁） ──
let officerIdx = null, officerEngine = null;
const offFile = path.join(privateWorkDir(workId), 'grid-officer.json');
if (fs.existsSync(offFile)) {
  try {
    const off = JSON.parse(fs.readFileSync(offFile, 'utf8'));
    if (off.baseSha256 === ov.base.sha256) {
      officerEngine = off.engine || 'unknown';
      officerIdx = new Map();
      for (const v of off.verdicts || []) {
        if (v.page == null) continue;
        officerIdx.set(`${v.page}:${v.col}:${v.row}`, {
          type: v.type, verdict: v.verdict, adopt: v.adopt, tentative: v.tentative,
          suspendReasons: v.suspendReasons || [],
          opinions: (v.opinions || []).map(o => ({ name: o.name || o.officer, adopt: o.adopt, candidate: o.candidate, grade: o.grade, confidence: o.confidence, reason: (o.reason || '').slice(0, 60) })),
        });
      }
    }
  } catch (e) { console.log('⚠ grid-officer.json 解析失败，忽略：' + e.message); }
}

// ── 可选书影（base64 内嵌） ──
let images = null;
if (flags['image-dir']) {
  const dir = path.resolve(String(flags['image-dir']));
  const pad = n => String(n).padStart(4, '0');
  images = {};
  for (const pg of tr.pages) {
    const f = [`page_${pad(pg.n)}.png`, `page-${pad(pg.n)}.png`, `${pad(pg.n)}.png`].map(n => path.join(dir, n)).find(fs.existsSync);
    if (f) images[pg.n] = 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
  }
  console.log(`书影内嵌 ${Object.keys(images).length} 页（目录 ${dir}）`);
}

// ── 组装数据 ──
const pages = tr.pages.map(pg => ({
  n: pg.n,
  cols: Math.max(...pg.cells.map(c => c.col || 0), 0),
  rows: Math.max(...pg.cells.map(c => c.row || 0), 0),
  cells: pg.cells
    .filter(c => (c.char || '').trim())
    .map(c => {
      const role = lab.get(`${pg.n}:${c.col}`) || 'z';
      const q = qIdx.get(`${pg.n}:${c.col}:${c.row}`) || null;
      if (q && officerIdx) q.officer = officerIdx.get(`${pg.n}:${c.col}:${c.row}`) || null;
      return { c: c.col, r: c.row, ch: [...c.char.trim()][0], role, q };
    }),
}));

const DATA = {
  work: workId,
  baseSha: ov.base.sha256,
  meta: { cells: ov.stats.cells, pages: pages.length, runs: runs.length, qCells: qIdx.size, officer: officerEngine ? { engine: officerEngine, count: officerIdx.size } : null },
  pages, runs,
  colShifts: Array.isArray(ov.colShifts) ? ov.colShifts : [],   // 既有列纵偏移（overlay 持久化）
  colDels: Array.isArray(ov.colDels) ? ov.colDels : [],         // 既有列内删字（overlay 持久化）
  images, // 可能很大；无 --image-dir 时为 null
};

const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${workId} · 网格基精校台</title>
<style>
  :root { --cell: 36px; --gap: 0px; --rail-w: 17.5rem; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "LXGW WenKai TC", "Kaiti TC", Kaiti, serif; background: #f6f1e4; color: #2c2416; padding-right: var(--rail-w); }

  /* ── 右侧悬浮栏（参考 songke-facsimile 引擎 .rail） ── */
  .rail { position: fixed; right: 0; top: 0; bottom: 0; width: var(--rail-w); z-index: 20; background: #efe6d0; border-left: 2px solid #c9b98a; padding: 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 9px; box-shadow: -8px 0 22px -14px rgba(60,45,20,.4); transition: transform .3s ease, opacity .25s; }
  .rail.off { transform: translateX(103%); opacity: 0; pointer-events: none; }
  /* 右缘竖式小签：悬浮栏隐藏后唯留的唤出控件 */
  #railToggle { position: fixed; right: 0; top: 40%; z-index: 19; writing-mode: vertical-rl; font-family: inherit; font-size: 13px; letter-spacing: .2em; color: #6b5a3e; background: #efe6d0; border: 1px solid #c9b98a; border-right: none; padding: 12px 4px; border-radius: 4px 0 0 4px; cursor: pointer; box-shadow: -3px 0 8px rgba(60,45,20,.25); }
  #railToggle:hover { background: #e6d9ba; }
  .rail h1 { font-size: 15px; margin: 0; line-height: 1.4; }
  .rail .sec { border-top: 1px solid #d8c8a0; padding-top: 8px; display: flex; flex-direction: column; gap: 6px; }
  .rail .micro { font-size: 11px; color: #9a8a66; letter-spacing: .04em; }
  #stats { font-size: 12px; color: #6b5a3e; line-height: 1.6; }
  .rail label.chk { font-size: 13px; display: flex; gap: 6px; align-items: center; cursor: pointer; }
  .fld { display: flex; align-items: center; gap: 7px; font-size: 13px; }
  .fld input[type=range] { flex: 1; accent-color: #b9a671; }
  .fld .val { font-size: 12px; color: #6b5a3e; min-width: 34px; text-align: right; }
  button { font: inherit; font-size: 13px; padding: 5px 10px; border: 1px solid #b9a671; background: #fffaf0; border-radius: 4px; cursor: pointer; }
  button:hover { background: #f3e8c8; }
  button.active { background: #d8c48a; }
  button.mini { font-size: 12px; padding: 2px 8px; }

  main { padding: 14px 18px; }
  .page { margin: 0 0 28px; }
  .page-h { font-size: 14px; color: #6b5a3e; margin: 0 0 6px; display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
  .page-h b { color: #2c2416; font-size: 15px; }
  .flexrow { display: flex; gap: 18px; align-items: flex-start; flex-wrap: wrap; }
  .sheet { display: inline-grid; grid-template-columns: repeat(var(--cols, 16), var(--cell)); grid-template-rows: repeat(var(--rows, 15), var(--cell)); direction: rtl; gap: var(--gap); background: #fffdf6; border: 1px solid #cbbd97; padding: 2px; box-shadow: 0 1px 3px rgba(60,45,20,.15); }
  .cell { width: var(--cell); height: var(--cell); display: flex; align-items: center; justify-content: center; border-radius: 2px; user-select: none; }
  .cell.j { font-size: calc(var(--cell) * .62); font-weight: 700; }
  .cell.z { font-size: calc(var(--cell) * .55); color: #382d1e; }
  .cell.title { background: #f1e2b8; }
  .cell.q { cursor: pointer; outline: 2px solid #c0392b; outline-offset: -1px; }
  .cell.q-old-only { outline-color: #d68910; }
  .cell.q-extra { outline-style: dashed; }
  .cell.q-miss { outline-color: #8e44ad; outline-style: dotted; }
  .cell.done { outline-color: #1e8449 !important; }
  .show-shift .cell.shifted { box-shadow: inset 0 0 0 2px #16a085; }
  /* 已删字：半透明 + 删除线，仍可点击恢复 */
  .cell.del { opacity: .32; text-decoration: line-through; outline: 1px dashed #c0392b; outline-offset: -1px; cursor: pointer; }
  .cell:hover { background: #fdf0d5; }
  .pageimg { max-height: 560px; border: 1px solid #cbbd97; background: #fff; }

  /* ── 裁决面板（停靠在右栏左缘） ── */
  #panel { position: fixed; right: var(--rail-w); top: 0; bottom: 0; width: 340px; background: #fffdf4; border-left: 2px solid #c9b98a; box-shadow: -2px 0 8px rgba(60,45,20,.18); padding: 14px; display: none; overflow-y: auto; z-index: 25; }
  #panel h3 { margin: 0 0 8px; font-size: 15px; }
  #panel .big { font-size: 42px; text-align: center; margin: 6px 0; }
  #panel table { width: 100%; border-collapse: collapse; font-size: 14px; margin: 6px 0; }
  #panel td { border: 1px solid #dccf9f; padding: 4px 6px; }
  #sugg { background: #f3ecda; border: 1px dashed #b9a671; padding: 6px 8px; font-size: 13px; margin: 8px 0; border-radius: 4px; line-height: 1.55; }
  label.choice { display: block; margin: 4px 0; font-size: 14px; cursor: pointer; }
  textarea { width: 100%; height: 44px; font: inherit; font-size: 13px; }
  .shiftbox { background: #eef3ea; border: 1px solid #9bbf9a; border-radius: 4px; padding: 7px 8px; margin: 8px 0; }
  .shiftbox .srow { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
  .shiftbox .shint { font-size: 12px; color: #7d6608; margin-top: 5px; line-height: 1.5; }
  #runs li { margin: 6px 0; font-size: 14px; cursor: pointer; border: 1px solid #dccf9f; border-radius: 4px; padding: 4px 6px; }
  #runs li:hover { background: #fdf0d5; }
  .tag { display: inline-block; font-size: 11px; border-radius: 3px; padding: 0 4px; color: #fff; }
  .tag.mod { background: #c0392b; } .tag.old { background: #d68910; } .tag.extra { background: #7d6608; } .tag.miss { background: #8e44ad; } .tag.shift { background: #16a085; }
  .hide { display: none !important; }
  @media (max-width: 860px) {
    body { padding-right: 0; }
    .rail { position: static; width: auto; box-shadow: none; }
    #panel { right: 0; width: min(340px, 100vw); }
  }
</style>
</head>
<body>
<aside class="rail" id="rail">
  <h1>${workId} · 网格基精校台</h1>
  <span id="stats"></span>
  <div class="sec">
    <label class="chk"><input type="checkbox" id="onlyQ"> 只看疑问页</label>
    <label class="chk"><input type="checkbox" id="onlyQCell"> 隐藏无疑问格</label>
    <label class="chk"><input type="checkbox" id="showShift"> 高亮已偏移列</label>
  </div>
  <div class="sec">
    <div class="fld"><span class="micro">字号</span><input type="range" id="zoom" min="24" max="60" step="1" value="36"><span class="val" id="zoomVal">36px</span></div>
    <div class="fld"><span class="micro">格距</span><input type="range" id="gapSel" min="0" max="4" step="1" value="0"><span class="val" id="gapVal">0px</span></div>
  </div>
  <div class="sec">
    <button id="btnRuns">句子级夺文清单</button>
    <button id="btnExport">导出裁决 JSON</button>
    <button id="btnShiftReset">清空全部列偏移</button>
    <button id="btnClear">清空本地暂存</button>
  </div>
  <div class="sec micro">列首字：调「本列纵偏移」整列联动（注误为经→ +1）。非列首字：可删字，本格由下一格字占据。</div>
</aside>
<button id="railToggle" type="button" title="展开控制面板">校</button>
<main id="main"></main>
<div id="runsWrap" class="hide"><main><h3 style="font-size:15px">句子级夺文/缺页（参校本多出，格无）</h3><ul id="runs"></ul></main></div>
<div id="panel"></div>
<script>
const DATA = ${JSON.stringify(DATA)};
const LS_KEY = 'grid-review:' + DATA.work + ':' + DATA.baseSha.slice(0, 12);
let decisions = {};   // "p:c:r" -> {choice, custom, note}
let runChoices = {};  // run idx -> {choice, note}
let colShifts = {};   // "p:c" -> 纵偏移（整数；正=下移，负=上移）
let colDels = {};     // "p:c:r" -> true（列内删字：本格由下一格字占据）
for (const s of DATA.colShifts || []) colShifts[s.page + ':' + s.col] = s.shift;
for (const d of DATA.colDels || []) colDels[d.page + ':' + d.col + ':' + d.row] = true;
try { const s = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); decisions = s.decisions || {}; runChoices = s.runs || {}; Object.assign(colShifts, s.colShifts || {}); Object.assign(colDels, s.colDels || {}); } catch (e) {}

const key = c => c.page + ':' + c.c + ':' + c.r;
const shiftKey = (p, c) => p + ':' + c;
const delKey = (p, c, r) => p + ':' + c + ':' + r;
function save() { localStorage.setItem(LS_KEY, JSON.stringify({ decisions, runs: runChoices, colShifts, colDels })); renderStats(); }
function shiftOf(p, c) { return colShifts[shiftKey(p, c)] || 0; }
function clampRow(r, rows) { return Math.max(1, Math.min(rows, r)); }
/* 列首字判定：该列 row 最小者（整列偏移只从列首触发；非列首字用删字） */
function isColHead(pg, c) {
  const rows = pg.cells.filter(x => x.c === c.c).map(x => x.r);
  return rows.length && c.r === Math.min(...rows);
}

/* 列错位智能建议：注(z)应退一格而顶格→疑整体上移，建议 +1 下移；经(j)应顶格而退格→建议 -1 上移 */
function shiftSuggest(pg, col) {
  const role = (pg.cells.find(x => x.c === col) || {}).role;
  const minR = Math.min(...pg.cells.filter(x => x.c === col).map(x => x.r));
  if (!isFinite(minR)) return 0;
  if (role === 'z' && minR === 1) return 1;    // 注列却顶格 → 整列上移了一格
  if (role === 'j' && minR >= 2) return -1;    // 经列却退格 → 整列下移了一格
  return 0;
}

function suggest(q, ch) {
  const parts = [];
  if (q.missAfter) parts.push('【夺文】' + q.missAfter.src + '多出「' + q.missAfter.text.slice(0, 20) + (q.missAfter.text.length > 20 ? '…' : '') + '」——核书影后决定补入或忽略');
  if (q.old != null && q.modern != null && q.old === q.modern && q.old !== ch) parts.push('【建议改字】两参校源一致作「' + q.old + '」，视觉格字「' + ch + '」疑误');
  else if (q.modern != null && (q.old == null || q.old === ch) && q.modern !== ch) parts.push('【建议维持格字】旧OCR与视觉一致，今本作「' + q.modern + '」——真异文候选，人工裁');
  else if (q.old != null && (q.modern == null || q.modern === ch) && q.old !== ch) parts.push('【建议维持格字】今本与视觉一致，旧OCR作「' + q.old + '」疑误读');
  else if (q.old != null && q.modern != null && q.old !== ch && q.modern !== ch && q.old !== q.modern) parts.push('【三源各异】格「' + ch + '」/旧「' + q.old + '」/今「' + q.modern + '」——必裁');
  if (q.extraMod) parts.push('【衍/幻觉候选】格有字而儒藏无——核书影');
  if (q.extraOld) parts.push('【旧OCR缺字】格有字而旧OCR无');
  return parts.length ? parts.join('；') : '无异文';
}

function renderStats() {
  const qTotal = DATA.meta.qCells;
  const done = Object.keys(decisions).length;
  const rDone = Object.keys(runChoices).length;
  const nShift = Object.keys(colShifts).filter(k => colShifts[k] !== 0).length;
  const nDel = Object.keys(colDels).length;
  document.getElementById('stats').textContent = '疑问格 ' + done + '/' + qTotal + ' 已裁 · 夺文句 ' + rDone + '/' + DATA.meta.runs + ' 已裁 · 列偏移 ' + nShift + ' · 删字 ' + nDel + ' · 共 ' + DATA.meta.pages + ' 页' + (DATA.meta.officer ? ' · 校书官 ' + DATA.meta.officer.count + ' 条（' + DATA.meta.officer.engine + '）' : '');
}

function render() {
  const onlyQ = document.getElementById('onlyQ').checked;
  const hidePlain = document.getElementById('onlyQCell').checked;
  const main = document.getElementById('main');
  main.innerHTML = '';
  for (const pg of DATA.pages) {
    const qs = pg.cells.filter(c => c.q && (c.q.old != null || c.q.modern != null || c.q.extraMod || c.q.extraOld || c.q.missAfter));
    const done = qs.filter(c => decisions[key({ page: pg.n, c: c.c, r: c.r })]).length;
    if (onlyQ && !qs.length) continue;
    const sec = document.createElement('div'); sec.className = 'page';
    const hh = document.createElement('div'); hh.className = 'page-h';
    hh.innerHTML = '<b>第 ' + pg.n + ' 页</b><span>' + pg.cols + '列×' + pg.rows + '行</span><span>疑问 <span class="tag mod">' + qs.length + '</span> 已裁 ' + done + '</span>';
    sec.appendChild(hh);
    const row = document.createElement('div'); row.className = 'flexrow';
    const sheet = document.createElement('div'); sheet.className = 'sheet';
    sheet.style.setProperty('--rows', pg.rows);
    sheet.style.setProperty('--cols', pg.cols);
    const colDelCount = {};   // col -> 该列已删格数（后续字 row 上移）
    for (const c of pg.cells) {
      const d = document.createElement('div');
      const shift = shiftOf(pg.n, c.c);
      const dk = delKey(pg.n, c.c, c.r);
      d.className = 'cell ' + c.role;
      d.textContent = c.ch;
      d.dataset.p = pg.n; d.dataset.c = c.c; d.dataset.r = c.r;
      if (colDels[dk]) {
        /* 被删字：半透明幽灵标记留原位（供点击恢复）；本格由下一格字占据 */
        d.classList.add('del');
        d.style.gridRow = clampRow(c.r + shift, pg.rows); d.style.gridColumn = c.c;
        d.onclick = () => { delete colDels[dk]; save(); render(); };
        sheet.appendChild(d);
        colDelCount[c.c] = (colDelCount[c.c] || 0) + 1;
        continue;
      }
      if (shift !== 0) d.classList.add('shifted');
      /* 坐标定位：原始 row + 列纵偏移 − 同列已删格数（删字后续上移）；col1=最右，空位留白不挤位 */
      d.style.gridRow = clampRow(c.r + shift - (colDelCount[c.c] || 0), pg.rows); d.style.gridColumn = c.c;
      if (c.q) {
        const isQ = c.q.old != null || c.q.modern != null || c.q.extraMod || c.q.extraOld || c.q.missAfter;
        if (isQ) {
          d.classList.add('q');
          if (c.q.extraMod || c.q.extraOld) d.classList.add('q-extra');
          if (c.q.missAfter) d.classList.add('q-miss');
          if (c.q.old != null && c.q.modern == null && !c.q.extraMod && !c.q.extraOld) d.classList.add('q-old-only');
          if (decisions[pg.n + ':' + c.c + ':' + c.r]) d.classList.add('done');
          if (hidePlain) d.classList.remove('hide');
        } else if (hidePlain) d.classList.add('hide');
      } else if (hidePlain) d.classList.add('hide');
      /* 任一字可点开面板：列首字→整列偏移；非列首字→删字/裁决 */
      d.onclick = () => openPanel(pg, c);
      sheet.appendChild(d);
    }
    row.appendChild(sheet);
    if (DATA.images && DATA.images[pg.n]) {
      const im = document.createElement('img'); im.className = 'pageimg'; im.src = DATA.images[pg.n];
      row.appendChild(im);
    }
    sec.appendChild(row);
    main.appendChild(sec);
  }
  renderStats();
}

function officerHtml(q) {
  const off = q.officer;
  if (!off) return '';
  const ADOPT = { shanben: '从善本', xiandai: '从他本', neither: '两存', suspend: '悬置' };
  const rows = (off.opinions || []).map(o =>
    '<tr><td>' + o.name + '</td><td>' + (ADOPT[o.adopt] || o.adopt) + (o.candidate && o.candidate !== '∅' ? '「' + o.candidate + '」' : '') + '</td><td>' + (o.grade || '') + ' ' + (o.confidence != null ? o.confidence.toFixed(2) : '') + '</td><td style="font-size:12px">' + (o.reason || '') + '</td></tr>').join('');
  const agg = off.verdict === 'resolved'
    ? '聚合：<b>resolved</b> · 建议' + (off.adopt === 'shanben' ? '维持格字（底本优先）' : '从他本「' + (q.modern || '') + '」')
    : '聚合：<b>suspended</b>（暂拟 ' + (ADOPT[off.tentative] || off.tentative || '无') + '；' + (off.suspendReasons || []).join('；') + '）——不代选，请人工定夺';
  return '<div style="margin:8px 0"><b style="font-size:13px">校书官四议（' + (DATA.meta.officer ? DATA.meta.officer.engine : '') + '）：</b>' +
    '<table style="font-size:12px"><tr><th>官</th><th>倾向</th><th>证据/置信</th><th>理由</th></tr>' + rows + '</table>' +
    '<div id="sugg2">' + agg + '</div></div>';
}

/* 列纵偏移控件：↑下移 +1 / ↓上移 -1 / 归零；调整后整列实时联动（render 重绘） */
function shiftCtlHtml(pg, c) {
  const cur = shiftOf(pg.n, c.c);
  const sugg = shiftSuggest(pg, c.c);
  const suggHtml = sugg !== 0 && cur !== sugg
    ? '<div class="shint">⚑ 检测到该列角色为「' + ({ j: '经', z: '注' }[c.role] || c.role) + '」但起格位置不符，建议偏移 ' + (sugg > 0 ? '+' : '') + sugg + ' —— <button class="mini" id="applySugg">一键应用</button></div>'
    : (cur !== 0 ? '<div class="shint">当前整列已偏移 ' + (cur > 0 ? '+' : '') + cur + ' 格（导出后随裁决生效）</div>' : '');
  return '<div class="shiftbox"><b style="font-size:13px">本列纵偏移（第' + c.c + '列）</b>' +
    '<div class="srow" style="margin-top:6px">' +
    '<button class="mini" id="shDown" title="整列上移一格">↑ −1</button>' +
    '<span style="min-width:44px;text-align:center;font-size:14px" id="shVal">' + (cur > 0 ? '+' : '') + cur + '</span>' +
    '<button class="mini" id="shUp" title="整列下移一格">↓ +1</button>' +
    '<button class="mini" id="shZero">归零</button></div>' + suggHtml + '</div>';
}

/* 非列首字删字控件：本格由下一格字占据，原字不保留；已删可恢复 */
function delCtlHtml(pg, c) {
  const dk = delKey(pg.n, c.c, c.r);
  const isDel = !!colDels[dk];
  return '<div class="shiftbox"><b style="font-size:13px">本字坐标（非列首字）</b>' +
    '<div class="srow" style="margin-top:6px">' +
    (isDel
      ? '<button class="mini" id="undelBtn">恢复此字</button><span style="font-size:12px;color:#7d6608">已删，本格由下一格字占据</span>'
      : '<button class="mini" id="delBtn">删除此字 −1</button><span style="font-size:12px;color:#9a8a66">本格由下一格字占据，原字不保留</span>') +
    '</div></div>';
}

function openPanel(pg, c) {
  const panel = document.getElementById('panel');
  const k = pg.n + ':' + c.c + ':' + c.r;
  const q = c.q || {};
  const dec = decisions[k] || {};
  panel.style.display = 'block';
  panel.innerHTML =
    '<h3>第' + pg.n + '页 列' + c.c + ' 行' + c.r + '（' + ({ j: '经', z: '注', title: '章题' }[c.role] || c.role) + (isColHead(pg, c) ? ' · 列首' : '') + '）</h3>' +
    '<div class="big">' + c.ch + '</div>' +
    (isColHead(pg, c) ? shiftCtlHtml(pg, c) : delCtlHtml(pg, c)) +
    '<table>' +
    '<tr><td>视觉格字</td><td><b>' + c.ch + '</b></td></tr>' +
    '<tr><td>旧OCR</td><td>' + (q.old != null ? q.old : '（一致/无意见）') + '</td></tr>' +
    '<tr><td>现代点校</td><td>' + (q.modern != null ? q.modern : '（一致/无意见）') + '</td></tr>' +
    '</table>' +
    '<div id="sugg">' + suggest(q, c.ch) + '</div>' +
    officerHtml(q) +
    '<b style="font-size:13px">人工裁决：</b>' +
    ['keep-grid|维持格字', 'oldocr|从旧OCR「' + (q.old || '—') + '」', 'modern|从今本「' + (q.modern || '—') + '」', 'custom|自定义', 'defer|存疑'].map(s => {
      const [v, label] = s.split('|');
      let checked = dec.choice === v;
      if (!dec.choice && q.officer && q.officer.verdict === 'resolved') {
        if (q.officer.adopt === 'shanben' && v === 'keep-grid') checked = true;
        if (q.officer.adopt !== 'shanben' && v === 'modern') checked = true;
      }
      return '<label class="choice"><input type="radio" name="ch" value="' + v + '"' + (checked ? ' checked' : '') + '> ' + label + '</label>';
    }).join('') +
    '<input id="customChar" placeholder="自定义字" maxlength="2" style="width:60px;font-size:16px" value="' + (dec.custom || '') + '">' +
    '<textarea id="note" placeholder="备注（理由/出处）">' + (dec.note || '') + '</textarea>' +
    '<button id="saveDec">保存裁决</button> <button id="closePanel">关闭</button>';

  /* 列偏移控件绑定（仅列首字） */
  const applyShift = (delta) => {
    const sk = shiftKey(pg.n, c.c);
    const nv = (colShifts[sk] || 0) + delta;
    if (nv === 0) delete colShifts[sk]; else colShifts[sk] = nv;
    save(); render(); openPanel(pg, c);   // 重绘版面 + 刷新面板数值
  };
  const shUp = panel.querySelector('#shUp');
  if (shUp) shUp.onclick = () => applyShift(1);
  const shDown = panel.querySelector('#shDown');
  if (shDown) shDown.onclick = () => applyShift(-1);
  const shZero = panel.querySelector('#shZero');
  if (shZero) shZero.onclick = () => { delete colShifts[shiftKey(pg.n, c.c)]; save(); render(); openPanel(pg, c); };
  const as = panel.querySelector('#applySugg');
  if (as) as.onclick = () => {
    const s = shiftSuggest(pg, c.c);
    const sk = shiftKey(pg.n, c.c);
    if (s === 0) delete colShifts[sk]; else colShifts[sk] = s;
    save(); render(); openPanel(pg, c);
  };
  /* 删字控件绑定（仅非列首字） */
  const delBtn = panel.querySelector('#delBtn');
  if (delBtn) delBtn.onclick = () => { colDels[delKey(pg.n, c.c, c.r)] = true; save(); render(); openPanel(pg, c); };
  const undelBtn = panel.querySelector('#undelBtn');
  if (undelBtn) undelBtn.onclick = () => { delete colDels[delKey(pg.n, c.c, c.r)]; save(); render(); openPanel(pg, c); };

  panel.querySelector('#saveDec').onclick = () => {
    const v = panel.querySelector('input[name=ch]:checked');
    if (!v) { alert('请先选择'); return; }
    decisions[k] = { page: pg.n, col: c.c, row: c.r, grid: c.ch, oldOcr: q.old ?? null, modern: q.modern ?? null, choice: v.value, custom: panel.querySelector('#customChar').value || null, note: panel.querySelector('#note').value, officerSugg: q.officer ? (q.officer.verdict + ':' + (q.officer.adopt || q.officer.tentative || '')) : null };
    save(); render();
  };
  panel.querySelector('#closePanel').onclick = () => panel.style.display = 'none';
}

function renderRuns() {
  const ul = document.getElementById('runs');
  ul.innerHTML = '';
  DATA.runs.forEach((r, i) => {
    const li = document.createElement('li');
    const rc = runChoices[i];
    li.innerHTML = '<span class="tag miss">' + r.srcLabel + '</span> 第' + (r.page ?? '?') + '页 ' + (r.after ? '列' + r.after.col + '行' + r.after.row + '后' : '页首') + '：「' + (r.text || '').slice(0, 40) + (r.text && r.text.length > 40 ? '…' : '') + '」' +
      (rc ? ' <b>已裁：' + ({ insert: '补入', ignore: '忽略', defer: '存疑' }[rc.choice] || rc.choice) + '</b>' : '') +
      '<br><label><input type="radio" name="run' + i + '" value="insert"' + (rc && rc.choice === 'insert' ? ' checked' : '') + '> 补入正文</label> ' +
      '<label><input type="radio" name="run' + i + '" value="ignore"' + (rc && rc.choice === 'ignore' ? ' checked' : '') + '> 忽略（杂项/噪声）</label> ' +
      '<label><input type="radio" name="run' + i + '" value="defer"' + (rc && rc.choice === 'defer' ? ' checked' : '') + '> 存疑</label>';
    li.querySelectorAll('input').forEach(inp => inp.onchange = () => { runChoices[i] = { choice: inp.value, page: r.page, after: r.after, src: r.src, text: r.text }; save(); renderRuns(); });
    ul.appendChild(li);
  });
}

/* 字号/格距控件：实时调 --cell / --gap（字号随之 calc 缩放，格距为版面疏密配置项） */
const zoom = document.getElementById('zoom');
zoom.oninput = () => {
  document.documentElement.style.setProperty('--cell', zoom.value + 'px');
  document.getElementById('zoomVal').textContent = zoom.value + 'px';
};
const gapSel = document.getElementById('gapSel');
gapSel.oninput = () => {
  document.documentElement.style.setProperty('--gap', gapSel.value + 'px');
  document.getElementById('gapVal').textContent = gapSel.value + 'px';
};
document.getElementById('onlyQ').onchange = render;
document.getElementById('onlyQCell').onchange = render;
document.getElementById('showShift').onchange = (e) => document.body.classList.toggle('show-shift', e.target.checked);
document.getElementById('btnRuns').onclick = () => { const w = document.getElementById('runsWrap'); w.classList.toggle('hide'); document.getElementById('main').classList.toggle('hide'); renderRuns(); };
document.getElementById('btnShiftReset').onclick = () => { if (confirm('清空全部列偏移与删字？')) { colShifts = {}; colDels = {}; save(); render(); } };
document.getElementById('btnExport').onclick = () => {
  const shifts = Object.entries(colShifts).filter(([, v]) => v !== 0).map(([k, v]) => { const [p, c] = k.split(':'); return { page: +p, col: +c, shift: v }; });
  const dels = Object.keys(colDels).map(k => { const [p, c, r] = k.split(':'); return { page: +p, col: +c, row: +r }; });
  const payload = { work: DATA.work, base: DATA.baseSha, exportedAt: new Date().toISOString(), decisions: Object.values(decisions), runs: Object.values(runChoices).map((r) => ({ ...r })), colShifts: shifts, colDels: dels };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '精校裁决-' + DATA.work + '.json';
  a.click();
};
document.getElementById('btnClear').onclick = () => { if (confirm('清空本地暂存的人工裁决、列偏移与删字？')) { decisions = {}; runChoices = {}; colShifts = {}; colDels = {}; save(); render(); } };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.getElementById('panel').style.display = 'none'; });

/* 悬浮栏自动隐藏：鼠标离栏 1s 后滑出右缘，唯留右缘竖签唤出 */
(function () {
  const rail = document.getElementById('rail');
  const tgl = document.getElementById('railToggle');
  let hideT = null;
  const arm = () => { clearTimeout(hideT); hideT = setTimeout(() => rail.classList.add('off'), 1000); };
  rail.addEventListener('mouseenter', () => { clearTimeout(hideT); rail.classList.remove('off'); });
  rail.addEventListener('mouseleave', arm);
  tgl.addEventListener('click', () => { rail.classList.remove('off'); clearTimeout(hideT); });
})();

render();
</script>
</body>
</html>`;

const outDir = path.join(privateWorkDir(workId), 'output');
const outFile = path.join(outDir, '精校台-网格.html');
fs.writeFileSync(outFile, html);
const kb = (fs.statSync(outFile).size / 1024).toFixed(0);
console.log(`✓ ${workId} 网格精校台：${outFile}（${kb} KB）`);
console.log(`  页 ${DATA.meta.pages} · 格 ${DATA.meta.cells} · 疑问格 ${DATA.meta.qCells} · 夺文句 ${DATA.meta.runs}${images ? ' · 含书影 ' + Object.keys(images).length + ' 页' : ''}`);
