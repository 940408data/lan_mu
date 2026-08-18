/* 宋版影刻直出查看器：逐格原刻列阵渲染与交互。
   构建期注入：window.SKF（页/列/格阵、版心、校勘 fixes）、window.T2S（繁→简逐字映射）。
   与 songke.js（重排引擎查看器）并行：本查看器零重排，页=原刻葉，叶次即原刻叶次。 */
(function () {
  const SK = window.SKF;
  const ROWS = SK.rows || 15;

  /* ── 繁简：conv 随正文切换；convUi 控件固定简体 ── */
  const conv = (s) => (state.simp ? String(s).replace(/./g, (c) => T2S[c] || c) : String(s));
  const convUi = (s) => String(s).replace(/./g, (c) => T2S[c] || c);

  /* ── 中文数码（叶次可逾十） ── */
  const DIG = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const numCn = (n) => {
    if (n <= 0) return '';
    if (n < 10) return DIG[n];
    if (n < 20) return '十' + (n % 10 ? DIG[n % 10] : '');
    if (n < 100) return DIG[Math.floor(n / 10)] + '十' + (n % 10 ? DIG[n % 10] : '');
    return String(n);
  };

  const FISH = '<svg viewBox="0 0 40 22" preserveAspectRatio="none" aria-hidden="true">' +
    '<path d="M0 0 H40 L34.5 22 L20 12.2 L5.5 22 Z" fill="rgba(36,28,20,.88)"/></svg>';

  const state = { simp: false, face: 0, leaf: 0, showFix: true };
  const $ = (id) => document.getElementById(id);
  const BLANK = '　';

  /* 校勘 fixes 索引："page:col:row" -> fix */
  const fixMap = {};
  (SK.fixes || []).forEach((f) => {
    if (f.kind === 'sub') fixMap[f.page + ':' + f.col + ':' + f.row] = f;
  });

  /* ── 物理列配对：相邻两 z 转写列 = 原刻双行注的一物理列（右行先、左行次） ── */
  function pairCols(cols) {
    const out = [];
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      const role = c.role || 'z';
      if (role === 'z' && i + 1 < cols.length && (cols[i + 1].role || 'z') === 'z') {
        out.push({ type: 'z', right: c, left: cols[i + 1] });   // 右行=靠右列（c 小），左行=靠左列
        i++;
      } else if (role === 'z') {
        out.push({ type: 'z1', col: c });                       // 落单小字列（原刻半行/残列）
      } else {
        out.push({ type: role, col: c });                       // j / title 大字列
      }
    }
    return out;
  }

  const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  /* 单格：大字列每格一字；空格留白占位（敬空/阙字全真保留）；裁决格施朱记 + 悬停证据链 */
  function cellHTML(ch, cls, fx) {
    if (ch === BLANK || !ch) return `<span class="fcell ${cls} blank"></span>`;
    if (fx) {
      const tip = `${fx.from} → ${fx.to}${fx.evidence ? '｜' + fx.evidence : ''}`;
      return `<span class="fcell ${cls} fix" title="${escAttr(tip)}">${conv(ch)}</span>`;
    }
    return `<span class="fcell ${cls}">${conv(ch)}</span>`;
  }

  function subColHTML(col, small) {
    let h = '';
    for (let r = 0; r < ROWS; r++) {
      const ch = col.chars[r] || BLANK;
      const fx = fixMap[curPageN + ':' + col.c + ':' + (r + 1)];
      h += cellHTML(ch, small ? 's' : '', fx);
    }
    return h;
  }

  let curPageN = 0;

  function physColHTML(pc) {
    if (pc.type === 'z') {
      return `<div class="fcol fpair"><div class="fsub">${subColHTML(pc.left, true)}</div>` +
        `<div class="fsub">${subColHTML(pc.right, true)}</div></div>`;
    }
    if (pc.type === 'z1') {
      return `<div class="fcol fpair"><div class="fsub"></div><div class="fsub">${subColHTML(pc.col, true)}</div></div>`;
    }
    const cls = pc.type === 'title' ? 'title-ch' : '';
    return `<div class="fcol">${subColHTML(pc.col, false).replace(/class="fcell /g, `class="fcell ${cls} `)}</div>`;
  }

  /* ── 一叶渲染：物理列对半切为右/左半叶，中缝版心（页码即原刻叶次） ── */
  function renderLeaf() {
    const pg = SK.pages[state.leaf];
    if (!pg) return;
    curPageN = pg.n;
    const phys = pairCols(pg.cols);
    const half = Math.ceil(phys.length / 2);
    const right = phys.slice(0, half);       // 阅读顺序先右半
    const left = phys.slice(half);

    const banxin =
      `<div class="fbanxin"><span class="fish">${FISH}</span>` +
      `<span class="bt">${conv(SK.banxinTitle || SK.title)}</span>` +
      `<span class="fo">${conv('葉 ' + numCn(pg.n))}</span><span class="fish">${FISH}</span></div>`;

    $('book').innerHTML =
      `<div class="fleaf" data-page="${pg.n}">` +
      `<div class="fhalf right">${right.map(physColHTML).join('')}</div>` +
      banxin +
      `<div class="fhalf left">${left.map(physColHTML).join('')}</div>` +
      `</div>`;
    $('folioNow').textContent = convUi('第 ' + numCn(pg.n) + ' 葉 / 共 ' + numCn(SK.pages.length) + ' 葉');
    $('btnPrev').disabled = state.leaf <= 0;
    $('btnNext').disabled = state.leaf >= SK.pages.length - 1;
  }

  /* ── 控件 ── */
  function setFace(i) {
    state.face = i;
    const role = SK.faces[i] && SK.faces[i].role;
    document.documentElement.style.setProperty('--face', `var(--${role || 'kai'})`);
  }

  function init() {
    const sel = $('faceSel');
    sel.innerHTML = SK.faces.map((f, i) => `<option value="${i}">${convUi(f.label)}</option>`).join('');
    sel.value = '0';
    sel.onchange = () => setFace(+sel.value);

    $('btnPrev').textContent = convUi('上一葉');
    $('btnNext').textContent = convUi('下一葉');
    $('btnPrev').onclick = () => { if (state.leaf > 0) { state.leaf--; renderLeaf(); } };
    $('btnNext').onclick = () => { if (state.leaf < SK.pages.length - 1) { state.leaf++; renderLeaf(); } };

    $('btnZh').textContent = convUi('繁');
    $('btnZh').onclick = () => {
      state.simp = !state.simp;
      $('btnZh').textContent = convUi(state.simp ? '简' : '繁');
      renderLeaf();
    };

    $('btnJiao').textContent = convUi('校勘记');
    $('btnJiao').setAttribute('aria-pressed', 'true');
    $('btnJiao').onclick = () => {
      state.showFix = !state.showFix;
      $('btnJiao').setAttribute('aria-pressed', String(state.showFix));
      $('book').classList.toggle('hide-fix', !state.showFix);
    };

    $('navToc').textContent = convUi(SK.navLabel || '藏書');
    $('colophon').innerHTML = conv(SK.colophon || '');

    const zoom = $('zoom');
    zoom.oninput = () => document.documentElement.style.setProperty('--u', zoom.value + 'px');

    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') $('btnNext').click();          // 左箭头 = 向更左（阅读前进）
      else if (e.key === 'ArrowRight') $('btnPrev').click();    // 右箭头 = 回退
    });

    setFace(0);
    renderLeaf();
  }

  init();
})();
