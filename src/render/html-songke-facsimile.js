/**
 * 宋版影刻直出 HTML 渲染器：LayoutTree(songke-facsimile) → 自包含書葉 HTML。
 * 与 html-songke.js（重排引擎）并行：payload 为逐格页阵（零重排），
 * 字面字体 A 级子集嵌入；繁简切换构建期生成本作用字映射。
 */
const fs = require('fs');
const path = require('path');
const OpenCC = require('opencc-js');
const { loadRegistry, resolveFace } = require('../fonts/fonts');

const _t2s = OpenCC.Converter({ from: 'tw', to: 'cn' });

const CSS = () => fs.readFileSync(path.join(__dirname, '..', 'viewer', 'songke-facsimile.css'), 'utf8');
const JS = () => fs.readFileSync(path.join(__dirname, '..', 'viewer', 'songke-facsimile.js'), 'utf8');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* 构建期生成繁→简逐字映射（仅收录本作用字 + 界面文案） */
function buildT2S(tree) {
  const chars = new Set();
  for (const pg of tree.grid.pages || []) {
    for (const col of pg.cols || []) {
      for (const ch of String(col.chars || '')) if (ch !== '　') chars.add(ch);
    }
  }
  const m = tree.meta;
  const fm = m.facsimile || {};
  for (const ch of (m.title || '') + (m.subtitle || '') + (fm.colophon || '') + (fm.spec || '') + (fm.banxinTitle || '')) chars.add(ch);
  for (const f of Object.values(m.faces || {})) for (const ch of (f.label || '')) chars.add(ch);
  for (const fx of tree.grid.fixes || []) {
    for (const ch of String(fx.from || '') + String(fx.to || '') + String(fx.evidence || '')) chars.add(ch);
  }
  for (const ch of '繁體簡體上一葉下一第共校勘記字面縮放目錄藏書經注標題') chars.add(ch);
  const map = {};
  for (const ch of chars) {
    const s = _t2s(ch);
    if (s !== ch) map[ch] = s;
  }
  return map;
}

/**
 * @param {object} tree  songke-facsimile LayoutTree
 * @param {object} opts  { distWorkDir }
 * @returns {{html:string, warnings:string[]}}
 */
function renderSongkeFacsimileHtml(tree, opts = {}) {
  const { meta, grid } = tree;
  const fm = meta.facsimile || {};
  const registry = loadRegistry();
  const distWorkDir = opts.distWorkDir || path.join(__dirname, '..', '..', 'dist', 'works', meta.id);

  // 字面字体栈：依 meta.faces 各角色逐一解析
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
    title: meta.title,
    banxinTitle: fm.banxinTitle || meta.title,
    rows: (grid.layout && grid.layout.rows) || 15,
    pages: grid.pages.map((pg) => ({
      n: pg.n,
      cols: (pg.cols || []).map((c) => ({ c: c.c, role: c.role || null, chars: c.chars })),
    })),
    fixes: grid.fixes || [],
    faces: Object.entries(meta.faces || {}).map(([role, f]) => ({ role, label: f.label || role })),
    colophon: fm.colophon || '',
    navLabel: meta.book && meta.book.id ? '目錄' : '藏書',
  };

  const navHref = meta.book && meta.book.id
    ? `../../books/${meta.book.id}/index.html`
    : '../../index.html';

  const docTitle = meta.docTitle || `${meta.title} — ${meta.subtitle || ''}`;

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
${CSS()}
</style>
</head>
<body>

<aside class="rail" id="rail">
  <div class="tiqian"><span class="zhu">此弄宜緩</span></div>
  <a class="btn nav" id="navToc" href="${navHref}"></a>

  <section class="rg">
    <div class="rg-row">
      <button id="btnPrev" type="button"></button>
      <button id="btnNext" type="button"></button>
    </div>
    <span class="lbl folio-now" id="folioNow"></span>
  </section>

  <section class="rg">
    <div class="rg-row">
      <button id="btnZh" type="button" aria-pressed="false"></button>
      <button id="btnJiao" class="wide" type="button" aria-pressed="true"></button>
    </div>
  </section>

  <section class="rg">
    <label class="fld"><span class="micro">字面</span><select id="faceSel" aria-label="字面"></select></label>
    <label class="fld fld-zoom"><span class="micro">縮放</span><input id="zoom" type="range" min="14" max="44" step="1" value="26"></label>
  </section>
</aside>

<div id="book" class="fbook" aria-label="${esc(meta.ariaLabel || meta.title)}"></div>
<p class="colophon" id="colophon"></p>

<script>
window.SKF=${JSON.stringify(payload)};
window.T2S=${JSON.stringify(buildT2S(tree))};
${JS()}
</script>
</body></html>`;
  return { html, warnings };
}

module.exports = { renderSongkeFacsimileHtml };
