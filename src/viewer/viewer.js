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
mode.onclick=e=>{
  orig=!orig;paper.classList.toggle('orig',orig);
  if(orig){ /* 原卷扫描图按需加载，避免阻塞首屏 */
    const img=paper.querySelector('.scan img');
    if(img&&!img.getAttribute('src'))img.setAttribute('src',img.dataset.src);
  }
  e.currentTarget.textContent=orig?'原貌':'摹本';e.currentTarget.setAttribute('aria-pressed',orig);};
about.onclick=e=>{const o=panel.classList.toggle('on');e.currentTarget.setAttribute('aria-expanded',o);};
/* 下載菜單：開合、選後收、點外部收 */
const dlWrap=dl.parentElement;
dl.onclick=e=>{e.stopPropagation();const o=dlWrap.classList.toggle('on');dl.setAttribute('aria-expanded',o);};
document.querySelectorAll('.dl-item').forEach(a=>a.addEventListener('click',()=>{
  dlWrap.classList.remove('on');dl.setAttribute('aria-expanded','false');}));
document.addEventListener('click',e=>{if(!e.target.closest('.dl')){dlWrap.classList.remove('on');dl.setAttribute('aria-expanded','false');}});
document.querySelectorAll('.seg-b').forEach(b=>b.onclick=()=>{
  paper.classList.remove('f-song','f-jing','f-xing');
  paper.classList.add(b.dataset.face);
  document.querySelectorAll('.seg-b').forEach(x=>x.classList.toggle('on',x===b));
});
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
