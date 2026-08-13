/** 站點頁渲染：首頁「藏書」+ 書目頁「宋刻目錄葉」→ 自包含 HTML。
 *  字體：A 級小字庫子集（構建期產出至 dist/assets/fonts/）+ 系統回退鏈；
 *  子集缺失時 @font-face 404 自動落回退鏈，dev 預覽不構子集亦可讀。 */
const fs = require('fs');
const path = require('path');
const OpenCC = require('opencc-js');
const { loadRegistry, fontFileOf } = require('../fonts/fonts');
const { numCn } = require('./aggregate');
const { NAV, TABS, TOPICS, COPY } = require('./home');

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

/* ───── 共用：頂部導航 / 書影 ───── */
function topnav() {
  const items = NAV.map((n) => `<a class="item" href="${n.href}">${esc(n.label)}</a>`).join('');
  return `<nav class="topnav"><a class="mk" href="/index.html">蘭木</a><span class="sp"></span>${items}</nav>`;
}

/* 書影：真書（鏈目錄/作品頁）與虛擬典籍（鏈「敬請期待」）共用 */
/* 點校圖標：精校●饱和实心圆、初校◐半圆、AI整理✦灰（currentColor 隨 .ico-<類> 切色；精校/初校同墨色，以飽和度區分） */
function icoSvg(col) {
  if (col === '精校') return '<svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="3.8" fill="currentColor"/></svg>';
  if (col === '初校') return '<svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M6 1.2a4.8 4.8 0 0 0 0 9.6z" fill="currentColor" opacity=".45"/></svg>';
  return '<svg viewBox="0 0 12 12"><path d="M6 1l1.4 3 3.2.4-2.3 2.2.6 3.2L6 8.6 3.1 9.8l.6-3.2L1.4 4.4l3.2-.4z" fill="currentColor"/></svg>';
}
function tomeHtml(title, href, caption, opts = {}) {
  const long = [...title].length >= 6 ? ' tl' : '';
  const col = opts.collation;
  const colHtml = col ? `<i class="ico ico-${col}">${icoSvg(col)}<em>${esc(col)}</em></i>` : '';
  const biHtml = opts.diben ? `\n      <span class="bi">${esc(opts.diben)}</span>` : '';
  const nHtml = opts.virt ? esc(caption) : `${esc(title)}${colHtml}`;
  return `    <a class="slot${opts.virt ? ' virt' : ''}" href="${href}">
      <span class="tome"><span class="tag${long}">${esc(title)}</span><span class="seal2">蘭木</span></span>
      <span class="plinth"></span>
      <span class="n">${nHtml}</span>${biHtml}
      ${opts.draft ? '<span class="dz">需點校</span>\n' : ''}</a>`;
}
const bookTome = (b) => tomeHtml(b.title, b.href, b.caption, { draft: b.draft, collation: b.collation, diben: b.diben });
const virtTome = (title) => tomeHtml(title, `/coming-soon/?t=${encodeURIComponent(title)}`, COPY.soon.title, { virt: true });

const masthead = (title, ke) => `<div class="masthead">
  <div class="zhu">${esc(title)}</div>
  <p class="ke">${esc(ke)}</p>
</div>`;
const backHome = `<p class="back"><a href="/index.html">${COPY.back}</a></p>`;
const FOOT = `<p class="foot">蘭木 · 書法 古籍 音樂之現代數字文創<br><span class="foot2">一次校錄 · 多態呈現</span></p>`;

/* ───── 首頁：門戶（檢索 + 簽條切換主視覺 + 專題推薦） ───── */
/* 檢索索引：書名/卷次/篇名，繁簡雙軌（簡體串由構建期 opencc 預轉，運行時零依賴）；
   虛擬典籍亦入索引，命中即示「敬請期待」 */
