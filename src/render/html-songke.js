/**
 * 宋版善刻 HTML 渲染器：LayoutTree(songke) → 自包含書葉 HTML。
 * 字面字體：A 級子集（fonts/*.woff2）嵌入，無文件則回退鏈；
 * 繁簡切換：構建期以 opencc-js 生成本作用字映射內嵌（運行時逐字轉換）。
 */
const fs = require('fs');
const path = require('path');
const OpenCC = require('opencc-js');
const { loadRegistry, resolveFace } = require('../fonts/fonts');
const { BOOK_META, NETDISK_FOLDER } = require('../site/home');

/* 構建期繁→簡轉換器：用於 UI 文案簡體化 */
const _t2s = OpenCC.Converter({ from: 'tw', to: 'cn' });

const SONGKE_CSS = () => fs.readFileSync(path.join(__dirname, '..', 'viewer', 'songke.css'), 'utf8');
const SONGKE_JS = () => fs.readFileSync(path.join(__dirname, '..', 'viewer', 'songke.js'), 'utf8');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* 列陣編碼：token → [字, 朱點有無(0|1), 朱點變化碼(0–15)]，壓縮內嵌體積；
   g 為經注合欄時注起始處所空小字符數（純注列省略） */
function encodeCol(c) {
  const tk = (t) => [t.c, t.m || 0, t.v || 0];
  const o = { b: c.big.map(tk), s: [c.subs[0].map(tk), c.subs[1].map(tk)] };
  if (c.g) o.g = c.g;
  return o;
}

/* 注文雙行字數 → 中文數目（二十 / 二十二 / 二十五），供各版 spec 文案 */
function cnSub(n) {
  const d = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  return (n >= 20 ? '二' : d[Math.floor(n / 10)]) + '十' + (n % 10 ? d[n % 10] : '');
}

