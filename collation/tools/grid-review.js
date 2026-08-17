#!/usr/bin/env node
/**
 * collation · 网格基精校台生成器（tools/grid-review.js）
 * 从「基础层 grid-transcribe + overlay（参校/标签）」生成单文件离线 HTML：
 *   - 每页 16×15 竖排网格（direction:rtl，列自右向左，同宋刻版面）
 *   - 经(j)大字/注(z)小字/章题(title)底色，疑问格红框标注（sub/extra/夺文锚点）
 *   - 点击疑问格 → 面板显示：格字、旧OCR字、现代点校字、机器参考建议、人工选择（可保存本地）
 *   - 句子级夺文（missing runs）单独列表可裁
 *   - 导出裁决 JSON → tools/grid-review-merge.js 合入 overlay.fixes（唯一改字通道）
 *
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
for (const s of ov.variants.modern.sub || []) put(s.page, s.col, s.row, 'modern', s.modern);
for (const e of ov.variants.oldOcr.extra || []) put(e.page, e.col, e.row, 'extraOld', true);
for (const e of ov.variants.modern.extra || []) put(e.page, e.col, e.row, 'extraMod', true);
// 夺文 run 挂 after 格
const runs = [];
for (const [src, key] of [['oldOcr', '旧OCR'], ['modern', '今本']]) {
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
  images, // 可能很大；无 --image-dir 时为 null
};

const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>${workId} · 网格基精校台</title>
<style>
  :root { --cell: 34px; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "LXGW WenKai TC", "Kaiti TC", Kaiti, serif; background: #f6f1e4; color: #2c2416; }
  header { position: sticky; top: 0; z-index: 10; background: #efe6d0; border-bottom: 2px solid #c9b98a; padding: 8px 14px; display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
  header h1 { font-size: 17px; margin: 0; }
  #stats { font-size: 13px; color: #6b5a3e; }
  button { font: inherit; font-size: 13px; padding: 4px 10px; border: 1px solid #b9a671; background: #fffaf0; border-radius: 4px; cursor: pointer; }
  button.active { background: #d8c48a; }
  main { padding: 14px; }
  .page { margin: 0 0 26px; }
  .page-h { font-size: 14px; color: #6b5a3e; margin: 0 0 6px; display: flex; gap: 12px; align-items: baseline; }
  .page-h b { color: #2c2416; font-size: 15px; }
  .flexrow { display: flex; gap: 18px; align-items: flex-start; flex-wrap: wrap; }
  .sheet { display: inline-grid; grid-template-columns: repeat(var(--cols, 16), var(--cell)); grid-template-rows: repeat(var(--rows, 15), var(--cell)); direction: rtl; gap: 1px; background: #fffdf6; border: 1px solid #cbbd97; padding: 6px; box-shadow: 0 1px 3px rgba(60,45,20,.15); }
  /* 每格显式定位 grid-row:row / grid-column:col（rtl 下 col1=最右），空位自然留白，严格还原善本版面 */
  .cell { width: var(--cell); height: var(--cell); display: flex; align-items: center; justify-content: center; border-radius: 2px; user-select: none; }
  .cell.j { font-size: 21px; font-weight: 700; }
  .cell.z { font-size: 15px; color: #4d3f2c; }
  .cell.title { background: #f1e2b8; }
  .cell.q { cursor: pointer; outline: 2px solid #c0392b; outline-offset: -1px; }
  .cell.q-old-only { outline-color: #d68910; }
  .cell.q-extra { outline-style: dashed; }
  .cell.q-miss { outline-color: #8e44ad; outline-style: dotted; }
  .cell.done { outline-color: #1e8449 !important; }
  .cell:hover { background: #fdf0d5; }
  .pageimg { max-height: 560px; border: 1px solid #cbbd97; background: #fff; }
  #panel { position: fixed; right: 0; top: 0; bottom: 0; width: 330px; background: #fffdf4; border-left: 2px solid #c9b98a; box-shadow: -2px 0 8px rgba(60,45,20,.18); padding: 14px; display: none; overflow-y: auto; z-index: 20; }
  #panel h3 { margin: 0 0 8px; font-size: 15px; }
  #panel .big { font-size: 40px; text-align: center; margin: 6px 0; }
  #panel table { width: 100%; border-collapse: collapse; font-size: 14px; margin: 6px 0; }
  #panel td { border: 1px solid #dccf9f; padding: 4px 6px; }
  #sugg { background: #f3ecda; border: 1px dashed #b9a671; padding: 6px 8px; font-size: 13px; margin: 8px 0; border-radius: 4px; }
  label.choice { display: block; margin: 4px 0; font-size: 14px; cursor: pointer; }
  textarea { width: 100%; height: 44px; font: inherit; font-size: 13px; }
  #runs li { margin: 6px 0; font-size: 14px; cursor: pointer; border: 1px solid #dccf9f; border-radius: 4px; padding: 4px 6px; }
  #runs li:hover { background: #fdf0d5; }
  .tag { display: inline-block; font-size: 11px; border-radius: 3px; padding: 0 4px; color: #fff; }
  .tag.mod { background: #c0392b; } .tag.old { background: #d68910; } .tag.extra { background: #7d6608; } .tag.miss { background: #8e44ad; }
  .hide { display: none !important; }
</style>
</head>
<body>
<header>
  <h1>${workId} · 网格基精校台</h1>
  <span id="stats"></span>
  <label><input type="checkbox" id="onlyQ"> 只看疑问页</label>
  <label><input type="checkbox" id="onlyQCell"> 隐藏无疑问格</label>
  <button id="btnRuns">句子级夺文清单</button>
  <button id="btnExport">导出裁决 JSON</button>
  <button id="btnClear">清空本地暂存</button>
</header>
<main id="main"></main>
<div id="runsWrap" class="hide"><main><h3 style="font-size:15px">句子级夺文/缺页（参校本多出，格无）</h3><ul id="runs"></ul></main></div>
<div id="panel"></div>
<script>
const DATA = ${JSON.stringify(DATA)};
const LS_KEY = 'grid-review:' + DATA.work + ':' + DATA.baseSha.slice(0, 12);
let decisions = {};  // "p:c:r" -> {choice, custom, note}
let runChoices = {}; // run idx -> {choice, note}
try { const s = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); decisions = s.decisions || {}; runChoices = s.runs || {}; } catch (e) {}

const key = c => c.page + ':' + c.c + ':' + c.r;
function save() { localStorage.setItem(LS_KEY, JSON.stringify({ decisions, runs: runChoices })); renderStats(); }

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
  document.getElementById('stats').textContent = '疑问格 ' + done + '/' + qTotal + ' 已裁 · 夺文句 ' + rDone + '/' + DATA.meta.runs + ' 已裁 · 共 ' + DATA.meta.pages + ' 页' + (DATA.meta.officer ? ' · 校书官 ' + DATA.meta.officer.count + ' 条（' + DATA.meta.officer.engine + '）' : '');
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
    for (const c of pg.cells) {
      const d = document.createElement('div');
      d.className = 'cell ' + c.role;
      d.textContent = c.ch;
      d.style.gridRow = c.r; d.style.gridColumn = c.c; // 严格按 (col,row) 坐标定位：col1=最右，空位留白不挤位
      d.dataset.p = pg.n; d.dataset.c = c.c; d.dataset.r = c.r;
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
      d.onclick = () => { if (d.classList.contains('q')) openPanel(pg.n, c); };
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

function openPanel(p, c) {
  const panel = document.getElementById('panel');
  const k = p + ':' + c.c + ':' + c.r;
  const q = c.q || {};
  const dec = decisions[k] || {};
  panel.style.display = 'block';
  panel.innerHTML =
    '<h3>第' + p + '页 列' + c.c + ' 行' + c.r + '（' + ({ j: '经', z: '注', title: '章题' }[c.role] || c.role) + '）</h3>' +
    '<div class="big">' + c.ch + '</div>' +
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
      // 预填：无已存裁决时按校书官聚合结论预选（resolved 才预填；suspended 不代选）
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
  panel.querySelector('#saveDec').onclick = () => {
    const v = panel.querySelector('input[name=ch]:checked');
    if (!v) { alert('请先选择'); return; }
    decisions[k] = { page: p, col: c.c, row: c.r, grid: c.ch, oldOcr: q.old ?? null, modern: q.modern ?? null, choice: v.value, custom: panel.querySelector('#customChar').value || null, note: panel.querySelector('#note').value, officerSugg: q.officer ? (q.officer.verdict + ':' + (q.officer.adopt || q.officer.tentative || '')) : null };
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

document.getElementById('onlyQ').onchange = render;
document.getElementById('onlyQCell').onchange = render;
document.getElementById('btnRuns').onclick = () => { const w = document.getElementById('runsWrap'); w.classList.toggle('hide'); document.getElementById('main').classList.toggle('hide'); renderRuns(); };
document.getElementById('btnExport').onclick = () => {
  const payload = { work: DATA.work, base: DATA.baseSha, exportedAt: new Date().toISOString(), decisions: Object.values(decisions), runs: Object.values(runChoices).map((r, i) => ({ ...r })) };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '精校裁决-' + DATA.work + '.json';
  a.click();
};
document.getElementById('btnClear').onclick = () => { if (confirm('清空本地暂存的人工裁决？')) { decisions = {}; runChoices = {}; save(); render(); } };
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