function searchIndex(site) {
  const conv = OpenCC.Converter({ from: 'tw', to: 'cn' });
  const real = site.books.map((b) => ({
    t: b.title, t2: conv(b.title), sub: `${b.caption} · 目錄`, href: b.href, draft: !!b.draft,
    vols: b.standalone ? [] : b.volumes.map((v) => {
      const big = (v.entry && v.entry.big) || v.title;
      const sub = (v.entry && v.entry.sub) || '';
      return { b: big, s: sub, b2: conv(big), s2: conv(sub), href: v.href, draft: v.draft };
    }),
  }));
  for (const t of TABS) {
    for (const title of t.virtual || []) {
      real.push({ t: title, t2: conv(title), sub: COPY.soon.title, href: `/coming-soon/?t=${encodeURIComponent(title)}`, draft: false, vols: [] });
    }
  }
  return real;
}

/* 檢索交互：即輸入即顯，↑↓ 選取、Enter 入首選、Esc 收合 */
const SEEK_JS = `(function(){
var D=window.SITE_INDEX||[],inp=document.getElementById('seekIn'),list=document.getElementById('seekList'),go=document.getElementById('seekGo');
var cur=[],sel=-1;
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;')}
function find(q){var out=[],vol=[],i,j,b,v;
  for(i=0;i<D.length;i++){b=D[i];
    if(b.t.indexOf(q)>-1||b.t2.indexOf(q)>-1)out.push({t:b.t,s:b.sub,href:b.href,draft:b.draft});
    for(j=0;j<b.vols.length;j++){v=b.vols[j];
      if(v.b.indexOf(q)>-1||v.s.indexOf(q)>-1||v.b2.indexOf(q)>-1||v.s2.indexOf(q)>-1)
        vol.push({t:b.t+' · '+v.b,s:v.s,href:v.href,draft:v.draft});}}
  return out.concat(vol).slice(0,9);}
function render(){
  if(!cur.length){list.style.display='none';list.innerHTML='';return;}
  list.innerHTML=cur.map(function(r,i){
    return '<li role="option" class="'+(i===sel?'on':'')+'" data-i="'+i+'"><a href="'+r.href+'">'+
      '<span class="rt">'+esc(r.t)+(r.draft?'<em class="dzi">需點校</em>':'')+'</span>'+
      '<span class="rs">'+esc(r.s)+'</span></a></li>';}).join('');
  list.style.display='block';}
function close(){cur=[];sel=-1;render();}
inp.addEventListener('input',function(){var q=inp.value.trim();if(!q){close();return;}cur=find(q);sel=cur.length?0:-1;render();});
inp.addEventListener('keydown',function(e){
  if(e.key==='Escape'){close();inp.blur();}
  else if(e.key==='ArrowDown'&&cur.length){sel=(sel+1)%cur.length;render();e.preventDefault();}
  else if(e.key==='ArrowUp'&&cur.length){sel=(sel-1+cur.length)%cur.length;render();e.preventDefault();}
  else if(e.key==='Enter'&&cur.length){location.href=cur[sel<0?0:sel].href;}});
go.addEventListener('click',function(){if(cur.length)location.href=cur[sel<0?0:sel].href;});
list.addEventListener('mousedown',function(e){var li=e.target.closest('li');if(li)e.preventDefault();});
document.addEventListener('click',function(e){if(!e.target.closest('.seek'))close();});
})();`;

/* 首頁文質頁簽：四時/四書切換（原部類頁簽位）。
   無 JS 時兩面板上下直陳全可見（漸進增強退路）——JS 啟動加 .js 類，僅隱非選中面板。 */
const TAB_JS = `(function(){
var root=document.documentElement;
root.classList.add('js');
var tabs=document.querySelectorAll('.tabs button'),panels=document.querySelectorAll('.hpanel');
function show(n){for(var i=0;i<tabs.length;i++){var on=i===n;
tabs[i].classList.toggle('on',on);tabs[i].setAttribute('aria-selected',on?'true':'false');
panels[i].classList.toggle('hide',!on);}}
show(0);
for(var i=0;i<tabs.length;i++)(function(n){tabs[n].addEventListener('click',function(){show(n)})})(i);
})();`;

