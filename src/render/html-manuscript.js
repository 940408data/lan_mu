/**
 * 明人写本 HTML 渲染器：LayoutTree(manuscript) → 自包含整册 HTML。
 * 复刻传姜立纲抄本《史记》神韵：无界格竖行大字、朱笔句读、台阁楷墨韵；
 * 纸张纹理种子化（水渍/虫蛀/霉斑/虫道/透背）；双叶跨页 + 中缝折叶 + 书口叠层纸边；
 * 整册页序：封面 → 扉叶 → 题跋 → 正文诸叶 → 末扉叶 → 后封面。
 * 设计单位：跨页 1116×1008（半叶 540 + 书口边 18×2）；封面 624×1008。
 */
const path = require('path');
const { loadRegistry, resolveFace } = require('../fonts/fonts');
const { paperSvg } = require('../core/paper');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* 版面几何（设计单位 px） */
const G = {
  halfW: 540, halfH: 1008, edge: 18, spreadW: 1116,
  char: 42, colPitch: 61, charPitch: 43, top: 108, colRight0: 510,
  coverW: 624, coverH: 1008,
};

/* 逐字微变换：j(0-7) 错位 / h(0-9) 欹侧 */
function chTransform(m) {
  const dx = (((m.j & 3) - 1.5) * 0.7).toFixed(2);
  const dy = (((m.j >> 2) - 0.5) * 0.9).toFixed(2);
  const r = ((m.h - 4.5) * 0.45).toFixed(2);
  return `translate(${dx}px,${dy}px) rotate(${r}deg)`;
}

/* 单行（竖列）：字 + 朱点 */
function colHtml(row, colIdx, withDots) {
  const right = G.colRight0 - colIdx * G.colPitch;
  const left = right - G.char;
  const out = [`<div class="ms-col" style="left:${left}px">`];
  row.chars.forEach((ch, ci) => {
    if (!ch) return; // 坐标直出：空行留白（不占 DOM，但 top 仍由 ci 行号决定）
    const top = G.top + ci * G.charPitch + (row.drop || 0) * G.charPitch;
    const m = row.marks[ci];
    out.push(`<i class="ms-ch k${m.k}" style="top:${top}px;transform:${chTransform(m)}">${esc(ch)}</i>`);
    if (withDots && row.doudu[ci]) {
      out.push(`<b class="ms-dot" style="top:${top + G.char - 7}px;left:${G.char - 7}px"></b>`);
    }
  });
  out.push('</div>');
  return out.join('');
}

/* 透背层：反面文字镜像低透明度 */
function bleedHtml(rows) {
  if (!rows || !rows.length) return '';
  const out = ['<div class="ms-bleed" aria-hidden="true">'];
  rows.forEach((r, i) => { out.push(colHtml(r, i, false)); });
  out.push('</div>');
  return out.join('');
}

/* 半叶：纸 + 透背 + 行 */
function halfHtml(rows, o) {
  const paper = paperSvg(o.seed, { w: G.halfW, h: G.halfH, decor: o.decor });
  return `<div class="ms-half ${o.side}">${paper}${o.bleed ? bleedHtml(o.bleedRows) : ''}${rows.map((r, i) => colHtml(r, i, true)).join('')}</div>`;
}

/* 钤印（卷首叶） */
function sealsHtml(seals) {
  return (seals || []).map((s) => {
    const w = s.w / 100 * G.spreadW;
    const h = s.h / 100 * G.halfH;
    const chars = [...String(s.chars)];
    const rot = `rotate(${s.rotate || 0}deg)`;
    if (s.shape === 'oval') {
      return `<span class="ms-seal ov" style="left:${s.x}%;top:${s.y}%;width:${w}px;height:${h}px;transform:${rot};font-size:${Math.floor(w / 2) - 2}px">${chars.map((c) => `<i>${esc(c)}</i>`).join('')}</span>`;
    }
    // 方印：田字格，右列先（DOM 序：右上 左上 右下 左下）
    const order = chars.length === 4 ? [chars[0], chars[2], chars[1], chars[3]] : chars;
    return `<span class="ms-seal sq" style="left:${s.x}%;top:${s.y}%;width:${w}px;height:${h}px;transform:${rot};font-size:${Math.floor(w / 2) - 7}px">${order.map((c) => `<i>${esc(c)}</i>`).join('')}</span>`;
  }).join('');
}

