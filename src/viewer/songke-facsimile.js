/* 宋版影刻直出查看器 V2：逐格坐标渲染（精校台纪律 + 宋刻皮肤）。
   构建期注入：window.SKF（pages[].cells[]=[col,row,char] 三元组、labels、版心、fixes）、window.T2S。
   版面还原：一页一 sheet（16列×15行 CSS grid，direction:rtl 使 col1 居最右），
   每格显式 grid-row/grid-column 定位——空格无 DOM 自然留白（p2 左半叶整白、p6 中缝空白全真），
   不做半叶拆分、不做 z 列配对；版心为 sheet 中央绝对定位竖条，不占格。 */
(function () {
  const SK = window.SKF;
  const COLS = SK.cols || 16;
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

  /* 校勘 fixes 索引："page:col:row" -> fix */
  const fixMap = {};
  (SK.fixes || []).forEach((f) => {
    if (f.kind === 'sub') fixMap[f.page + ':' + f.col + ':' + f.row] = f;
  });

  /* 列角色索引："page:col" -> j/z/title（渲染字号依此，无标签按 z 兜底） */
  const roleMap = {};
  (SK.labels || []).forEach((l) => { roleMap[l.page + ':' + l.col] = l.role; });

  const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  /* ── 一叶渲染：sheet = 右半叶(half列) + 版心轨 + 左半叶(half列)；rtl 下 col1 居最右 ──
     版心为真实 grid 轨道（track half+1），不遮两侧列——靠近中缝的字全真呈现。
     cells 坐标仍为原刻 col（1..COLS）：右半叶 c≤half 映射 track c，左半叶 c>half 映射 track c+1（跳过版心轨）。 */
  function renderLeaf() {
    const pg = SK.pages[state.leaf];
    if (!pg) return;
    const half = Math.ceil(COLS / 2);
    const trackOf = (c) => (c <= half ? c : c + 1);

    /* 逐格：只含有字格生成 DOM；空位（敬空/阙字/空列）无 DOM 自然留白——坐标即版面 */
    let cellsHTML = '';
    for (const [c, r, ch] of pg.cells) {
      const role = roleMap[pg.n + ':' + c] || 'z';
      const cls = role === 'j' ? 'j' : role === 'title' ? 'j title' : 's';
      const fx = fixMap[pg.n + ':' + c + ':' + r];
      let inner;
      if (fx) {
        const tip = `${fx.from} → ${fx.to}${fx.evidence ? '｜' + fx.evidence : ''}`;
        inner = `<span class="fcell ${cls} fix" style="grid-row:${r};grid-column:${trackOf(c)}" title="${escAttr(tip)}">${conv(ch)}</span>`;
      } else {
        inner = `<span class="fcell ${cls}" style="grid-row:${r};grid-column:${trackOf(c)}">${conv(ch)}</span>`;
      }
      cellsHTML += inner;
    }

    const banxin =
      `<div class="fbanxin" style="grid-column:${half + 1}"><span class="fish">${FISH}</span>` +
      `<span class="bt">${conv(SK.banxinTitle || SK.title)}</span>` +
      `<span class="fo">${conv('葉 ' + numCn(pg.n))}</span><span class="fish">${FISH}</span></div>`;

    $('book').innerHTML =
      `<div class="fsheet" data-page="${pg.n}" style="grid-template-columns:repeat(${half},var(--u)) var(--bx) repeat(${COLS - half},var(--u));grid-template-rows:repeat(${ROWS},var(--u))">` +
      cellsHTML + banxin + `</div>`;
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
    /* 经/注字号系数（meta.facsimile.jSize/zSize 可调，注字默认接近经字） */
    document.documentElement.style.setProperty('--j-scale', SK.jScale || .84);
    document.documentElement.style.setProperty('--z-scale', SK.zScale || .80);

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