/* 三藏頁部類頁簽（0327 版行為）：無 JS 時僅見首部（儒家經典），與「不放全帙」一致 */
const SANZANG_TAB_JS = `(function(){
var tabs=document.querySelectorAll('.tabs button'),panels=document.querySelectorAll('.tabpanel');
function show(n){for(var i=0;i<tabs.length;i++){var on=i===n;
tabs[i].classList.toggle('on',on);tabs[i].setAttribute('aria-selected',on?'true':'false');
panels[i].style.display=on?'block':'none';}}
for(var i=0;i<tabs.length;i++)(function(n){tabs[n].addEventListener('click',function(){show(n)})})(i);
})();`;

/* 書目分組（書庫全帙用） */
function groupByCat(site) {
  const byCat = new Map();
  for (const b of site.books) {
    const c = b.category || '其他';
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c).push(b);
  }
  return [...byCat.keys()].sort((a, b) => {
    const ia = site.catOrder.indexOf(a), ib = site.catOrder.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  }).map((c) => [c, byCat.get(c)]);
}

const seekHtml = `<div class="seek">
  <input id="seekIn" type="search" placeholder="檢書名 · 篇名" autocomplete="off" aria-label="檢索書名篇名">
  <button id="seekGo" type="button">檢索</button>
  <ul class="seek-list" id="seekList" role="listbox" aria-label="檢索結果"></ul>
</div>`;

/* 卷影屏：單扇——取 dist/assets/topics/<id>.jpg，缺圖落佔位。
 * 整扇即 <a> 鏈作品頁；扇下綴季節朱字 + 題名小字。 */
function panelFan(b, mark, panels) {
  const href = b.href;
  const title = b.title;
  const hasImg = panels && panels[b.id];
  const src = hasImg ? `/assets/topics/${b.id}.jpg` : '';
  const inner = hasImg
    ? `<img src="${src}" alt="${esc(title)}" loading="lazy">`
    : `<span class="ph-t">${esc(title)}</span><span class="ph-s">${esc(mark || '')}</span>`;
  return `    <a class="fan${hasImg ? '' : ' ph'}" href="${href}">
      ${inner}
      <span class="fan-cap"><i class="fan-m">${esc(mark || '')}</i><em class="fan-n">${esc(title)}</em></span>
    </a>`;
}

/* 共用：蘭木卷首（首頁與三藏頁同式）與專題推薦卡區 */
const HOME_MASTHEAD = `<div class="masthead">
  <div class="zhu">蘭 木<span class="yin">蘭木</span></div>
  <p class="ke">聲微志遠，此弄宜緩</p>
</div>`;

function topicsSec() {
  const topics = TOPICS.map((t) => {
    const n = (t.books || []).length + (t.virtual || []).length;
    return `    <a class="topic" href="/topics/${t.id}/index.html">
      <span class="tt">${esc(t.title)}</span>
      <span class="td"><span class="tdd">${esc(t.desc)}</span><span class="tn">凡${numCn(n)}種</span></span>
    </a>`;
  }).join('\n');
  return `<section class="topics">
  <h2><span>${esc(COPY.topicHead)}</span></h2>
  <div class="tgrid">
${topics}
  </div>
</section>`;
}