/* 双叶跨页 */
function spreadHtml(leaf, leafIdx, tree) {
  const seed = (tree.meta.seed || 1) + leafIdx * 131;
  const decor = tree.paper || {};
  const bleedOn = decor.bleed !== false;
  const right = halfHtml(leaf.right, { side: 'ms-right', seed: seed + 7, decor, bleed: bleedOn && !!leaf.right.length, bleedRows: leaf.left });
  const left = halfHtml(leaf.left, { side: 'ms-left', seed: seed + 13, decor, bleed: bleedOn && !!leaf.left.length, bleedRows: leaf.right });
  const fe = tree.conf.foreEdge === 'left' ? 'fe-l' : 'fe-r';
  const seals = leafIdx === 0 ? sealsHtml(tree.seals) : '';
  return `<div class="ms-spread ${fe}">${right}${left}<div class="ms-gutter"></div>${seals}</div>`;
}

/* 封面（靛灰布面 + 线装眼） */
function coverHtml(side) {
  const stitchX = side === 'front' ? 592 : 32;
  const tickTo = side === 'front' ? 624 : 0;
  const ticks = [70, 350, 658, 938].map((y) => `<line x1="${stitchX}" y1="${y}" x2="${tickTo}" y2="${y}"/>`).join('');
  return `<div class="ms-cover"><svg class="ms-stitch" viewBox="0 0 624 1008" preserveAspectRatio="none" aria-hidden="true"><g stroke="#d9d2c0" stroke-width="3.4" opacity="0.9"><line x1="${stitchX}" y1="14" x2="${stitchX}" y2="994"/>${ticks}</g></svg></div>`;
}

/* 扉叶（空白纸；末扉叶带虫道） */
function flyleafHtml(tree, end) {
  const seed = (tree.meta.seed || 1) + (end ? 977 : 555);
  const decor = { stain: 0, holes: 2, fox: 10, trails: end ? 2 : 0 };
  const half = (side, sd) => halfHtml([], { side, seed: sd, decor, bleed: false });
  const fe = tree.conf.foreEdge === 'left' ? 'fe-l' : 'fe-r';
  return `<div class="ms-spread ${fe}">${half('ms-right', seed + 1)}${half('ms-left', seed + 2)}<div class="ms-gutter"></div></div>`;
}

/* 题跋页（奶油纸 + 褐签 + 行书跋 + 钤印） */
function colophonHtml(tree) {
  const seed = (tree.meta.seed || 1) + 313;
  const colo = (tree.book && tree.book.colophon) || {};
  const text = colo.text || '';
  const half = (side, sd, extra) => `<div class="ms-half ${side}">${paperSvg(sd, { w: G.halfW, h: G.halfH, decor: { stain: 0, holes: 1, fox: 8 } })}${extra || ''}</div>`;
  const slip = `<div class="ms-slip"><div class="ms-colo-text">${esc(text)}</div>
<span class="ms-seal sq" style="left:6%;top:60%;width:52px;height:52px;transform:rotate(-2deg);font-size:19px"><i>鼎</i><i>臣</i></span>
<span class="ms-seal sq" style="left:38%;top:52%;width:46px;height:46px;transform:rotate(1.6deg);font-size:16px"><i>收</i><i>藏</i></span>
<span class="ms-seal ov" style="left:5%;top:70%;width:44px;height:78px;transform:rotate(1deg);font-size:18px"><i>金</i><i>樓</i></span></div>`;
  const fe = tree.conf.foreEdge === 'left' ? 'fe-l' : 'fe-r';
  return `<div class="ms-spread ${fe}">${half('ms-right', seed + 1)}${half('ms-left', seed + 2, slip)}<div class="ms-gutter"></div></div>`;
}

