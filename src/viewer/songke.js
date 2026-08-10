/* 宋版善刻查看器：書葉渲染與交互。
   構建期注入：window.SONGKE（列陣/版心/鈐印/文案）、window.T2S（繁→簡逐字映射）。 */
(function () {
  const SK = window.SONGKE;
  const COLS_PER_HALF = SK.colsPerHalf || 8;

  /* ── 繁簡 ── */
  const conv = (s) => (state.simp ? String(s).replace(/./g, (c) => T2S[c] || c) : String(s));

  /* ── 中文數碼（葉次可逾十） ── */
  const DIG = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const numCn = (n) => {
    if (n <= 0) return '';
    if (n < 10) return DIG[n];
    if (n < 20) return '十' + (n % 10 ? DIG[n % 10] : '');
    return DIG[Math.floor(n / 10)] + '十' + (n % 10 ? DIG[n % 10] : '');
  };

  /* 朱筆圈點四式 */
  const ZHU = [
    { n: '經注並朱', j: 1, z: 1 }, { n: '惟經施朱', j: 1, z: 0 },
    { n: '惟注施朱', j: 0, z: 1 }, { n: '白文無點', j: 0, z: 0 },
  ];
  const FISH = '<svg viewBox="0 0 40 22" preserveAspectRatio="none" aria-hidden="true">' +
    '<path d="M0 0 H40 L34.5 22 L20 12.2 L5.5 22 Z" fill="rgba(36,28,20,.88)"/></svg>';

  const state = { simp: false, zhu: 0, jie: true, face: 0, single: false, leaf: 0 };
  const $ = (id) => document.getElementById(id);

  /* 分卷：某葉所屬卷與卷內葉次（卷界已由構建期補齊至葉界） */
  function leafVol(L) {
    const vs = SK.volumes || [];
    if (!vs.length) return { title: SK.banxinTitle, no: L + 1 };
    let v = vs[0];
    for (const x of vs) { if (x.startLeaf <= L) v = x; }
    return { title: v.title, no: L - v.startLeaf + 1 };
  }

  /* ── 排版渲染 ── */
  function cellHTML(tk, cls, top) {
    return `<span class="cell ${cls}" style="top:${top}">${conv(tk[0])}` +
      (tk[1] ? `<i class="mk m${tk[1]}"></i>` : '') + `</span>`;
  }
  function halfHTML(cols) {
    const body = cols.map((c) => {
      const n = c.b.length; let h = '';
      for (let i = 0; i < n; i++) h += cellHTML(c.b[i], 'b', `calc(var(--u)*${i})`);
      for (let k = 0; k < 2; k++) {
        const t = c.s[k] || [];
        for (let j = 0; j < t.length; j++)
          h += cellHTML(t[j], 's ' + (k ? 'l' : 'r'), `calc(var(--u)*${n} + var(--su)*${j})`);
      }
      return `<div class="col">${h}</div>`;
    }).join('');
    return `<div class="half"><div class="frame"><div class="textarea">${body}</div></div></div>`;
  }
  function banxinHTML(L) {
    const grp = (s, cls) => `<div class="bg">` + [...s].map((ch) => `<div class="bc ${cls || ''}">${ch}</div>`).join('') + `</div>`;
    const gong = SK.gong && SK.gong.length ? SK.gong[L % SK.gong.length] : '';
    const vol = leafVol(L);
    return `<div class="banxin"><div class="kou"></div>${FISH}` +
      `<div style="flex:0 0 auto;height:calc(var(--col-h)*.02)"></div>` +
      grp(conv(vol.title)) + `<div class="fill"></div>` +
      grp(numCn(vol.no)) +
      (gong ? `<div class="fill"></div>` + grp(conv(gong), 'gong') : '') +
      `<div class="kou"></div></div>`;
  }
  function sealsHTML(L) {
    return (SK.seals || []).filter((s) => (s.leaf == null ? 0 : s.leaf) === L).map((s) => {
      const w = s.grid === 4 ? 'calc(var(--u)*2.4)' : 'calc(var(--u)*1.1)';
      const h = s.grid === 4 ? 'calc(var(--u)*2.4)' : 'calc(var(--u)*2.1)';
      const fs = s.grid === 4 ? 'calc(var(--u)*.84)' : 'calc(var(--u)*.7)';
      return `<div class="seal s${s.grid}" style="width:${w};height:${h};font-size:${fs};` +
        `right:calc(var(--u)*${s.right});bottom:calc(var(--u)*${s.bottom});transform:rotate(${s.rotate}deg)">` +
        [...conv(s.chars)].map((c) => `<span>${c}</span>`).join('') + `</div>`;
    }).join('');
  }

  function render() {
    const halves = [];
    for (let i = 0; i < SK.cols.length; i += COLS_PER_HALF) halves.push(SK.cols.slice(i, i + COLS_PER_HALF));
    const leaves = Math.ceil(halves.length / 2);
    state.leaf = Math.min(state.leaf, leaves - 1);

    let html = '';
    for (let L = 0; L < leaves; L++) {
      const right = halves[L * 2] || [];
      const left = halves[L * 2 + 1] || [];
      const vol = leafVol(L);
      html += `<div class="leafwrap${L === state.leaf ? ' on' : ''}" data-l="${L}">
      <div class="leaf">
        <div class="sheet">${halfHTML(right)}${banxinHTML(L)}${halfHTML(left)}</div>
        ${sealsHTML(L)}
      </div>
      <div class="folio">${conv('第')}${numCn(vol.no)}${conv('葉')}　${conv('前半')}${numCn(L * 2 + 1)}　${conv('後半')}${numCn(L * 2 + 2)}</div>
    </div>`;
    }
    $('book').innerHTML = html;
  }

  /* ── 狀態同步 ── */
  function sync() {
    const book = $('book');
    book.classList.toggle('ruled', state.jie);
    const zm = ZHU[state.zhu];
    book.classList.toggle('dj', !!zm.j);
    book.classList.toggle('dz', !!zm.z);
    book.classList.toggle('single', state.single);
    document.documentElement.style.setProperty('--face', 'var(--' + SK.faces[state.face].role + ')');
    document.documentElement.lang = state.simp ? 'zh-Hans' : 'zh-Hant';

    $('mhTitle').textContent = conv(SK.title);
    $('mhSub').textContent = conv(SK.spec);
    $('btnZh').textContent = state.simp ? conv('簡體') : '繁體';
    $('btnDu').textContent = conv(zm.n);
    $('btnJie').textContent = conv('界行');
    const sel = $('faceSel');
    [...sel.options].forEach((o, i) => { o.textContent = conv(SK.faces[i].label); });
    sel.value = String(state.face);
    $('btnMode').textContent = conv(state.single ? '通葉披覽' : '單葉披覽');
    $('btnPrev').textContent = conv('前葉');
    $('btnNext').textContent = conv('後葉');
    $('lblZoom').textContent = conv('字號');
    $('folioNow').textContent = conv('第') + numCn(leafVol(state.leaf).no) + conv('葉');
    $('colophon').innerHTML = conv(SK.colophon);

    $('btnZh').setAttribute('aria-pressed', state.simp);
    $('btnDu').setAttribute('aria-pressed', !!(zm.j || zm.z));
    $('btnJie').setAttribute('aria-pressed', state.jie);
    $('btnMode').setAttribute('aria-pressed', state.single);
    document.querySelectorAll('.leafwrap').forEach((el) =>
      el.classList.toggle('on', +el.dataset.l === state.leaf));
  }

  function go(d) {
    const leaves = Math.ceil(SK.cols.length / COLS_PER_HALF / 2);
    state.leaf = Math.min(leaves - 1, Math.max(0, state.leaf + d));
    if (!state.single) {
      const el = document.querySelector('.leafwrap[data-l="' + state.leaf + '"]');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    sync();
  }

  $('btnZh').onclick = () => { state.simp = !state.simp; render(); sync(); };
  $('btnDu').onclick = () => { state.zhu = (state.zhu + 1) % ZHU.length; sync(); };
  $('btnJie').onclick = () => { state.jie = !state.jie; sync(); };
  SK.faces.forEach((f, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = f.label;
    $('faceSel').appendChild(o);
  });
  $('faceSel').onchange = (e) => { state.face = +e.target.value; sync(); };
  $('btnMode').onclick = () => { state.single = !state.single; sync(); };
  $('btnPrev').onclick = () => go(-1);
  $('btnNext').onclick = () => go(1);
  $('zoom').oninput = (e) => document.documentElement.style.setProperty('--u', e.target.value + 'px');
  $('dl').onclick = () => $('dlMenu').classList.toggle('open');
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dl')) $('dlMenu').classList.remove('open');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $('dlMenu').classList.remove('open');
    if (e.key === 'ArrowLeft') go(1);
    if (e.key === 'ArrowRight') go(-1);
  });

  render(); sync();
})();
