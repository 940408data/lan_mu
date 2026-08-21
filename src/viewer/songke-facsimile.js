/* 宋版影刻直出查看器 V2：逐格坐标渲染（精校台纪律 + 宋刻皮肤）。
   构建期注入：window.SKF（pages[].cells[]=[col,row,char] 三元组、labels、marks、版心、fixes）、window.T2S。
   版面还原：一页一 sheet（16列×15行 CSS grid + 中缝版心轨，direction:rtl 使 col1 居最右），
   每格显式 grid-row/grid-column 定位——空格无 DOM 自然留白（p2 左半叶整白、p6 中缝空白全真）。
   栏线逐有字列一条（空列无栏线，正是原刻空白叶面貌）；句读朱点由 marks 逐格施点（JV 十六式）。 */
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

  /* 朱點十六式：以變化碼查角度、點徑、長寬、墨濃，仿手批氣韻（與宋版查看器同式） */
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

  /* 朱筆圈點四式 */
  const ZHU = [
    { n: '經注並朱', j: 1, z: 1 }, { n: '惟經施朱', j: 1, z: 0 },
    { n: '惟注施朱', j: 0, z: 1 }, { n: '白文無點', j: 0, z: 0 },
  ];
  const FISH = '<svg viewBox="0 0 40 22" preserveAspectRatio="none" aria-hidden="true">' +
    '<path d="M0 0 H40 L34.5 22 L20 12.2 L5.5 22 Z" fill="rgba(36,28,20,.88)"/></svg>';

  const state = { simp: false, jie: true, zhu: 0, face: 0, leaf: 0, showFix: true };
  const $ = (id) => document.getElementById(id);

  /* 校勘 fixes 索引："page:col:row" -> fix */
  const fixMap = {};
  (SK.fixes || []).forEach((f) => {
    if (f.kind === 'sub') fixMap[f.page + ':' + f.col + ':' + f.row] = f;
  });

  /* 列角色索引："page:col" -> j/z/title（渲染字号依此，无标签按 z 兜底） */
  const roleMap = {};
  (SK.labels || []).forEach((l) => { roleMap[l.page + ':' + l.col] = l.role; });

  /* 句读朱点索引："page:col:row" -> true */
  const markSet = new Set((SK.marks || []).map((m) => m.page + ':' + m.col + ':' + m.row));

  const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  /* ── 一叶渲染：sheet = 右半叶(half列) + 版心轨 + 左半叶(half列)；rtl 下 col1 居最右 ──
     版心为真实 grid 轨道（track half+1），不遮两侧列；栏线逐有字列一条，与格同轨叠加。 */
  function renderLeaf() {
    const pg = SK.pages[state.leaf];
    if (!pg) return;
    const half = Math.ceil(COLS / 2);
    /* 首开：右半为书衣（题签复刻），文本整体落左半叶。
       文本源在右半(1..half)→右移 half+1 落左半；源已在左半(half+1..COLS)→保持（仅让出版心轨），
       避免再移推出界致左半页空、出现“三个半页”。 */
    const isCover = !!SK.cover && state.leaf === 0;
    const _cs = pg.cells.map(x => x[0]);
    const textOnRight = _cs.length && Math.max(..._cs) <= half;
    const trackOf = (c) => (isCover ? (textOnRight ? c + half + 1 : c + 1) : (c <= half ? c : c + 1));

    /* 逐格：只含有字格生成 DOM；空位（敬空/阙字/空列）无 DOM 自然留白——坐标即版面 */
    let cellsHTML = '';
    const usedCols = new Set();
    for (const [c, r, ch] of pg.cells) {
      usedCols.add(c);
      const role = roleMap[pg.n + ':' + c] || 'z';
      const cls = role === 'j' ? 'j' : role === 'title' ? 'j title' : 's';
      const fx = fixMap[pg.n + ':' + c + ':' + r];
      /* 句读朱点：JV 式随格而变 */
      let mk = '';
      if (markSet.has(pg.n + ':' + c + ':' + r)) {
        const v = JV[(pg.n * 131 + c * 17 + r) % 16];
        mk = `<i class="mk" style="width:calc(var(--u)*${v.w});height:calc(var(--u)*${v.h});` +
          `transform:rotate(${v.rot}deg);opacity:${v.o}"></i>`;
      }
      const pos = `grid-row:${r};grid-column:${trackOf(c)}`;
      if (fx) {
        const tip = `${fx.from} → ${fx.to}${fx.evidence ? '｜' + fx.evidence : ''}`;
        cellsHTML += `<span class="fcell ${cls} fix" style="${pos}" title="${escAttr(tip)}">${conv(ch)}${mk}</span>`;
      } else {
        cellsHTML += `<span class="fcell ${cls}" style="${pos}">${conv(ch)}${mk}</span>`;
      }
    }

    /* 栏线：逐有字列一条，纵贯全行；空列无栏线（原刻空白叶全真）。开关统制于 .ruled */
    let rulesHTML = '';
    for (const c of usedCols) rulesHTML += `<i class="crule" style="grid-column:${trackOf(c)}"></i>`;

    /* 书衣（首开右半）：花笺纸 + 题签 + 订线，复刻底本书衣神韵 */
    const cover = isCover
      ? `<div class="fcover" style="grid-column:1 / ${half + 1}"><span class="slip">${conv(SK.cover.slip || SK.title)}</span><i class="stitch" aria-hidden="true"></i></div>`
      : '';

    /* 版心：上下白口、单黑鱼尾、书名、叶次、刻工（宋式白口版式） */
    const gong = SK.gong && SK.gong.length ? SK.gong[state.leaf % SK.gong.length] : '';
    const banxin =
      `<div class="fbanxin" style="grid-column:${half + 1}"><div class="kou"></div>` +
      `<span class="fish">${FISH}</span><div class="gap"></div>` +
      `<span class="bt">${conv(SK.banxinTitle || SK.title)}</span><div class="fill"></div>` +
      `<span class="fo">${conv(numCn(pg.n))}</span>` +
      (gong ? `<div class="fill"></div><span class="gong">${conv(gong)}</span>` : '') +
      `<div class="kou"></div></div>`;

    $('book').innerHTML =
      `<div class="fleafwrap"><div class="fleaf">` +
      `<div class="fsheet" data-page="${pg.n}" style="grid-template-columns:repeat(${half},var(--cw)) var(--bx) repeat(${COLS - half},var(--cw));grid-template-rows:repeat(${ROWS},var(--u))">` +
      cellsHTML + rulesHTML + cover + banxin + `</div>` +
      `</div><div class="ffolio">${conv('第')}${numCn(pg.n)}${conv('葉')}</div></div>`;

    $('folioNow').textContent = convUi('第 ' + numCn(pg.n) + ' 葉 / 共 ' + numCn(SK.pages.length) + ' 葉');
    $('btnPrev').disabled = state.leaf <= 0;
    $('btnNext').disabled = state.leaf >= SK.pages.length - 1;
  }

  /* ── 状态同步（按钮文案 / aria / 版面类） ── */
  function sync() {
    const book = $('book');
    book.classList.toggle('ruled', state.jie);
    const zm = ZHU[state.zhu];
    book.classList.toggle('dj', !!zm.j);
    book.classList.toggle('dz', !!zm.z);
    book.classList.toggle('hide-fix', !state.showFix);
    document.documentElement.lang = state.simp ? 'zh-Hans' : 'zh-Hant';

    $('btnZh').textContent = state.simp ? '简体' : '繁体';
    $('btnJie').textContent = '界行';
    $('btnDu').textContent = convUi(zm.n);
    $('btnJiao').textContent = convUi('校勘记');
    $('btnFocus').textContent = document.fullscreenElement ? '退出专注' : '专注模式';
    $('btnPrev').textContent = '前叶';
    $('btnNext').textContent = '后叶';

    $('btnZh').setAttribute('aria-pressed', state.simp);
    $('btnJie').setAttribute('aria-pressed', state.jie);
    $('btnDu').setAttribute('aria-pressed', !!(zm.j || zm.z));
    $('btnJiao').setAttribute('aria-pressed', state.showFix);
    $('btnFocus').setAttribute('aria-pressed', !!document.fullscreenElement);
  }

  /* ── 初始化 ── */
  function init() {
    /* 经/注字号系数（meta.facsimile.jSize/zSize 可调，注字默认接近经字） */
    document.documentElement.style.setProperty('--j-scale', SK.jScale || .84);
    document.documentElement.style.setProperty('--z-scale', SK.zScale || .80);

    const sel = $('faceSel');
    sel.innerHTML = SK.faces.map((f, i) => `<option value="${i}">${convUi(f.label)}</option>`).join('');
    sel.value = '0';
    sel.onchange = () => {
      state.face = +sel.value;
      const role = SK.faces[state.face] && SK.faces[state.face].role;
      document.documentElement.style.setProperty('--face', `var(--${role || 'kai'})`);
    };

    $('btnPrev').onclick = () => { if (state.leaf > 0) { state.leaf--; renderLeaf(); } };
    $('btnNext').onclick = () => { if (state.leaf < SK.pages.length - 1) { state.leaf++; renderLeaf(); } };

    $('btnZh').onclick = () => { state.simp = !state.simp; renderLeaf(); sync(); };
    $('btnJie').onclick = () => { state.jie = !state.jie; sync(); };
    $('btnDu').onclick = () => { state.zhu = (state.zhu + 1) % ZHU.length; sync(); };
    $('btnJiao').onclick = () => { state.showFix = !state.showFix; sync(); };

    $('navToc').textContent = convUi(SK.navLabel || '藏書');
    $('colophon').innerHTML = conv(SK.colophon || '');

    const zoom = $('zoom');
    zoom.oninput = () => document.documentElement.style.setProperty('--u', zoom.value + 'px');

    /* 专注模式：进入/退出全屏；随全屏把字号设为第二档，退出还原 */
    let preFocusU = null;
    const applyFocusZoom = () => {
      if (document.fullscreenElement && preFocusU === null) {
        preFocusU = zoom.value;
        zoom.value = String(+zoom.max - 1);
        document.documentElement.style.setProperty('--u', zoom.value + 'px');
      } else if (!document.fullscreenElement && preFocusU !== null) {
        zoom.value = preFocusU;
        document.documentElement.style.setProperty('--u', preFocusU + 'px');
        preFocusU = null;
      }
    };
    $('btnFocus').onclick = () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else document.documentElement.requestFullscreen().catch(() => {});
    };
    document.addEventListener('fullscreenchange', () => { applyFocusZoom(); sync(); });

    /* 下载菜单：逐格数据（JSON，blob 直出）；PDF 摹刻二期 */
    $('dl').onclick = () => $('dlMenu').classList.toggle('open');
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.dl')) $('dlMenu').classList.remove('open');
    });
    $('dlJson').onclick = () => {
      const blob = new Blob([JSON.stringify(SK, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (SK.id || 'facsimile') + '-逐格数据.json';
      a.click();
      URL.revokeObjectURL(a.href);
      $('dlMenu').classList.remove('open');
    };

    /* 窄屏右栏开合：右缘竖式小签唤出抽屉；点栏外/Esc 收起 */
    const rail = $('rail'), railTgl = $('railToggle');
    railTgl.textContent = '卷';
    railTgl.onclick = () => railTgl.setAttribute('aria-expanded', rail.classList.toggle('open'));
    document.addEventListener('click', (e) => {
      if (rail.classList.contains('open') && !e.target.closest('.rail') && !e.target.closest('#railToggle')) {
        rail.classList.remove('open');
        railTgl.setAttribute('aria-expanded', 'false');
      }
    });

    /* 桌面右栏唤起/收起（与宋版查看器同律）：离书叶 0.5s 唤出；停书叶 1.5s 或点击书叶收起 */
    const wide = () => window.matchMedia('(min-width:861px)').matches;
    let railShowT = null, railHideT = null;
    const railShow = () => rail.classList.remove('off');
    const railHide = () => rail.classList.add('off');
    const clearRailShow = () => { if (railShowT) { clearTimeout(railShowT); railShowT = null; } };
    const clearRailHide = () => { if (railHideT) { clearTimeout(railHideT); railHideT = null; } };
    const armRailHide = () => { clearRailHide(); railHideT = setTimeout(railHide, 1500); };
    document.addEventListener('mousemove', (e) => {
      if (!wide()) return;
      if (e.target.closest('.fleaf')) { clearRailShow(); armRailHide(); }
      else {
        clearRailHide();
        if (rail.classList.contains('off') && !railShowT) {
          railShowT = setTimeout(() => { railShow(); railShowT = null; }, 500);
        }
      }
    });
    document.addEventListener('click', (e) => {
      if (wide() && e.target.closest('.fleaf')) { clearRailShow(); clearRailHide(); railHide(); }
    });
    if (wide()) armRailHide();
    window.matchMedia('(min-width:861px)').addEventListener('change', (e) => {
      if (!e.matches) rail.classList.remove('off');
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        $('dlMenu').classList.remove('open');
        rail.classList.remove('open');
        railTgl.setAttribute('aria-expanded', 'false');
      }
      if (e.key === 'ArrowLeft') $('btnNext').click();          // 左箭头 = 向更左（阅读前进）
      else if (e.key === 'ArrowRight') $('btnPrev').click();    // 右箭头 = 回退
    });

    document.documentElement.style.setProperty('--face', `var(--${SK.faces[0] ? SK.faces[0].role : 'kai'})`);
    renderLeaf();
    sync();
  }

  init();
})();
