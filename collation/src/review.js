/**
 * collation · P7 人工精校台（src/review.js）
 *
 * 产出**单文件、零依赖、可离线**的 HTML 精校台。设计目标（参照 ops_dianjiao review.py 并增强）：
 * 让人工只处理机器不敢定的那部分，每条 15 秒内可决。
 *
 *   · 默认只显示悬置条目（已决折叠在「已決」页签，供抽查）
 *   · 键盘流：J/K 移动，1 采善本 / 2 采现代本 / 3 两存，V 展开双侧书影，E 导出
 *   · V 键书影：每案内嵌善本页+现代本页低清图带（base64 jpeg，按页去重）——裁断看原刻
 *   · 决策写 localStorage，导出 decisions.json → run.js --step=apply 回灌重出定本
 *   · 悬置原因明列（首选得票不足/首选次选太近/无硬证据改正文），人工知其所疑
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { loadConfig, INPUT_DATA } = require('./io');

const ADOPT_LABEL = { shanben: '善本', xiandai: '现代本', neither: '兩存' };

/** 低清书影：pdftoppm 直接出 jpeg（r=70 灰度，单页约 30-60KB） */
function renderThumb(pdfPath) {
  const tmp = fs.mkdtempSync('/tmp/rthumb-');
  const prefix = path.join(tmp, 'p');
  execSync(`pdftoppm -jpeg -jpegopt quality=65 -r 70 -f 1 -l 1 -gray ${JSON.stringify(pdfPath)} ${JSON.stringify(prefix)}`);
  const jpg = fs.readdirSync(tmp).find(f => f.endsWith('.jpg'));
  return fs.readFileSync(path.join(tmp, jpg)).toString('base64');
}

/** 汇总本案涉及的双侧页 → 去重渲染 → { key: dataURL } */
function collectImages(workId, cases) {
  const { editions, works } = loadConfig();
  const work = works[workId];
  const dirs = {
    sb: path.join(INPUT_DATA, workId, editions[work.shanben].pdfDir),
    xd: path.join(INPUT_DATA, workId, editions[work.xiandai].pdfDir),
  };
  const pages = new Set();
  for (const c of cases) {
    if (c.sbPage) pages.add(`sb:${c.sbPage}`);
    if (c.xdPage) pages.add(`xd:${c.xdPage}`);
  }
  const images = {};
  for (const key of pages) {
    const [side, n] = key.split(':');
    const pdf = path.join(dirs[side], `page_${String(n).padStart(4, '0')}.pdf`);
    try { images[key] = 'data:image/jpeg;base64,' + renderThumb(pdf); } catch { /* 缺页则缺图，不阻塞 */ }
  }
  return images;
}

/** 由裁决结果组装精校台 payload（悬置优先、按置信升序） */
function buildPayload(result, workId) {
  const cases = [];
  const clusterMap = {}; (result.clusters || []).forEach(c => clusterMap[c.id] = c);
  for (const v of result.verdicts || []) {
    const cl = String(v.diffId).startsWith('c') ? clusterMap[v.diffId] : null;
    let sbPage = null;
    if (cl && cl.sbPages && cl.sbPages.length) sbPage = cl.sbPages[0];
    else if (typeof v.pos === 'string' && v.pos.includes(':')) sbPage = parseInt(v.pos.split(':')[0], 10);
    const segText = typeof v.seg === 'string' ? v.seg : (v.seg && v.seg.xiandai) || '';
    cases.push({
      id: v.diffId,
      type: v.type + (cl ? '簇' : ''),
      base: v.shanben || '', ref: v.xiandai || '',
      seg: segText,
      ctx: v.ctx || '',
      sbPage, xdPage: cl ? cl.xdPage : (v.seg && v.seg.page) || null,
      chosen: v.verdict === 'resolved' ? (ADOPT_LABEL[v.adopt] || v.adopt) : (v.verdict === 'human' ? '人工：' + (ADOPT_LABEL[v.adopt] || v.adopt) : '—'),
      verdict: v.verdict,
      tentative: v.tentative ? (ADOPT_LABEL[v.tentative] || v.tentative) : '',
      risk: (v.suspendReasons || []).join('；') || v.note || '',
      suspended: v.verdict === 'suspended',
      opinions: (v.opinions || []).map(o => ({
        name: o.name || o.officer, adopt: ADOPT_LABEL[o.adopt] || (o.adopt === 'suspend' ? '存疑' : o.adopt),
        grade: o.grade || '', confidence: o.confidence || 0,
        reason: o.reason || '', clue: o['线索'] || '',
      })),
    });
  }
  cases.sort((a, b) => (a.suspended === b.suspended ? 0 : a.suspended ? -1 : 1));
  return { work: workId, exported: new Date().toISOString(), cases };
}