/* 首頁：門戶（檢索 + 文質頁簽主視覺 + 專題推薦 + 三藏入口） */
function renderHome(site, faces, panels) {
  const byId = new Map(site.books.map((b) => [b.id, b]));
  const [wen, zhi] = TOPICS;

  /* 文質頁簽（原部類頁簽位）：四時幽賞（文）置前、四書涵泳（質）次之 —— 先文後質 */
  const qTabs = [wen.title, zhi.title].map((label, i) =>
    `<button role="tab" id="tab-${i}" aria-controls="tp-${i}" aria-selected="${i === 0}"${i === 0 ? ' class="on"' : ''}>${esc(label)}</button>`
  ).join('');

  /* 四時面板：四扇卷影屏（春夏秋冬） */
  const fans = (wen.books || []).map((id) => {
    const b = byId.get(id);
    if (!b) return '';
    return panelFan(b, wen.marks && wen.marks[id], panels);
  }).join('\n');

  /* 四書面板：瓷青書影四部（鏈 /books/<id>/） */
  const sishuTomes = (zhi.books || []).map((id) => byId.get(id)).filter(Boolean).map(bookTome).join('\n');

  const twoPanels = `  <div class="tabpanel hpanel" id="tp-0" role="tabpanel" aria-labelledby="tab-0">
  <div class="fans">
${fans}
  </div>
  </div>
  <div class="tabpanel hpanel" id="tp-1" role="tabpanel" aria-labelledby="tab-1">
  <div class="shelf center">
${sishuTomes}
  </div>
  </div>`;

  return `${head('蘭木 · 藏書', faces)}
<body class="idx">

${topnav()}

${HOME_MASTHEAD}

${seekHtml}

<div class="tabs" role="tablist" aria-label="文質">${qTabs}</div>
<div class="tabwrap">
${twoPanels}
</div>

${topicsSec()}

<p class="shukulink"><a href="/sanzang/">${esc(COPY.enterSanzang)} <i>·</i> ${esc(COPY.sanzangSub)} →</a></p>

${FOOT}

<script>window.SITE_INDEX=${JSON.stringify(searchIndex(site))};</script>
<script>${SEEK_JS}</script>
<script>${TAB_JS}</script>
</body></html>`;
}

/* 三藏頁（/sanzang/）：0327 版首頁原樣遷存（tag「三藏首頁」）——
 * 檢索 + 儒釋道部類頁簽 + 專題推薦。不廢棄，作首頁底端「藏」之入口。 */
function renderSanzang(site, faces) {
  const byId = new Map(site.books.map((b) => [b.id, b]));
  const tabBtns = TABS.map((t, i) =>
    `<button role="tab" id="tab-${i}" aria-controls="tp-${i}" aria-selected="${i === 0}"${i === 0 ? ' class="on"' : ''}>${esc(t.key)}</button>`).join('');
  const panels = TABS.map((t, i) => {
    const tomes = [
      ...(t.books || []).map((id) => byId.get(id)).filter(Boolean).map(bookTome),
      ...(t.virtual || []).map(virtTome),
    ].join('\n');
    return `  <div class="tabpanel" id="tp-${i}" role="tabpanel" aria-labelledby="tab-${i}"${i ? ' style="display:none"' : ''}>
  <div class="shelf">
${tomes}
  </div>
  </div>`;
  }).join('\n');
  return `${head('三藏 · 蘭木藏書', faces)}
<body class="idx">

${topnav()}

${HOME_MASTHEAD}

${seekHtml}

<div class="tabs" role="tablist" aria-label="部類">${tabBtns}</div>
<div class="tabwrap">
${panels}
</div>

${topicsSec()}

${FOOT}

<script>window.SITE_INDEX=${JSON.stringify(searchIndex(site))};</script>
<script>${SEEK_JS}</script>
<script>${SANZANG_TAB_JS}</script>
</body></html>`;
}

/* 書庫：全帙一覽（真書；虛擬典籍在三藏頁部類頁簽） */
function renderShuku(site, faces) {
  const cats = groupByCat(site);
  const catnav = cats.map(([c], i) => `<a href="#cat-${i}">${esc(c)}</a>`).join('<i>·</i>');
  const sections = cats.map(([c, books], i) => {
    const tomes = books.map(bookTome).join('\n');
    return `  <section class="cat" id="cat-${i}">
  <h2><span>${esc(c)}</span></h2>
  <div class="shelf">
${tomes}
  </div>
  </section>`;
  }).join('\n');
  return `${head('書庫 · 蘭木藏書', faces)}
<body class="idx">

${topnav()}
${masthead('書 庫', '全帙一覽')}

<nav class="catnav" aria-label="部類">${catnav}</nav>

<main class="cabinet">
${sections}
</main>

${FOOT}

</body></html>`;
}