const MS_CSS = `
html,body{margin:0;padding:0;background:#37352f;}
body{font-family:var(--ms-kai);}
.ms-stage{min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:14px 0 64px;}
#ms-fit{position:relative;}
.ms-scalebox{transform-origin:top left;transform:scale(var(--ms-scale,1));}
.ms-page{display:none;}
.ms-page.on{display:block;}
.ms-spread{position:relative;width:${G.spreadW}px;height:${G.halfH}px;box-shadow:0 14px 44px rgba(0,0,0,.6);}
.ms-half{position:absolute;top:0;width:${G.halfW}px;height:${G.halfH}px;overflow:hidden;}
.ms-half.ms-left{left:${G.edge}px;}
.ms-half.ms-right{left:${G.edge + G.halfW}px;}
.ms-paper{position:absolute;inset:0;width:100%;height:100%;display:block;}
/* 半叶微弧曲面：中缝侧阴影 + 外缘高光/暗带 */
.ms-half::after{content:"";position:absolute;inset:0;pointer-events:none;background:
 linear-gradient(90deg,rgba(70,45,20,0) 93%,rgba(255,252,240,.22) 96.5%,rgba(70,45,20,.18) 100%),
 linear-gradient(270deg,rgba(70,45,20,0) 93%,rgba(255,252,240,.22) 96.5%,rgba(70,45,20,.18) 100%);}
.ms-half.ms-left::before{content:"";position:absolute;inset:0;pointer-events:none;z-index:3;background:linear-gradient(270deg,rgba(58,38,18,.22),rgba(58,38,18,0) 7%);}
.ms-half.ms-right::before{content:"";position:absolute;inset:0;pointer-events:none;z-index:3;background:linear-gradient(90deg,rgba(58,38,18,.22),rgba(58,38,18,0) 7%);}
/* 中缝折叶阴影 */
.ms-gutter{position:absolute;left:${G.edge + G.halfW - 15}px;top:0;width:30px;height:100%;z-index:4;pointer-events:none;background:linear-gradient(90deg,rgba(0,0,0,0),rgba(58,38,18,.24) 40%,rgba(38,24,10,.42) 50%,rgba(58,38,18,.24) 60%,rgba(0,0,0,0));}
/* 书口叠层纸边带 */
.ms-spread::before,.ms-spread::after{content:"";position:absolute;top:5px;height:${G.halfH - 10}px;width:7px;opacity:.55;background:repeating-linear-gradient(90deg,#e6d9b8 0 1px,#c9b78f 1px 2px,#efe3c6 2px 3px);}
.ms-spread::before{left:${G.edge - 8}px;border-radius:2px 0 0 2px;}
.ms-spread::after{right:${G.edge - 8}px;border-radius:0 2px 2px 0;}
.ms-spread.fe-r::after{width:${G.edge}px;opacity:.95;box-shadow:inset -3px 0 4px rgba(90,60,30,.4);}
.ms-spread.fe-l::before{width:${G.edge}px;opacity:.95;box-shadow:inset 3px 0 4px rgba(90,60,30,.4);}
/* 行与字 */
.ms-col{position:absolute;top:0;width:${G.char}px;z-index:2;}
.ms-ch{position:absolute;left:0;width:${G.char}px;height:${G.char}px;font-style:normal;font-family:var(--ms-kai);font-size:${G.char}px;line-height:${G.char}px;color:#1d1a16;text-align:center;}
.k0{opacity:1}.k1{opacity:.93}.k2{opacity:.86}.k3{opacity:.77}.k4{opacity:.68}
/* 朱笔句读 */
.ms-dot{position:absolute;width:5.5px;height:5.5px;border-radius:50%;background:#b3372e;opacity:.88;z-index:2;}
/* 透背 */
.ms-bleed{position:absolute;inset:0;transform:scaleX(-1);opacity:.055;filter:blur(.7px);pointer-events:none;z-index:1;}
.ms-bleed .ms-ch{opacity:.9;}
/* 钤印 */
.ms-seal{position:absolute;color:#b3372e;border:3px solid currentColor;mix-blend-mode:multiply;opacity:.86;z-index:5;display:grid;grid-template-columns:1fr 1fr;direction:rtl;place-items:center;padding:3px;box-sizing:border-box;border-radius:4px;font-family:var(--ms-kai);font-weight:700;}
.ms-seal i{font-style:normal;line-height:1;}
.ms-seal.ov{border-radius:50%;grid-template-columns:1fr;direction:ltr;border-width:2.5px;}
/* 封面 */
.ms-cover{position:relative;width:${G.coverW}px;height:${G.coverH}px;background:
 repeating-linear-gradient(0deg,rgba(255,255,255,.045) 0 1px,rgba(0,0,0,0) 1px 3px),
 repeating-linear-gradient(90deg,rgba(255,255,255,.04) 0 1px,rgba(0,0,0,0) 1px 3px),
 radial-gradient(120% 90% at 50% 45%,#4b4b55 0%,#43434c 62%,#393941 100%);
 border-radius:5px;box-shadow:0 14px 44px rgba(0,0,0,.65);}
.ms-stitch{position:absolute;inset:0;width:100%;height:100%;}
/* 题跋签 */
.ms-slip{position:absolute;left:7%;top:13%;width:86%;height:74%;background:
 radial-gradient(100% 100% at 50% 50%,rgba(96,72,40,0) 60%,rgba(96,72,40,.28) 100%),
 repeating-linear-gradient(0deg,rgba(255,250,235,.05) 0 1px,rgba(0,0,0,0) 1px 4px),
 #b1966d;
 box-shadow:0 2px 10px rgba(60,40,15,.35), inset 0 0 26px rgba(96,70,35,.3);z-index:2;}
.ms-colo-text{writing-mode:vertical-rl;height:82%;margin:5% 6%;font-family:var(--ms-xing);font-size:29px;line-height:1.62;letter-spacing:3px;color:#282318;}
.ms-slip .ms-seal{position:absolute;}
/* 导航 */
.ms-nav{position:fixed;left:0;right:0;bottom:0;display:flex;gap:16px;justify-content:center;align-items:center;background:rgba(22,20,17,.92);color:#d8cfae;padding:9px 0;font-size:14px;font-family:var(--ms-kai);z-index:20;}
.ms-nav button{background:#4a4438;color:#e8dfc0;border:1px solid #6a6250;border-radius:4px;padding:4px 14px;font-size:14px;cursor:pointer;font-family:inherit;}
.ms-nav button:hover{background:#5a5342;}
`;

