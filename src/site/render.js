/** 站點頁渲染：首頁「藏書」+ 書目頁「宋刻目錄葉」→ 自包含 HTML。
 *  字體：A 級小字庫子集（構建期產出至 dist/assets/fonts/）+ 系統回退鏈；
 *  子集缺失時 @font-face 404 自動落回退鏈，dev 預覽不構子集亦可讀。 */
const fs = require('fs');
const path = require('path');
const { loadRegistry, fontFileOf } = require('../fonts/fonts');
const { numCn } = require('./aggregate');

const SITE_CSS = () => fs.readFileSync(path.join(__dirname, 'site.css'), 'utf8');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* 站點字面：楷（題簽/大字）+ 宋（小字/落款）；僅取 A 級可嵌入者，B 級不入站點 */
const SITE_FONTS = [
  { role: 'kai', fontId: 'lxgw-wenkai-tc' },
  { role: 'song', fontId: 'zhuque-fangsong' },
];
const FALLBACK = {
  kai: '"Kaiti TC","Kaiti SC","STKaiti","楷体","KaiTi","BiauKai","標楷體","TW-Kai","AR PL UKai TW","Noto Serif CJK TC",serif',
  song: '"Songti TC","Songti SC","STSong","SimSun","宋体","NSimSun","Source Han Serif TC","Noto Serif CJK TC","Noto Serif CJK SC",serif',
};

/** 站點字體棧與 @font-face（子集文件就位與否不影響生成：缺失則瀏覽器落回退鏈） */
function siteFaces() {
  const registry = loadRegistry();
  const stacks = {};
  let faceCss = '';
  const subsettable = [];
  for (const { role, fontId } of SITE_FONTS) {
    const entry = registry[fontId];
    const file = entry && fontFileOf(entry);
    if (entry && file && entry.license === 'A' && entry.allowEmbed) {
      faceCss += `@font-face{font-family:"${entry.family}";src:url("/assets/fonts/${fontId}.woff2") format("woff2");font-display:swap;}`;
      stacks[role] = `"${entry.family}",${FALLBACK[role]}`;
      subsettable.push({ role, fontId, entry, file });
    } else {
      stacks[role] = FALLBACK[role];
    }
  }
  return { stacks, faceCss, subsettable };
}

