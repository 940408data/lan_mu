/* 宋版善刻查看器：書葉渲染與交互。
   構建期注入：window.SONGKE（列陣/版心/鈐印/文案）、window.T2S（繁→簡逐字映射）。 */
(function () {
  const SK = window.SONGKE;
  const COLS_PER_HALF = SK.colsPerHalf || 8;

  /* 注文三版樣式：subw 注列寬比、size 小字字徑比、stroke/shadow 筆畫重量（防小字發虛） */
  const VSTYLE = {
    20: { subw: .46, size: .78, stroke: .25, shadow: '0 0 .7px rgba(48,38,26,.5)' },
    22: { subw: .48, size: .80, stroke: .15, shadow: '0 0 .55px rgba(48,38,26,.45)' },
    25: { subw: .50, size: .835, stroke: 0, shadow: '0 0 .4px rgba(48,38,26,.36)' },
  };

  /* 朱點十六式：以變化碼查角度、點徑、長寬、墨濃，仿手批氣韻 */
  const JV = (() => {
    let a = 20260810;
    const rnd = () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return Array.from({ length: 16 }, () => {
      const w = .135 * (.9 + rnd() * .2);
      return {
        rot: (-30 + rnd() * 22).toFixed(1),
        w: w.toFixed(3),
        h: (w * (1.35 + rnd() * .35)).toFixed(3),
        o: (.7 + rnd() * .2).toFixed(2),
      };
    });
  })();

  /* ── 繁簡：conv 隨正文切換；convUi 工具欄控件固定簡體（用戶友好，正文仍可繁簡） ── */
  const conv = (s) => (state.simp ? String(s).replace(/./g, (c) => T2S[c] || c) : String(s));
  const convUi = (s) => String(s).replace(/./g, (c) => T2S[c] || c);

  /* ── 中文數碼（葉次可逾十） ── */
  const DIG = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const numCn = (n) => {
    if (n <= 0) return '';
    if (n < 10) return DIG[n];
    if (n < 20) return '十' + (n % 10 ? DIG[n % 10] : '');
    if (n < 100) return DIG[Math.floor(n / 10)] + '十' + (n % 10 ? DIG[n % 10] : '');
    if (n < 1000) {
      const b = Math.floor(n / 100), r = n % 100;
      const head = (b === 1 ? '一' : DIG[b]) + '百';
      if (r === 0) return head;
      if (r < 10) return head + '零' + DIG[r];
      if (r < 20) return head + '一十' + (r % 10 ? DIG[r % 10] : '');
      return head + DIG[Math.floor(r / 10)] + '十' + (r % 10 ? DIG[r % 10] : '');
    }
    if (n < 10000) {
      const q = Math.floor(n / 1000), r = n % 1000;
      const head = (q === 1 ? '一' : DIG[q]) + '千';
      if (r === 0) return head;
      if (r < 100) return head + '零' + (r < 10 ? DIG[r] : DIG[Math.floor(r / 10)] + '十' + (r % 10 ? DIG[r % 10] : ''));
      return head + numCn(r);
    }
    return String(n);
  };

  /* 朱筆圈點四式 */
  const ZHU = [
    { n: '經注並朱', j: 1, z: 1 }, { n: '惟經施朱', j: 1, z: 0 },
    { n: '惟注施朱', j: 0, z: 1 }, { n: '白文無點', j: 0, z: 0 },
  ];
  const FISH = '<svg viewBox="0 0 40 22" preserveAspectRatio="none" aria-hidden="true">' +
    '<path d="M0 0 H40 L34.5 22 L20 12.2 L5.5 22 Z" fill="rgba(36,28,20,.88)"/></svg>';

  const state = { simp: false, zhu: 0, jie: true, face: 0, single: false, leaf: 0, variant: 0 };
  const $ = (id) => document.getElementById(id);
  const curV = () => SK.variants[state.variant];

  /* 分卷：某葉所屬卷與卷內葉次（卷界已由構建期按各版補齊至葉界） */
  function leafVol(L) {
    const vs = curV().volumes || [];
    if (!vs.length) return { title: SK.banxinTitle, no: L + 1 };
    let v = vs[0];
    for (const x of vs) { if (x.startLeaf <= L) v = x; }
    return { title: v.title, no: L - v.startLeaf + 1 };
  }

  /* ── 排版渲染 ── */
  function cellHTML(tk, cls, top) {
    let mk = '';
    if (tk[1]) {
      const j = JV[tk[2] || 0];
      const uv = cls.charAt(0) === 'b' ? '--u' : '--su';
      mk = `<i class="mk" style="width:calc(var(${uv})*${j.w});height:calc(var(${uv})*${j.h});` +
        `transform:rotate(${j.rot}deg);opacity:${j.o}"></i>`;
    }
    return `<span class="cell ${cls}" style="top:${top}">${conv(tk[0])}${mk}</span>`;
  }
  function halfHTML(cols, side) {
    const body = cols.map((c) => {
      const n = c.b.length; let h = '';
      for (let i = 0; i < n; i++) h += cellHTML(c.b[i], 'b', `calc(var(--u)*${i})`);
      const g = c.g || 0; /* 經注合欄：注起始行號（與純注列網格對齊） */
      for (let k = 0; k < 2; k++) {
        const t = c.s[k] || [];
        for (let j = 0; j < t.length; j++)
          h += cellHTML(t[j], 's ' + (k ? 'l' : 'r'), `calc(var(--su)*${g + j})`);
      }
      return `<div class="col">${h}</div>`;
    }).join('');
    return `<div class="half ${side}"><div class="frame"><div class="textarea">${body}</div></div></div>`;
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
    const cols = curV().cols;
    const halves = [];
    for (let i = 0; i < cols.length; i += COLS_PER_HALF) halves.push(cols.slice(i, i + COLS_PER_HALF));
    const leaves = Math.ceil(halves.length / 2);
    state.leaf = Math.min(state.leaf, leaves - 1);

    let html = '';
    for (let L = 0; L < leaves; L++) {
      const right = halves[L * 2] || [];
      const left = halves[L * 2 + 1] || [];
      const vol = leafVol(L);
      html += `<div class="leafwrap${L === state.leaf ? ' on' : ''}" data-l="${L}">
      <div class="leaf">
        <div class="sheet">${halfHTML(right, 'hr')}${banxinHTML(L)}${halfHTML(left, 'hl')}</div>
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
    const V = curV();
    const st = VSTYLE[V.sub] || VSTYLE[25];
    const rs = document.documentElement.style;
    rs.setProperty('--sub-n', String(V.sub));
    rs.setProperty('--sub-w', `calc(var(--col-w) * ${st.subw})`);
    rs.setProperty('--small-size', `calc(var(--su) * ${st.size})`);
    rs.setProperty('--sub-stroke', st.stroke + 'px');
    rs.setProperty('--sub-shadow', st.shadow);
    book.classList.toggle('ruled', state.jie);
    const zm = ZHU[state.zhu];
    book.classList.toggle('dj', !!zm.j);
    book.classList.toggle('dz', !!zm.z);
    book.classList.toggle('single', state.single);
    document.documentElement.style.setProperty('--face', 'var(--' + SK.faces[state.face].role + ')');
    document.documentElement.lang = state.simp ? 'zh-Hans' : 'zh-Hant';

    $('navToc').textContent = convUi(SK.navLabel || '目錄');
    $('btnZh').textContent = state.simp ? '简体' : '繁体';
    $('btnDu').textContent = convUi(zm.n);
    $('btnJie').textContent = '界行';
    const sel = $('faceSel');
    [...sel.options].forEach((o, i) => { o.textContent = convUi(SK.faces[i].label); });
    sel.value = String(state.face);
    const zsel = $('zhuwenSel');
    [...zsel.options].forEach((o, i) => { o.textContent = convUi(SK.variants[i].name); });
    zsel.value = String(state.variant);
    $('btnMode').textContent = state.single ? '单页阅读' : '滚动阅读';
    $('btnFocus').textContent = document.fullscreenElement ? '退出专注' : '专注模式';
    $('btnPrev').textContent = '前叶';
    $('btnNext').textContent = '后叶';
    $('lblZoom').textContent = '字号';
    $('folioNow').textContent = convUi('第') + numCn(leafVol(state.leaf).no) + convUi('葉');
    $('colophon').innerHTML = conv(SK.colophon);

    $('btnZh').setAttribute('aria-pressed', state.simp);
    $('btnDu').setAttribute('aria-pressed', !!(zm.j || zm.z));
    $('btnJie').setAttribute('aria-pressed', state.jie);
    $('btnMode').setAttribute('aria-pressed', state.single);
    $('btnFocus').setAttribute('aria-pressed', !!document.fullscreenElement);
    document.querySelectorAll('.leafwrap').forEach((el) =>
      el.classList.toggle('on', +el.dataset.l === state.leaf));
  }

  function go(d) {
    const leaves = Math.ceil(curV().cols.length / COLS_PER_HALF / 2);
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
  SK.variants.forEach((v, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = v.name;
    $('zhuwenSel').appendChild(o);
  });
  $('zhuwenSel').onchange = (e) => { state.variant = +e.target.value; render(); sync(); };
  $('btnMode').onclick = () => { state.single = !state.single; sync(); };
  $('btnPrev').onclick = () => go(-1);
  $('btnNext').onclick = () => go(1);
  $('zoom').oninput = (e) => document.documentElement.style.setProperty('--u', e.target.value + 'px');
  /* 下載菜單：draft（需點校）卷次無下載按鈕，此處護空 */
  if ($('dl')) {
    $('dl').onclick = () => $('dlMenu').classList.toggle('open');
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.dl')) $('dlMenu').classList.remove('open');
    });
  }
  /* 窄屏右欄開合：右緣豎式小簽喚出抽屜；點欄外/Esc 收起（桌面常顯，此鈕隱藏） */
  const rail = $('rail'), railTgl = $('railToggle');
  railTgl.textContent = '卷';
  railTgl.onclick = () => {
    railTgl.setAttribute('aria-expanded', rail.classList.toggle('open'));
  };
  document.addEventListener('click', (e) => {
    if (rail.classList.contains('open') && !e.target.closest('.rail') && !e.target.closest('#railToggle')) {
      rail.classList.remove('open');
      railTgl.setAttribute('aria-expanded', 'false');
    }
  });
  /* 专注模式：进入/退出浏览器全屏；并随全屏把字号设为第二档（次于最大档），退出还原原字号。
     fullscreenchange 兼顾按钮切换与 Esc 退出，复同步按钮文案与字号。 */
  let preFocusU = null;
  const applyFocusZoom = () => {
    const zoom = $('zoom');
    if (document.fullscreenElement && preFocusU === null) {
      preFocusU = zoom.value;                                     // 记下原字号
      zoom.value = String(+zoom.max - 1);                         // 第二档（最大档之下一档）
      document.documentElement.style.setProperty('--u', zoom.value + 'px');
    } else if (!document.fullscreenElement && preFocusU !== null) {
      zoom.value = preFocusU;                                     // 还原原字号
      document.documentElement.style.setProperty('--u', preFocusU + 'px');
      preFocusU = null;
    }
  };
  $('btnFocus').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  };
  document.addEventListener('fullscreenchange', () => { applyFocusZoom(); sync(); });

  /* 桌面右栏唤起/收起（窄屏抽屉由 #railToggle 主导，不启用此逻辑）：
     「书叶」按真实页面 .leaf 判定（非整宽 #book 容器），页边空白即算离书。
     - 唤出：鼠标离开书叶 0.5s → 唤出；
     - 悬浮：鼠标一直在非书页内（页边/栏上）→ 一直悬浮，不收起；
     - 收起：仅两种——点击书叶立即收起；或鼠标停在书叶内 1.5s 没操作收起。 */
  const wide = () => window.matchMedia('(min-width:861px)').matches;
  let railShowT = null, railHideT = null;
  const railShow = () => rail.classList.remove('off');
  const railHide = () => rail.classList.add('off');
  const clearRailShow = () => { if (railShowT) { clearTimeout(railShowT); railShowT = null; } };
  const clearRailHide = () => { if (railHideT) { clearTimeout(railHideT); railHideT = null; } };
  const armRailHide = () => { clearRailHide(); railHideT = setTimeout(railHide, 1500); };  // 停在书叶 1.5s 收起
  document.addEventListener('mousemove', (e) => {
    if (!wide()) return;
    if (e.target.closest('.leaf')) {
      clearRailShow();      // 在书叶上：不唤出
      armRailHide();        // 停下阅读 1.5s 无操作 → 收起（持续移动则不断顺延）
    } else {
      clearRailHide();      // 非书页内：取消收起，一直悬浮
      if (rail.classList.contains('off') && !railShowT) {
        railShowT = setTimeout(() => { railShow(); railShowT = null; }, 500);  // 离书叶 0.5s → 唤出
      }
    }
  });
  document.addEventListener('click', (e) => {         // 点击书叶 → 立即收起
    if (wide() && e.target.closest('.leaf')) { clearRailShow(); clearRailHide(); railHide(); }
  });
  if (wide()) armRailHide();                        // 载入后若停在书页阅读，1.5s 收起
  window.matchMedia('(min-width:861px)').addEventListener('change', (e) => {
    if (!e.matches) rail.classList.remove('off');   // 落入窄屏即清掉隐藏态，交还抽屉主导
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if ($('dlMenu')) $('dlMenu').classList.remove('open');
      rail.classList.remove('open');
      railTgl.setAttribute('aria-expanded', 'false');
    }
    if (e.key === 'ArrowLeft') go(1);
    if (e.key === 'ArrowRight') go(-1);
  });

  render(); sync();
})();