const MS_JS = `
(function(){
  var pages=[].slice.call(document.querySelectorAll('.ms-page'));
  var lab=document.getElementById('ms-lab');
  var host=document.getElementById('ms-fit');
  var cur=0;
  function fit(){
    var sb=pages[cur].querySelector('.ms-scalebox');
    if(!sb)return;
    var w=+sb.getAttribute('data-w'),h=+sb.getAttribute('data-h');
    var s=Math.min((window.innerWidth-26)/w,(window.innerHeight-92)/h,1.12);
    document.documentElement.style.setProperty('--ms-scale',s);
    host.style.width=(w*s)+'px';host.style.height=(h*s)+'px';
  }
  function show(i){
    cur=Math.max(0,Math.min(pages.length-1,i));
    pages.forEach(function(p,k){p.classList.toggle('on',k===cur);});
    lab.textContent=(cur+1)+' / '+pages.length+' · '+(pages[cur].getAttribute('data-name')||'');
    fit();
  }
  window.addEventListener('resize',fit);
  document.getElementById('ms-prev').addEventListener('click',function(){show(cur-1);});
  document.getElementById('ms-next').addEventListener('click',function(){show(cur+1);});
  document.addEventListener('keydown',function(e){
    if(e.key==='ArrowLeft')show(cur+1);      /* 自右向左读：左键翻下一叶 */
    else if(e.key==='ArrowRight')show(cur-1);
  });
  show(0);
})();
`;

/**
 * @param {object} tree  manuscript LayoutTree
 * @param {object} opts  { distWorkDir }
 * @returns {{html:string, warnings:string[]}}
 */
function renderManuscriptHtml(tree, opts = {}) {
  const { meta } = tree;
  const registry = loadRegistry();
  const distWorkDir = opts.distWorkDir || path.join(__dirname, '..', '..', 'dist', 'works', meta.id);

  const warnings = [];
  const kai = resolveFace('kai', meta, registry, distWorkDir);
  const xing = resolveFace('xing', meta, registry, distWorkDir);
  warnings.push(...kai.warnings, ...xing.warnings);

  /* 整册页序 */
  const pagesDef = (tree.book && tree.book.pages) || [{ type: 'leaves' }];
  const pages = [];
  for (const p of pagesDef) {
    if (p.type === 'cover') pages.push({ name: p.side === 'front' ? '封面' : '後封面', w: G.coverW, h: G.coverH, body: coverHtml(p.side) });
    else if (p.type === 'flyleaf') pages.push({ name: p.end ? '卷末扉葉' : '扉葉', w: G.spreadW, h: G.halfH, body: flyleafHtml(tree, !!p.end) });
    else if (p.type === 'colophon') pages.push({ name: '題跋', w: G.spreadW, h: G.halfH, body: colophonHtml(tree) });
    else if (p.type === 'leaves') {
      tree.leaves.forEach((lf, i) => pages.push({ name: `葉 ${i + 1}`, w: G.spreadW, h: G.halfH, body: spreadHtml(lf, i, tree) }));
    }
  }

  const pageHtml = pages.map((p, i) =>
    `<section class="ms-page${i === 0 ? ' on' : ''}" data-name="${esc(p.name)}"><div class="ms-scalebox" data-w="${p.w}" data-h="${p.h}">${p.body}</div></section>`
  ).join('\n');

  const navHref = meta.book && meta.book.id ? `../../books/${meta.book.id}/index.html` : '../../index.html';
  const docTitle = meta.docTitle || `${meta.title} — ${meta.subtitle || ''}`;

  const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(docTitle)}</title>
<style>${kai.faceCss}${xing.faceCss}
:root{--ms-kai:${kai.stack};--ms-xing:${xing.stack};}
${MS_CSS}</style>
</head>
<body>
<div class="ms-stage">
<div id="ms-fit">${pageHtml}</div>
</div>
<nav class="ms-nav" role="navigation" aria-label="翻页">
<a href="${navHref}" style="color:#d8cfae;text-decoration:none">目錄</a>
<button id="ms-prev" type="button">上一葉</button>
<span id="ms-lab"></span>
<button id="ms-next" type="button">下一葉</button>
<span style="opacity:.6">${esc(meta.manuscript && meta.manuscript.spec || '')}</span>
</nav>
<script>${MS_JS}</script>
</body>
</html>`;
  return { html, warnings };
}

module.exports = { renderManuscriptHtml };
