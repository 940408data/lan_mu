/* 兰木 · 手卷查看器运行时（WRAP_H 由 render/html.js 注入） */
(function(){
const viewer=document.getElementById('viewer'),paper=document.getElementById('paper'),
      hud=document.getElementById('hud'),prog=document.getElementById('prog'),
      panel=document.getElementById('panel');
let zoom=1,orig=false;
function toStart(){viewer.scrollLeft=viewer.scrollWidth-viewer.clientWidth;}
function upd(){
  const max=Math.max(1,viewer.scrollWidth-viewer.clientWidth);
  const vp=Math.min(1,viewer.clientWidth/viewer.scrollWidth);
  prog.style.width=Math.max(6,vp*100)+'%';
  prog.style.transform='translateX('+(viewer.scrollLeft/max)*(100/vp-100)+'%)';
}
function setZoom(z){
  const max=Math.max(1,viewer.scrollWidth-viewer.clientWidth),fr=max-viewer.scrollLeft;
  const old=zoom; zoom=Math.min(1.6,Math.max(.45,z));
  document.documentElement.style.setProperty('--zoom',zoom.toFixed(3));
  requestAnimationFrame(()=>{
    const nm=Math.max(1,viewer.scrollWidth-viewer.clientWidth);
    viewer.scrollLeft=Math.max(0,nm-fr*(zoom/old)); upd();
  });
}
minus.onclick=()=>setZoom(zoom-.14); plus.onclick=()=>setZoom(zoom+.14);
rule.onclick=e=>{const a=paper.classList.toggle('rule');e.currentTarget.classList.toggle('on',a);
  e.currentTarget.setAttribute('aria-pressed',a);};
/* 双轨字面：繁体轨 f-* / 简体轨 fsc-*（FACES 由 render/html.js 烘焙），
   两轨选项与选择各自独立记忆；简体按钮同时逐字繁简转换（T2S 映射，原文存 dataset.t 可还原） */
const faceSel=document.getElementById('faceSel');
let simpOn=FACES.defScript==='sc',tcFace=faceSel.value||'song',
    scFace=FACES.def||(FACES.sc[0]&&FACES.sc[0].v)||tcFace;
function clearFaceCls(){for(const c of [...paper.classList])if(/^f(sc)?-/.test(c))paper.classList.remove(c);}
function applyFace(){clearFaceCls();paper.classList.add(simpOn?'fsc-'+scFace:'f-'+tcFace);}
function rebuildSel(){
  const list=simpOn?FACES.sc:FACES.tc;
  faceSel.innerHTML=list.map((o)=>`<option value="${o.v}">${o.l}</option>`).join('');
  faceSel.value=simpOn?scFace:tcFace;
}
// 初始化：若默认简体，需先重建下拉并应用字面
if(simpOn){rebuildSel();applyFace();
  simp.classList.add('on'); simp.setAttribute('aria-pressed','true');
  simp.textContent='繁体';
  const conv=(el)=>{
    if(el.dataset.t==null)el.dataset.t=el.textContent;
    el.textContent=[...el.dataset.t].map((c)=>T2S[c]||c).join('');
  };
  document.querySelectorAll('.ribbon .t i,.note,.tt h1,.tt p').forEach(conv);
}
simp.onclick=()=>{
  simpOn=!simpOn;
  simp.classList.toggle('on',simpOn); simp.setAttribute('aria-pressed',simpOn);
  simp.textContent=simpOn?'繁体':'简体';
  if(FACES.sc.length){rebuildSel();applyFace();}
  const conv=(el)=>{
    if(el.dataset.t==null)el.dataset.t=el.textContent;
    el.textContent=simpOn?[...el.dataset.t].map((c)=>T2S[c]||c).join(''):el.dataset.t;
  };
  document.querySelectorAll('.ribbon .t i,.note,.tt h1,.tt p').forEach(conv);
};
/* 句讀施朱：紙面加 .du 顯朱點 */
const duBtn=document.getElementById('duBtn');
if(duBtn)duBtn.onclick=e=>{const a=paper.classList.toggle('du');e.currentTarget.classList.toggle('on',a);
  e.currentTarget.setAttribute('aria-pressed',a);};
mode.onclick=e=>{
  orig=!orig;paper.classList.toggle('orig',orig);
  if(orig){ /* 原卷扫描图按需加载，避免阻塞首屏 */
    const img=paper.querySelector('.scan img');
    if(img&&!img.getAttribute('src'))img.setAttribute('src',img.dataset.src);
  }
  e.currentTarget.textContent=orig?'原貌':'摹本';e.currentTarget.setAttribute('aria-pressed',orig);};
about.onclick=e=>{const o=panel.classList.toggle('on');e.currentTarget.setAttribute('aria-expanded',o);};
faceSel.onchange=e=>{if(simpOn)scFace=e.target.value;else tcFace=e.target.value;applyFace();};

/* 下載菜單：開合、選後收、點外部收 */
const dlWrap=dl.parentElement;
dl.onclick=e=>{e.stopPropagation();const o=dlWrap.classList.toggle('on');dl.setAttribute('aria-expanded',o);};
document.querySelectorAll('.dl-item').forEach(a=>a.addEventListener('click',()=>{
  dlWrap.classList.remove('on');dl.setAttribute('aria-expanded','false');}));
document.addEventListener('click',e=>{if(!e.target.closest('.dl')){dlWrap.classList.remove('on');dl.setAttribute('aria-expanded','false');}});
document.querySelectorAll('.col').forEach(c=>{
  const show=()=>{const m=c.dataset.meta.split(' · ');
    hud.innerHTML=c.dataset.sec+' · 第 <b>'+m[0]+'</b> 行 · '+m.slice(1).join(' · ');};
  c.addEventListener('mouseenter',show);c.addEventListener('focus',show);
});
let down=false,sx=0,sl=0;
viewer.addEventListener('pointerdown',e=>{if(e.button)return;down=true;sx=e.clientX;sl=viewer.scrollLeft;
  viewer.setPointerCapture(e.pointerId);viewer.classList.add('drag');});
viewer.addEventListener('pointermove',e=>{if(down)viewer.scrollLeft=sl-(e.clientX-sx);});
viewer.addEventListener('pointerup',()=>{down=false;viewer.classList.remove('drag');});
viewer.addEventListener('scroll',upd,{passive:true});
viewer.addEventListener('wheel',e=>{if(Math.abs(e.deltaY)>Math.abs(e.deltaX)){viewer.scrollLeft+=e.deltaY;e.preventDefault();}},{passive:false});
addEventListener('resize',upd);
addEventListener('keydown',e=>{
  if(e.key==='Escape'){panel.classList.remove('on');about.setAttribute('aria-expanded','false');
    dlWrap.classList.remove('on');dl.setAttribute('aria-expanded','false');}
  if(e.key==='ArrowLeft')viewer.scrollBy({left:-460,behavior:'smooth'});
  if(e.key==='ArrowRight')viewer.scrollBy({left:460,behavior:'smooth'});
});
const WRAPH=__WRAP_H__;
function fit(){
  // 与 .stage min-height（wrapH*zoom+24）同参：fit 后卷高恰好铺满视口，上下仅留呼吸边
  const z=Math.min(1.6,Math.max(.45,(viewer.clientHeight-24)/WRAPH));
  zoom=z; document.documentElement.style.setProperty('--zoom',z.toFixed(3));
}
requestAnimationFrame(()=>{fit();requestAnimationFrame(()=>{toStart();upd();});});
})();