/* 構建期生成繁→簡逐字映射（僅收錄本作用字 + 界面文案） */
function buildT2S(tree) {
  const chars = new Set();
  for (const b of tree.blocks) for (const ch of b.text) chars.add(ch);
  const m = tree.meta;
  for (const ch of (m.title || '') + (m.subtitle || '') + (m.songke && m.songke.colophon || '') + (m.songke && m.songke.spec || '')) chars.add(ch);
  for (const v of tree.volumes || []) for (const ch of v.title) chars.add(ch);
  for (const f of Object.values(m.faces || {})) for (const ch of (f.label || '')) chars.add(ch);
  for (const ch of '經注並朱惟施白文無點後葉疏朗雅正宋槧目錄藏書') chars.add(ch);
  const map = {};
  for (const ch of chars) {
    const s = _t2s(ch);
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
  // 分級發布：stage==='draft' 的卷次未完成點校。
  // 默認模式：數據含全帙正文 → 僅展示首葉書影（payload 截斷，防源碼洩露），不出 PDF；
  // teaser 模式（draftNotice.display==='teaser'）：數據本身即為安全導覽內容（序全文 + 每章導語/最小摘句），全文渲染。
  const draft = meta.stage === 'draft';
  const draftTruncate = draft && ((meta.draftNotice || {}).display !== 'teaser');

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
      cols: (draftTruncate ? v.columns.slice(0, tree.conf.colsPerHalf * 2) : v.columns).map(encodeCol),
      volumes: v.volumes,
    })),
    title: meta.title,
    banxinTitle: sk.banxinTitle || meta.title,
    gong: sk.gong || [],
    seals: tree.seals || [],
    faces: Object.entries(meta.faces || {}).map(([role, f]) => ({ role, label: f.label || role })),
    colophon: sk.colophon || '',
    navLabel: meta.book && meta.book.id ? '目錄' : '藏書',
  };

  // 回鏈：屬書之卷 → 本書目錄葉；單卷 → 藏書首頁
  const navHref = meta.book && meta.book.id
    ? `../../books/${meta.book.id}/index.html`
    : '../../index.html';

  const docTitle = meta.docTitle || `${meta.title} — ${meta.subtitle || ''}`;
  const exp = meta.export || {};
  const expBase = exp.base || `${meta.id}-songke`;
  // 下載菜單：每字面一版 PDF（不再生成/提供 JPG、PNG 長圖）；點校未完成（draft）的卷次不提供下載。
  // 默認構建僅出預覽葉數 PDF（--pdf-full 方出全帙），菜單據此標注
  const pdfFull = !!(opts && opts.pdfFull);
  const pv = Math.min(exp.previewLeaves || 5, 9);
  const pvCn = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'][pv];
  const dlItems = Object.entries(exp.faces || { kai: 'Kai', song: 'Song' }).map(([role, tag]) => {
    const raw = (meta.faces[role] && meta.faces[role].label) || role;
    const label = _t2s(raw);
    const file = `${expBase}-${tag}.pdf`;
    const tip = pdfFull ? '' : ' title="前五叶预览"';
    return `<a class="dl-item" role="menuitem" href="${file}" download="${file}"${tip}>${esc(label)}试读</a>`;
  }).join('');
  // 全帙 PDF 走網盤：獨立鏈接（meta.netdisk / 屬書 BOOK_META）→ 共享文件夾兕底
  const bookMeta = (meta.book && BOOK_META[meta.book.id]) || {};
  const ndLink = meta.netdisk || bookMeta.netdisk || NETDISK_FOLDER;
  const ndLabel = meta.netdisk || bookMeta.netdisk ? '全量资源 · 网盘' : '全量资源 · 网盘共享夹';
  const ndItem = ndLink ? `<div class="dl-sep" role="separator"></div><a class="dl-item" role="menuitem" href="${esc(ndLink)}" target="_blank" rel="noopener">${ndLabel}</a>` : '';

  // 點校提示卡：僅 draft 卷渲染（正文未公開聲明 + 外部公開站鏈接 + 點校群招募）
  const dn = meta.draftNotice || {};
  const extItems = (dn.extLinks || []).map((l) =>
    `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a></li>`).join('');
  const draftCard = draft ? `<section class="draft-card" id="draftCard">
  <p class="dc-badge">需點校</p>
  <h2 class="dc-title">${esc(dn.title || '本卷正在點校，正文暫未公開')}</h2>
  <p class="dc-text">${esc(dn.text || '本卷文本尚經細校，依「寧缺毋濫」之則，點校藏事前僅示書葉版式與卷首題序。')}</p>
  ${extItems ? `<p class="dc-sub">同文可先於以下公開站瀏覽：</p><ul class="dc-links">${extItems}</ul>` : ''}
  ${dn.group ? `<p class="dc-group">${esc(dn.group)}</p>` : ''}
  ${dn.contact ? `<p class="dc-contact">參與點校：${esc(dn.contact)}</p>` : ''}
</section>` : '';
  const draftCss = draft ? `
.draft-card{max-width:42rem;margin:2.2rem auto 0;padding:1.6rem 1.8rem;border:1px solid rgba(216,198,160,.28);background:rgba(44,38,29,.72);color:rgba(228,214,186,.92);font-family:var(--kai);line-height:1.9}
.draft-card .dc-badge{display:inline-block;padding:.1rem .7rem;border:1px solid rgba(196,60,44,.75);color:#e8b4a0;font-size:.8rem;letter-spacing:.35em}
.draft-card .dc-title{margin:.7rem 0 .4rem;font-size:1.15rem;letter-spacing:.12em;color:#e5d3ae}
.draft-card .dc-text{margin:0 0 .8rem;font-size:.92rem}
.draft-card .dc-sub{margin:.2rem 0;font-size:.88rem;color:rgba(228,214,186,.72)}
.draft-card .dc-links{margin:.2rem 0 .8rem;padding-left:1.2em;font-size:.9rem}
.draft-card .dc-links a{color:#d8b98a;text-decoration:none;border-bottom:1px dotted rgba(216,185,138,.5)}
.draft-card .dc-group,.draft-card .dc-contact{margin:.3rem 0 0;font-size:.88rem;color:rgba(228,214,186,.8)}
` : '';

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
${draftCss}
</style>
</head>
<body>

<div class="masthead">
  <div class="zhu" id="mhTitle"></div>
  <p class="ke" id="mhSub"></p>
</div>

<div class="bar">
  <a class="btn nav" id="navToc" href="${navHref}"></a>
  <span class="sep"></span>
  <button id="btnZh" aria-pressed="false"></button>
  <button id="btnJie" aria-pressed="true"></button>
  <select id="faceSel" aria-label="字面"></select>
  <select id="zhuwenSel" aria-label="注文版式"></select>
  <span class="sep"></span>
  <button id="btnMode" aria-pressed="false"></button>
  <button id="btnPrev"></button>
  <span class="lbl" id="folioNow"></span>
  <button id="btnNext"></button>
  <span class="sep"></span>
  ${draft ? '' : `<div class="dl">
    <button class="btn" id="dl" type="button" aria-haspopup="true">下载</button>
    <div class="dl-menu" id="dlMenu" role="menu" aria-label="下载">
    ${dlItems}
    ${ndItem}
    </div>
  </div>
  <span class="sep"></span>`}
  <label for="zoom" id="lblZoom"></label>
  <input id="zoom" type="range" min="14" max="36" step="1" value="26">
  <button id="btnDu" aria-pressed="true"></button>
</div>

<div id="book" class="book ruled" aria-label="${esc(meta.ariaLabel || meta.title)}"></div>
${draftCard}
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
