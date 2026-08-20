/**
 * HTML 渲染器：LayoutTree → 自包含交互手卷 HTML。
 * 扫描图 scan.jpg 作为独立资源按需加载；A 级字体子集以相对路径 fonts/*.woff2 引用。
 */
const fs = require('fs');
const path = require('path');
const OpenCC = require('opencc-js');
const { loadRegistry, resolveFace, resolveScFaces } = require('../fonts/fonts');
const { BOOK_META, NETDISK_FOLDER } = require('../site/home');

/* 構建期繁→簡轉換器：用於 UI 文案簡體化 */
const _t2s = OpenCC.Converter({ from: 'tw', to: 'cn' });

const VIEWER_CSS = () => fs.readFileSync(path.join(__dirname, '..', 'viewer', 'viewer.css'), 'utf8');
const VIEWER_JS = () => fs.readFileSync(path.join(__dirname, '..', 'viewer', 'viewer.js'), 'utf8');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---------- 片段生成 ---------- */

function glyphsHtml(glyphs) {
  let out = '';
  for (const g of glyphs) {
    out += g.ch === '　' ? '<i class="sp">　</i>' : `<i class="k${g.k} j${g.j} h${g.h}${g.du ? ' du' : ''}">${esc(g.ch)}</i>`;
  }
  return out;
}

/** 構建期生成繁→簡逐字映射（僅收錄本作用字，內嵌 HTML 供運行時切換） */
function buildT2S(tree, meta) {
  const chars = new Set();
  for (const c of tree.columns) {
    for (const g of c.glyphs) if (g.ch && g.ch !== '　') chars.add(g.ch);
    if (c.note) for (const ch of c.note.text) chars.add(ch);
  }
  for (const ch of meta.title + meta.subtitle) chars.add(ch);
  const map = {};
  for (const ch of chars) {
    const s = _t2s(ch);
    if (s !== ch) map[ch] = s;
  }
  return map;
}

function columnHtml(col) {
  const note = col.note
    ? `<b class="note" style="--nt:${col.note.at.toFixed(1)}px;--nfs:${col.note.fontSize.toFixed(1)}px;--nh:${col.note.height.toFixed(1)}px" title="夾注：${esc(col.note.text)}">${esc(col.note.text)}</b>`
    : '';
  return (
    `<i class="col ${col.cls}" style="--n:${col.n}" data-line="${col.line}" data-count="${col.count}" data-meta="${esc(col.meta)}" ` +
    `data-sec="${esc(col.sec)}" tabindex="0"><i class="t">${glyphsHtml(col.glyphs)}</i>${note}</i>`
  );
}

function sealsSvg(tree) {
  const { paperW, paperH } = tree.dims;
  const groups = tree.seals.map((s) => {
    const rect = s.style === '朱文'
      ? `<rect x="0" y="0" width="${s.w}" height="${s.h}" rx="1.5" fill="#9d3126"/>`
      : `<rect x="0" y="0" width="${s.w}" height="${s.h}" rx="1.5" fill="none" stroke="#9d3126" stroke-width="2.4"/>`;
    const color = s.style === '朱文' ? '#efe4cd' : '#9d3126';
    const texts = s.chars.map((c) =>
      `<text x="${c.x.toFixed(1)}" y="${c.y.toFixed(1)}" font-size="${s.fontSize}" fill="${color}" text-anchor="middle" dominant-baseline="central">${esc(c.ch)}</text>`
    ).join('');
    return `<g transform="translate(${s.x.toFixed(1)},${s.y.toFixed(1)}) rotate(${s.rotate.toFixed(2)})" class="seal-mark">${rect}${texts}</g>`;
  }).join('');
  return `<svg class="seals" viewBox="0 0 ${paperW} ${paperH}" preserveAspectRatio="none" aria-hidden="true">${groups}</svg>`;
}

function orchidsSvg(tree) {
  const { paperW, paperH } = tree.dims;
  const groups = tree.orchids.map((o) =>
    `<g transform="translate(${o.x.toFixed(1)},${o.y.toFixed(1)}) scale(${o.sx.toFixed(3)},${o.sy.toFixed(3)})" opacity="${o.opacity.toFixed(3)}">${o.svg}</g>`
  ).join('');
  return `<svg class="tex" viewBox="0 0 ${paperW} ${paperH}" preserveAspectRatio="none" aria-hidden="true"><g class="lan">${groups}</g>${tree.paperDecor || ''}</svg>`;
}