function buildReviewApp(payload, images) {
  const data = JSON.stringify(payload);
  const img = JSON.stringify(images || {});
  return `<!doctype html><html lang="zh-Hant"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escH(payload.work)} · 人工精校台</title>
<style>
:root{--ink:#17150f;--paper:#efe9dc;--card:#fdfbf5;--rule:#cdc2a8;--red:#9c3b2e;--blue:#274b63;--green:#3f6b4a;--mut:#6f6555}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:"Noto Sans CJK SC",system-ui,sans-serif}
header{position:sticky;top:0;z-index:9;background:var(--paper);border-bottom:1px solid var(--rule);padding:14px 20px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
h1{font-size:15px;margin:0;letter-spacing:.24em;font-weight:700}
.tabs{display:flex;gap:4px}
.tab{border:1px solid var(--rule);background:transparent;padding:5px 12px;font-size:12px;cursor:pointer;border-radius:2px;color:var(--mut)}
.tab.on{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.spacer{flex:1}.stat{font-size:12px;color:var(--mut)}
button.act{border:1px solid var(--ink);background:var(--ink);color:var(--paper);padding:6px 14px;font-size:12px;cursor:pointer;border-radius:2px}
main{max-width:920px;margin:0 auto;padding:24px 20px 120px}
.case{background:var(--card);border:1px solid var(--rule);border-left:4px solid var(--red);padding:18px 20px;margin-bottom:14px;border-radius:3px}
.case.done{border-left-color:var(--green);opacity:.66}
.case.cur{outline:2px solid var(--blue);outline-offset:2px}
.meta{display:flex;gap:10px;font-size:11px;color:var(--mut);letter-spacing:.08em;margin-bottom:10px;flex-wrap:wrap}
.badge{border:1px solid var(--rule);padding:1px 7px;border-radius:99px}
.seg{font-family:"Noto Serif CJK SC",serif;font-size:13px;color:var(--mut);margin-bottom:6px;line-height:1.8}
.ctx{font-family:"Noto Serif CJK SC",serif;font-size:19px;line-height:2.1;margin:6px 0 14px}
.ctx b{color:var(--red);font-weight:700}
.ops{border-top:1px dashed var(--rule);margin-top:10px;padding-top:10px}
.op{font-size:13px;line-height:1.85;margin-bottom:5px;font-family:"Noto Serif CJK SC",serif}
.op .who{display:inline-block;min-width:60px;font-weight:700;color:var(--blue)}
.op .g{font-size:11px;color:var(--mut);border:1px solid var(--rule);padding:0 5px;border-radius:99px;margin:0 6px}
.choices{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}
.ch{border:1px solid var(--rule);background:#fff;padding:8px 14px;cursor:pointer;font-size:14px;border-radius:2px;font-family:"Noto Serif CJK SC",serif}
.ch:hover{border-color:var(--ink)}
.ch.sel{background:var(--blue);color:#fff;border-color:var(--blue)}
.ch kbd{font-size:10px;opacity:.6;margin-right:6px}
textarea{width:100%;margin-top:10px;border:1px solid var(--rule);padding:8px;font-size:13px;border-radius:2px;background:#fff;resize:vertical;min-height:44px;font-family:"Noto Serif CJK SC",serif}
.risk{font-size:12px;color:var(--red);margin-top:8px}
.imgs{display:none;margin-top:12px;gap:10px;flex-wrap:wrap}
.imgs.on{display:flex}
.imgs figure{margin:0}
.imgs img{max-width:340px;border:1px solid var(--rule);display:block}
.imgs figcaption{font-size:11px;color:var(--mut);text-align:center}
.hint{font-size:11px;color:var(--mut);margin-top:20px;line-height:1.9}
.empty{text-align:center;color:var(--mut);padding:60px 0;font-size:14px}
</style>
<header>
 <h1>人 工 精 校 台</h1>
 <div class="tabs">
  <button class="tab on" data-f="pending">待覆核 <span id="n1"></span></button>
  <button class="tab" data-f="done">已決 <span id="n2"></span></button>
  <button class="tab" data-f="all">全部 <span id="n3"></span></button>
 </div>
 <div class="spacer"></div><div class="stat" id="prog"></div>
 <button class="act" id="exp">導出 decisions.json</button>
</header>
<main id="list"></main>
<script>
const DATA = ${data};
const IMGS = ${img};
const KEY = 'guji:' + DATA.work;
let dec = JSON.parse(localStorage.getItem(KEY) || '{}');
let filter = 'pending', cur = 0, imgOn = {};
const save = () => localStorage.setItem(KEY, JSON.stringify(dec));
const esc = s => (s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const ADOPT = {shanben:'善本', xiandai:'现代本', neither:'兩存'};
function visible(){ return DATA.cases.filter(c => filter==='all' ? true : filter==='done' ? (dec[c.id] || !c.suspended) : (c.suspended && !dec[c.id])); }
function imgHtml(c){
  if(!imgOn[c.id]) return '';
  let h = '<div class="imgs on">';
  if(c.sbPage && IMGS['sb:'+c.sbPage]) h += '<figure><img src="'+IMGS['sb:'+c.sbPage']+'"><figcaption>善本 p'+c.sbPage+'</figcaption></figure>';
  if(c.xdPage && IMGS['xd:'+c.xdPage]) h += '<figure><img src="'+IMGS['xd:'+c.xdPage']+'"><figcaption>现代本 p'+c.xdPage+'</figcaption></figure>';
  return h + '</div>';
}
function render(){
  const list = document.getElementById('list');
  const items = visible();
  document.getElementById('n1').textContent = DATA.cases.filter(c=>c.suspended&&!dec[c.id]).length;
  document.getElementById('n2').textContent = DATA.cases.filter(c=>dec[c.id]||!c.suspended).length;
  document.getElementById('n3').textContent = DATA.cases.length;
  document.getElementById('prog').textContent = '懸置 '+DATA.cases.filter(c=>c.suspended).length+' 條，已人工處理 '+Object.keys(dec).length+' 條';
  if(!items.length){ list.innerHTML='<div class="empty">此頁無條目。</div>'; return; }
  list.innerHTML = items.map((c,i) => {
    const d = dec[c.id];
    const opts = [['shanben','采善本「'+(c.base||'∅')+'」'],['xiandai','采现代本「'+(c.ref||'∅')+'」'],['neither','兩存']];
    const chs = opts.map(([v,label],k)=>'<button class="ch '+(d&&d.choice===v?'sel':'')+'" data-id="'+c.id+'" data-v="'+v+'"><kbd>'+(k+1)+'</kbd>'+esc(label)+'</button>').join('');
    const ops = c.opinions.map(o=>'<div class="op"><span class="who">'+esc(o.name)+'</span><span class="g">'+esc(o.grade)+'·'+(o.confidence||0).toFixed(2)+'</span>主「'+esc(o.adopt)+'」：'+esc(o.reason)+(o.clue?'〔線索：'+esc(o.clue)+'〕':'')+'</div>').join('');
    return '<div class="case '+(d?'done':'')+' '+(i===cur?'cur':'')+'">'
      +'<div class="meta"><span class="badge">'+esc(c.id)+'</span><span class="badge">'+esc(c.type)+'</span>'
      +(c.sbPage?'<span class="badge">善p'+c.sbPage+'</span>':'')+(c.xdPage?'<span class="badge">今p'+c.xdPage+'</span>':'')
      +(c.suspended?'<span class="badge" style="color:#9c3b2e">懸置</span>':'<span class="badge" style="color:#3f6b4a">'+esc(c.verdict)+'</span>')+'</div>'
      +'<div class="seg">'+esc(c.seg)+'</div>'
      +'<div class="ctx">善本〔<b>'+esc(c.base||'〇')+'</b>〕　现代本〔'+esc(c.ref||'〇')+'〕<br><span style="font-size:13px;color:#6f6555">'+esc(c.ctx)+'</span></div>'
      +'<div class="ops">'+ops+'</div>'
      +'<div class="risk">機器裁斷：'+esc(c.chosen)+(c.tentative?'（暫擬 '+esc(c.tentative)+'）':'')+'　｜　'+esc(c.risk)+'</div>'
      +'<div class="choices">'+chs+'<button class="ch" data-img="'+c.id+'"><kbd>V</kbd>書影</button></div>'
      +imgHtml(c)
      +'<textarea placeholder="人工按語（將寫入校勘記）" data-note="'+c.id+'">'+esc(d?d.note:'')+'</textarea></div>';
  }).join('') + '<div class="hint">鍵盤：J／K 移動　1 采善本　2 采现代本　3 兩存　V 書影　E 導出<br>決策存本機 localStorage；導出 decisions.json 後 <code>node collation/run.js '+esc(DATA.work)+' --step=apply --decisions=路徑</code> 回灌重出定本。</div>';
}
document.addEventListener('click', e => {
  const t = e.target.closest('.ch');
  if(t && t.dataset.v){ dec[t.dataset.id] = {choice:t.dataset.v, note:(dec[t.dataset.id]||{}).note||'', at:new Date().toISOString()}; save(); render(); return; }
  if(t && t.dataset.img){ imgOn[t.dataset.img] = !imgOn[t.dataset.img]; render(); return; }
  const tab = e.target.closest('.tab');
  if(tab){ filter = tab.dataset.f; cur = 0; document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('on', x===tab)); render(); }
});
document.addEventListener('input', e => { const id = e.target.dataset && e.target.dataset.note; if(id){ dec[id] = Object.assign({choice:'',note:''}, dec[id], {note:e.target.value}); save(); } });
document.getElementById('exp').onclick = () => {
  const out = {work: DATA.work, exported_at: new Date().toISOString(), decisions: dec};
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out,null,2)],{type:'application/json'}));
  a.download = 'decisions.json'; a.click();
};
document.addEventListener('keydown', e => {
  if(e.target.tagName === 'TEXTAREA') return;
  const items = visible();
  if(e.key==='j'){ cur = Math.min(cur+1, items.length-1); render(); }
  if(e.key==='k'){ cur = Math.max(cur-1, 0); render(); }
  if(e.key==='e'){ document.getElementById('exp').click(); }
  if(e.key==='v' && items[cur]){ imgOn[items[cur].id] = !imgOn[items[cur].id]; render(); }
  if(/^[1-3]$/.test(e.key) && items[cur]){
    const v = ['shanben','xiandai','neither'][+e.key-1];
    dec[items[cur].id] = {choice:v, note:(dec[items[cur].id]||{}).note||'', at:new Date().toISOString()};
    save(); cur = Math.min(cur+1, items.length-1); render();
  }
});
render();
</script></html>`;
}
function escH(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

module.exports = { buildPayload, buildReviewApp, collectImages };
