/**
 * HTML 渲染器：LayoutTree → 自包含交互手卷 HTML。
 * 扫描图 scan.jpg 作为独立资源按需加载；A 级字体子集以相对路径 fonts/*.woff2 引用。
 */
const fs = require('fs');
const path = require('path');
const { loadRegistry, resolveFace } = require('../fonts/fonts');

const VIEWER_CSS = () => fs.readFileSync(path.join(__dirname, '..', 'viewer', 'viewer.css'), 'utf8');
const VIEWER_JS = () => fs.readFileSync(path.join(__dirname, '..', 'viewer', 'viewer.js'), 'utf8');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---------- 片段生成 ---------- */

function glyphsHtml(glyphs) {
  let out = '';
  for (const g of glyphs) {
    out += g.ch === '　' ? '　' : `<i class="k${g.k} j${g.j} h${g.h}">${esc(g.ch)}</i>`;
  }
  return out;
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

function factsHtml(tree) {
  const { stats, meta } = tree;
  const items = [
    [stats.lines, '全卷行'],
    [stats.scoreLines, '譜文行'],
    [stats.chars.toLocaleString('en-US'), '摹錄字'],
    [stats.notes, '處夾注'],
  ];
  if (meta.physical && meta.physical.lengthCm) items.push([meta.physical.lengthCm, '厘米']);
  return items.map(([v, l]) => `<span class="fact"><b>${v}</b>${l}</span>`).join('\n    ');
}

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

  // 三体字体栈：A 级嵌入子集 / B 级 local() 引用 / 无文件回退链
  const warnings = [];
  const stacks = {};
  let faceCss = '';
  for (const role of ['song', 'jing', 'xing']) {
    const r = resolveFace(role, meta, registry, distWorkDir);
    stacks[role] = r.stack;
    faceCss += r.faceCss;
    warnings.push(...r.warnings);
  }

  const rootVars = `:root{
  --ch:${dims.ch}px; --pitch:${dims.pitch}px; --glyph:${dims.glyph}px; --text-h:${dims.textH}px;
  --top:${dims.top}px; --paper-w:${dims.paperW}px; --paper-h:${dims.paperH}px;
  --lead:${dims.lead}px; --tail:${dims.tail}px; --silk:${dims.silk}px; --ends:${dims.ends}px; --roll:${dims.roll}px;
  --wrap-w:${dims.wrapW}px; --wrap-h:${dims.wrapH}px;
  --ui:"PingFang TC","Noto Sans CJK TC","Microsoft JhengHei","Hiragino Sans GB",sans-serif;
  --zoom:1;
  --ink:#2a2117; --ink2:#3b3226; --note:#4f4030;
  --paper:#e3d7ba; --paper-hi:#efe7d1; --paper-lo:#cdbc99;
  --cinnabar:#9d3126;
  --f-song:${stacks.song};
  --f-jing:${stacks.jing};
  --f-xing:${stacks.xing};
  --kai:var(--f-jing);
}`;

  const docTitle = meta.docTitle ||
    `${meta.title.replace(/ · /g, '·')} — ${meta.subtitle.replace(/ · /g, '')}`;

  const faceButtons = ['song', 'jing', 'xing'].map((role, i) => {
    const label = (meta.faces[role] && meta.faces[role].label) || role;
    return `<button class="btn seg-b${i === 0 ? ' on' : ''}" data-face="f-${role}" type="button">${esc(label)}</button>`;
  }).join('\n      ');

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
  <div class="facts">
    ${factsHtml(tree)}
  </div>
  <nav class="tools">
    <span class="seg" role="group" aria-label="字體">
      ${faceButtons}
    </span>
    <button class="btn txt on" id="mode" type="button" aria-pressed="false">摹本</button>
    <button class="btn txt" id="rule" type="button" aria-pressed="false">界行</button>
    <button class="btn ico" id="minus" type="button" aria-label="縮小">−</button>
    <button class="btn ico" id="plus" type="button" aria-label="放大">＋</button>
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
${VIEWER_JS().replace('__WRAP_H__', String(dims.wrapH))}
</script>
</body></html>`;
  return { html, warnings };
}

module.exports = { renderHtml };
