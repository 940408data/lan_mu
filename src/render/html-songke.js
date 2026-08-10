/**
 * 宋版善刻 HTML 渲染器：LayoutTree(songke) → 自包含書葉 HTML。
 * 字面字體：A 級子集（fonts/*.woff2）嵌入，無文件則回退鏈；
 * 繁簡切換：構建期以 opencc-js 生成本作用字映射內嵌（運行時逐字轉換）。
 */
const fs = require('fs');
const path = require('path');
const OpenCC = require('opencc-js');
const { loadRegistry, resolveFace } = require('../fonts/fonts');

const SONGKE_CSS = () => fs.readFileSync(path.join(__dirname, '..', 'viewer', 'songke.css'), 'utf8');
const SONGKE_JS = () => fs.readFileSync(path.join(__dirname, '..', 'viewer', 'songke.js'), 'utf8');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* 列陣編碼：token → [字, 朱點有無(0|1), 朱點變化碼(0–15)]，壓縮內嵌體積 */
function encodeCol(c) {
  const tk = (t) => [t.c, t.m || 0, t.v || 0];
  return { b: c.big.map(tk), s: [c.subs[0].map(tk), c.subs[1].map(tk)] };
}

/* 注文雙行字數 → 中文數目（二十 / 二十二 / 二十五），供各版 spec 文案 */
function cnSub(n) {
  const d = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  return (n >= 20 ? '二' : d[Math.floor(n / 10)]) + '十' + (n % 10 ? d[n % 10] : '');
}

/* 構建期生成繁→簡逐字映射（僅收錄本作用字 + 界面文案） */
function buildT2S(tree) {
  const conv = OpenCC.Converter({ from: 'tw', to: 'cn' });
  const chars = new Set();
  for (const b of tree.blocks) for (const ch of b.text) chars.add(ch);
  const m = tree.meta;
  for (const ch of (m.title || '') + (m.subtitle || '') + (m.songke && m.songke.colophon || '') + (m.songke && m.songke.spec || '')) chars.add(ch);
  for (const v of tree.volumes || []) for (const ch of v.title) chars.add(ch);
  for (const f of Object.values(m.faces || {})) for (const ch of (f.label || '')) chars.add(ch);
  for (const ch of '繁體簡體界行楷體宋體英雄行楷經注並朱惟施白文無點單葉披覽通前後字號第半下載疏朗逸正宋槧版式二十二') chars.add(ch);
  const map = {};
  for (const ch of chars) {
    const s = conv(ch);
    if (s !== ch) map[ch] = s;
  }
  return map;
}

/**
 * @param {object} tree  songke LayoutTree
 * @param {object} opts  { distWorkDir }
 * @returns {{html:string, warnings:string[]}}
 */
function renderSongkeHtml(tree, opts = {}) {
  const { meta } = tree;
  const sk = meta.songke || {};
  const registry = loadRegistry();
  const distWorkDir = opts.distWorkDir || path.join(__dirname, '..', '..', 'dist', 'works', meta.id);

  // 字面字體棧：依 meta.faces 各角色（楷/宋/行楷等）逐一解析
  const warnings = [];
  const stacks = {};
  let faceCss = '';
  for (const role of Object.keys(meta.faces || {})) {
    const r = resolveFace(role, meta, registry, distWorkDir);
    stacks[role] = r.stack;
    faceCss += r.faceCss;
    warnings.push(...r.warnings);
  }

  const payload = {
    colsPerHalf: tree.conf.colsPerHalf,
    variants: tree.variants.map((v) => ({
      key: v.key,
      name: v.name,
      sub: v.sub,
      spec: (sk.spec || '').replace(/注文雙行[一二三四五六七八九十]+字/, `注文雙行${cnSub(v.sub)}字`),
      cols: v.columns.map(encodeCol),
      volumes: v.volumes,
    })),
    title: meta.title,
    banxinTitle: sk.banxinTitle || meta.title,
    gong: sk.gong || [],
    seals: tree.seals || [],
    faces: Object.entries(meta.faces || {}).map(([role, f]) => ({ role, label: f.label || role })),
    colophon: sk.colophon || '',
  };

  const docTitle = meta.docTitle || `${meta.title} — ${meta.subtitle || ''}`;
  const exp = meta.export || {};
  const expBase = exp.base || `${meta.id}-songke`;
  // 下載菜單：每字面一版 PDF（不再生成/提供 JPG、PNG 長圖）
  const dlItems = Object.entries(exp.faces || { kai: 'Kai', song: 'Song' }).map(([role, tag]) => {
    const label = (meta.faces[role] && meta.faces[role].label) || role;
    const file = `${expBase}-${tag}.pdf`;
    return `<a class="dl-item" role="menuitem" href="${file}" download="${file}">${esc(label)} PDF</a>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#221d18">
<title>${esc(docTitle)}</title>
<style>
:root{${Object.entries(stacks).map(([role, s]) => `--${role}:${s || 'serif'};`).join('')}}
${faceCss}
${SONGKE_CSS()}
</style>
</head>
<body>

<div class="masthead">
  <div class="zhu" id="mhTitle"></div>
  <p class="ke" id="mhSub"></p>
</div>

<div class="bar">
  <button id="btnZh" aria-pressed="false"></button>
  <button id="btnDu" aria-pressed="true"></button>
  <button id="btnJie" aria-pressed="true"></button>
  <select id="faceSel" aria-label="字面"></select>
  <select id="zhuwenSel" aria-label="注文版式"></select>
  <span class="sep"></span>
  <button id="btnMode" aria-pressed="false"></button>
  <button id="btnPrev"></button>
  <span class="lbl" id="folioNow"></span>
  <button id="btnNext"></button>
  <span class="sep"></span>
  <div class="dl">
    <button class="btn" id="dl" type="button" aria-haspopup="true">下載</button>
    <div class="dl-menu" id="dlMenu" role="menu" aria-label="下載 PDF">
    ${dlItems}
    </div>
  </div>
  <span class="sep"></span>
  <label for="zoom" id="lblZoom"></label>
  <input id="zoom" type="range" min="14" max="36" step="1" value="26">
</div>

<div id="book" class="book ruled" aria-label="${esc(meta.ariaLabel || meta.title)}"></div>
<p class="colophon" id="colophon"></p>

<script>
window.SONGKE=${JSON.stringify(payload)};
window.T2S=${JSON.stringify(buildT2S(tree))};
${SONGKE_JS()}
</script>
</body></html>`;
  return { html, warnings };
}

module.exports = { renderSongkeHtml };