/* 專題頁：專題內書影（真書 + 虛擬典籍） */
function renderTopic(topic, site, faces) {
  const byId = new Map(site.books.map((b) => [b.id, b]));
  const tomes = [
    ...(topic.books || []).map((id) => byId.get(id)).filter(Boolean).map(bookTome),
    ...(topic.virtual || []).map(virtTome),
  ].join('\n');
  return `${head(`${topic.title} · ${COPY.topicLabel} — 蘭木藏書`, faces)}
<body class="idx">

${topnav()}
${masthead(topic.title, COPY.topicLabel)}

<p class="tintro">${esc(topic.desc)}</p>

<main class="cabinet">
  <div class="shelf center">
${tomes}
  </div>
</main>

${backHome}
${FOOT}

</body></html>`;
}

/* 敬請期待：虛擬典籍落點（?t=書名 由腳本換題） */
function renderComingSoon(faces) {
  return `${head('敬請期待 — 蘭木藏書', faces)}
<body class="idx">

${topnav()}

<div class="masthead">
  <div class="zhu" id="soonT">${COPY.soon.title}</div>
  <p class="ke" id="soonS">${COPY.soon.sub}</p>
</div>

${backHome}
${FOOT}

<script>(function(){var m=location.search.match(/[?&]t=([^&]+)/);if(!m)return;
var t=decodeURIComponent(m[1]).slice(0,24);
document.getElementById('soonT').textContent=t;
document.getElementById('soonS').textContent='${COPY.soon.sub} · ${COPY.soon.title}';
document.title=t+' — ${COPY.soon.title}';})();</script>
</body></html>`;
}

/* 我是校書官：點校招募 */
function renderJiaoshu(faces) {
  const lines = COPY.jiaoshu.lines.map((s, i) =>
    `  <p${i === COPY.jiaoshu.lines.length - 1 ? ' class="dim"' : ''}>${esc(s)}</p>`).join('\n');
  return `${head(`${COPY.jiaoshu.title} — 蘭木藏書`, faces)}
<body class="idx">

${topnav()}
${masthead(COPY.jiaoshu.title, COPY.jiaoshu.sub)}

<div class="recruit">
${lines}
</div>

${backHome}
${FOOT}

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
  const lines = c.sub ? c.sub.split(' ').filter(Boolean) : [];
  const r = lines[0] || '';
  const l = lines.slice(1).join(' ');
  const aria = c.big + (r ? ` ${r}` : '') + (l ? ` ${l}` : '') + (c.draft ? '（需點校）' : '');
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
  <div class="folio">第${numCn(i + 1)}葉 前半${numCn(i * 2 + 1)} 後半${numCn(i * 2 + 2)}</div>
  </div>`).join('\n');
  return `${head(`${book.title}目錄 — 蘭木藏書`, faces)}
<body class="toc">

<div class="masthead">
  <div class="zhu">${esc(book.title)}</div>
  <p class="ke">目 錄</p>
</div>

<div class="book ruled" aria-label="${esc(book.title)}目錄，自右向左讀">
${leavesHtml}
</div>

<p class="colophon">${esc(book.caption)} · 右目錄${numCn(leaves.length)}葉</p>
<p class="back"><a href="/index.html">回蘭木藏書</a></p>

</body></html>`;
}

module.exports = { siteFaces, renderHome, renderSanzang, renderShuku, renderTopic, renderComingSoon, renderJiaoshu, renderToc, SITE_FONTS, FALLBACK };