function head(title, faces) {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#221d18">
<title>${esc(title)}</title>
<style>
:root{--kai:${faces.stacks.kai};--song:${faces.stacks.song};}
${faces.faceCss}
${SITE_CSS()}
</style>
</head>`;
}

/* ───── 首頁：藏書 ───── */
function renderIndex(site, faces) {
  const byCat = new Map();
  for (const b of site.books) {
    const c = b.category || '其他';
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c).push(b);
  }
  const cats = [...byCat.keys()].sort((a, b) => {
    const ia = site.catOrder.indexOf(a), ib = site.catOrder.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  const sections = cats.map((c) => {
    const spines = byCat.get(c).map((b) => {
      const long = [...b.title].length >= 6 ? ' tl' : '';
      return `    <a class="spine" href="${b.href}">
      <span class="tag${long}">${esc(b.title)}</span>
      <span class="n">${esc(b.caption)}</span>
      ${b.draft ? '<span class="dz">需點校</span>\n' : ''}</a>`;
    }).join('\n');
    return `  <section class="cat">
  <h2><span>${esc(c)}</span></h2>
  <div class="shelf">
${spines}
  </div>
  </section>`;
  }).join('\n');
  return `${head('蘭木 · 藏書', faces)}
<body class="idx">

<div class="masthead">
  <div class="zhu">蘭　木<span class="yin">蘭木</span></div>
  <p class="ke">一次校錄 · 多態呈現</p>
</div>

<main class="cabinet">
${sections}
</main>

<p class="foot">蘭木 · 書法 古籍 音樂之現代數字文創</p>

</body></html>`;
}

/* ───── 書目頁：宋刻目錄葉 ───── */
const COLS_PER_HALF = 8;
const FISH = '<svg viewBox="0 0 40 22" preserveAspectRatio="none" aria-hidden="true">' +
  '<path d="M0 0 H40 L34.5 22 L20 12.2 L5.5 22 Z" fill="rgba(36,28,20,.88)"/></svg>';

/* 目錄列序：首列為書名題字（「某某目錄」），後每卷一條（大字卷次 + 雙行小字篇名） */
function tocCols(book) {
  const cols = [{ type: 'title', text: `${book.title}目錄` }];
  for (const v of book.volumes) {
    cols.push({
      type: 'entry',
      big: (v.entry && v.entry.big) || v.title,
      sub: (v.entry && v.entry.sub) || '',
      href: v.href, draft: v.draft,
    });
  }
  return cols;
}

function colHtml(c) {
  if (c.type === 'title') return `<div class="tcol tb">${esc(c.text)}</div>`;
  const lines = c.sub ? c.sub.split('　').filter(Boolean) : [];
  const r = lines[0] || '';
  const l = lines.slice(1).join('　');
  const aria = c.big + (r ? `　${r}` : '') + (l ? `　${l}` : '') + (c.draft ? '（需點校）' : '');
  const big = `<span class="tcol tb">${esc(c.big)}${c.draft ? '<i class="dzm">需點校</i>' : ''}</span>`;
  if (!r) // 無篇名者（序）：僅大字單列，占一列
    return `<a class="tentry" href="${c.href}" aria-label="${esc(aria)}">${big}</a>`;
  return `<a class="tentry" href="${c.href}" aria-label="${esc(aria)}">${big}` +
    `<span class="tcol ts"><i>${esc(r)}</i>${l ? `<i>${esc(l)}</i>` : ''}</span></a>`;
}

function halfHtml(cols, side) {
  return `<div class="half ${side}"><div class="frame"><div class="textarea">${cols.map(colHtml).join('')}</div></div></div>`;
}

function banxinHtml(book, leafNo) {
  const grp = (s, cls) => `<div class="bg">` + [...s].map((ch) => `<div class="bc ${cls || ''}">${esc(ch)}</div>`).join('') + `</div>`;
  const gong = book.gong && book.gong.length ? book.gong[(leafNo - 1) % book.gong.length] : '';
  return `<div class="banxin"><div class="kou"></div>${FISH}` +
    `<div style="flex:0 0 auto;height:calc(var(--col-h)*.02)"></div>` +
    grp(`${book.title}目錄`) + `<div class="fill"></div>` +
    grp(numCn(leafNo)) +
    (gong ? `<div class="fill"></div>` + grp(gong, 'gong') : '') +
    `<div class="kou"></div></div>`;
}

/* 半葉裝版：題字列占 1 列；條目有篇名者占 2 列（大字列 + 雙行小字列）、無篇名者（序）占 1 列。
   半葉八列貪裝，不足留白 */
function packHalves(cols) {
  const halves = [];
  let cur = [], w = 0;
  for (const c of cols) {
    const cw = c.type === 'title' || !c.sub ? 1 : 2;
    if (w + cw > COLS_PER_HALF) { halves.push(cur); cur = []; w = 0; }
    cur.push(c); w += cw;
  }
  if (cur.length) halves.push(cur);
  return halves;
}

function renderToc(book, faces) {
  const halves = packHalves(tocCols(book));
  const leaves = [];
  for (let i = 0; i < halves.length; i += 2) leaves.push([halves[i], halves[i + 1] || []]);
  const leavesHtml = leaves.map(([r, l], i) => `  <div class="leafwrap">
  <div class="leaf">
    <div class="sheet">${halfHtml(r, 'hr')}${banxinHtml(book, i + 1)}${halfHtml(l, 'hl')}</div>
  </div>
  <div class="folio">第${numCn(i + 1)}葉　前半${numCn(i * 2 + 1)}　後半${numCn(i * 2 + 2)}</div>
  </div>`).join('\n');
  return `${head(`${book.title}目錄 — 蘭木藏書`, faces)}
<body class="toc">

<div class="masthead">
  <div class="zhu">${esc(book.title)}</div>
  <p class="ke">目　錄</p>
</div>

<div class="book ruled" aria-label="${esc(book.title)}目錄，自右向左讀">
${leavesHtml}
</div>

<p class="colophon">${esc(book.caption)} · 右目錄${numCn(leaves.length)}葉</p>
<p class="back"><a href="/index.html">回蘭木藏書</a></p>

</body></html>`;
}

module.exports = { siteFaces, renderIndex, renderToc, SITE_FONTS, FALLBACK };