/* facts 統計區已移除（用戶要求簡化） */

/* ---------- 主装配 ---------- */

/**
 * @param {object} tree  LayoutTree
 * @param {object} opts  { distWorkDir: 该作品 dist 目录（用于探测已构建的字体子集） }
 * @returns {{html:string, warnings:string[]}}
 */
function renderHtml(tree, opts = {}) {
  const { meta, dims } = tree;
  const registry = loadRegistry();
  const distWorkDir = opts.distWorkDir || path.join(__dirname, '..', '..', 'dist', 'works', meta.id);

  // 繁体轨三体字体栈：A 级嵌入子集 / B 级 local() 引用 / 无文件回退链
  const warnings = [];
  const stacks = {};
  let faceCss = '';
  for (const role of ['song', 'jing', 'xing']) {
    const r = resolveFace(role, meta, registry, distWorkDir);
    stacks[role] = r.stack;
    faceCss += r.faceCss;
    warnings.push(...r.warnings);
  }
  // 简体轨（独立字面列表）：--fsc-<id> 变量 + .fsc-* 切换规则；
  // 笔毫归一（浓淡拉平/位移归零/不叠加旋转）——简体字面自身笔势优先
  const sc = resolveScFaces(meta, registry, distWorkDir);
  warnings.push(...sc.warnings);
  const scVars = sc.roles.map((r) => `  --fsc-${r.id}:${r.stack};`).join('\n');
  const scCss = sc.roles.map((r) => {
    const n = r.id;
    const ks = ['.k0', '.k1', '.k2', '.k3', '.k4', '.k5'].map((k) => `.paper.fsc-${n} ${k}`).join(',');
    const js = ['.j0', '.j1', '.j2', '.j3', '.j4', '.j5', '.j6', '.j7'].map((j) => `.paper.fsc-${n} ${j}`).join(',');
    return `.paper.fsc-${n}{--face:var(--fsc-${n})}\n${ks}{opacity:1}\n${js}{position:static;left:auto;top:auto}\n` +
      `.paper.fsc-${n} .t i.du{position:relative}\n` +
      `.paper.fsc-${n} .t i{text-rendering:geometricPrecision;-webkit-font-smoothing:antialiased}`;
  }).join('\n');
  faceCss += sc.roles.map((r) => r.faceCss).join('') + '\n' + scCss;

  const rootVars = `:root{
  --ch:${dims.ch}px; --pitch:${dims.pitch}px; --glyph:${dims.glyph}px; --text-h:${dims.textH}px;
  --top:${dims.top}px; --paper-w:${dims.paperW}px; --paper-h:${dims.paperH}px;
  --lead:${dims.lead}px; --tail:${dims.tail}px; --silk:${dims.silk}px; --ends:${dims.ends}px; --roll:${dims.roll}px;
  --wrap-w:${dims.wrapW}px; --wrap-h:${dims.wrapH}px;
  --ui:"PingFang TC","Noto Sans CJK TC","Microsoft JhengHei","Hiragino Sans GB",sans-serif;
  --zoom:1;
  --fs:1;
  --ink:#2a2117; --ink2:#3b3226; --note:#4f4030;
  --paper:#e3d7ba; --paper-hi:#efe7d1; --paper-lo:#cdbc99;
  --cinnabar:#9d3126;
  --f-song:${stacks.song};
  --f-jing:${stacks.jing};
  --f-xing:${stacks.xing};
${scVars}
  --kai:var(--f-jing);
}`;

  const docTitle = meta.docTitle ||
    `${meta.title.replace(/ · /g, '·')} — ${meta.subtitle.replace(/ · /g, '')}`;

  const faceOptions = ['song', 'jing', 'xing'].map((role) => {
    const raw = (meta.faces[role] && meta.faces[role].label) || role;
    const label = _t2s(raw);
    return `<option value="${role}">${esc(label)}</option>`;
  }).join('\n        ');

  // 下載菜單：按 export.faces 逐版列出長圖 JPG（與出圖產物同名）
  const exp = meta.export || {};
  const expBase = exp.base || `${meta.id}-scroll`;
  const dlItems = Object.entries(exp.faces || { song: 'Song', jing: 'Jing', xing: 'Xingkai' }).map(([role, tag]) => {
    const raw = (meta.faces[role] && meta.faces[role].label) || role;
    const label = _t2s(raw);
    const file = `${expBase}-${tag}.jpg`;
    return `<a class="dl-item" role="menuitem" href="${file}" download="${file}">${esc(label)}长图</a>`;
  }).join('\n      ');
  // 全帙 PDF 走網盤：獨立鏈接（meta.netdisk / 屬書 BOOK_META）→ 共享文件夾兕底
  const bookMeta = (meta.book && BOOK_META[meta.book.id]) || {};
  const ndLink = meta.netdisk || bookMeta.netdisk || NETDISK_FOLDER;
  const ndLabel = meta.netdisk || bookMeta.netdisk ? '全量资源 · 网盘' : '全量资源 · 网盘共享夹';
  const ndItem = ndLink ? `<div class="dl-sep" role="separator"></div>\n      <a class="dl-item" role="menuitem" href="${esc(ndLink)}" target="_blank" rel="noopener">${ndLabel}</a>` : '';

  const columnsHtml = tree.columns.map(columnHtml).join('\n');
  const first = tree.columns[0];
  const hudInit = `${esc(first.sec)} · 第 <b>${String(first.line).padStart(3, '0')}</b> 行 · ${first.count}字`;

  const scanDiv = tree.hasScan
    ? `<div class="scan" aria-hidden="true"><img data-src="scan.jpg" alt="原卷掃描圖"></div>`
    : '';

  const html = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#14120f">
<title>${esc(docTitle)}</title>
<style>
${rootVars}
${faceCss}
${VIEWER_CSS()}
</style>
</head>
<body>
<header class="topbar">
  <div class="mark" aria-hidden="true">${esc(meta.mark)}</div>
  <div class="tt"><h1>${esc(meta.title)}</h1><p>${esc(meta.subtitle)}</p></div>
  <nav class="tools">
    <select class="btn" id="faceSel" aria-label="字体">
      ${faceOptions}
    </select>
    <div class="dl">
      <button class="btn" id="dl" type="button" aria-haspopup="true" aria-expanded="false">下载</button>
      <div class="dl-menu" role="menu" aria-label="下载">
      ${dlItems}${ndItem}
      </div>
    </div>
    <button class="btn txt on" id="mode" type="button" aria-pressed="false">摹本</button>
    <button class="btn txt" id="rule" type="button" aria-pressed="false">界行</button>
    <button class="btn txt" id="simp" type="button" aria-pressed="false">简体</button>
    ${tree.columns.some((c) => c.glyphs.some((g) => g.du)) ? '<button class="btn txt" id="duBtn" type="button" aria-pressed="false">句讀</button>' : ''}
    <button class="btn ico" id="minus" type="button" aria-label="縮小卷軸">−</button>
    <button class="btn ico" id="plus" type="button" aria-label="放大卷軸">＋</button>
    <button class="btn txt" id="fminus" type="button" aria-label="縮小字體">字−</button>
    <button class="btn txt" id="fplus" type="button" aria-label="放大字體">字＋</button>
    <button class="btn ico" id="about" type="button" aria-label="卷軸說明" aria-expanded="false">ⓘ</button>
  </nav>
</header>

<main class="viewer" id="viewer" aria-label="${esc(meta.ariaLabel)}">
  <div class="stage" id="stage">
    <div class="wrap">
      <div class="silk"></div>
      <div class="roller l"></div><div class="roller r"></div>
      <div class="paper f-song" id="paper">
  ${orchidsSvg(tree)}
  ${sealsSvg(tree)}
  <div class="ribbon" id="ribbon">
${columnsHtml}
  </div>
  ${scanDiv}
      </div>
    </div>
  </div>
</main>

<div class="hud" id="hud" role="status">${hudInit}</div>
<div class="bar" aria-hidden="true"><span id="prog"></span></div>

<aside class="panel" id="panel" aria-label="卷軸說明">
${meta.aboutHtml}
</aside>

<script>
const FACES=${JSON.stringify({
  tc: ['song', 'jing', 'xing'].map((role) => ({ v: role, l: _t2s((meta.faces[role] && meta.faces[role].label) || role) })),
  sc: sc.roles.map((r) => ({ v: r.id, l: _t2s(r.label) })),
  def: sc.def || null,
  defScript: meta.defaultScript || 'tc',
})};
const T2S=${JSON.stringify(buildT2S(tree, meta))};
${VIEWER_JS().replace('__WRAP_H__', String(dims.wrapH))}
</script>
</body></html>`;
  return { html, warnings };
}

module.exports = { renderHtml };
