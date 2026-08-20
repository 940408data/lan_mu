# 宋刻查看器：菜单栏右移竖栏 + 整体排版重设计

## Context（背景与问题）

宋刻引擎（`layout: songke`）的查看器当前把**菜单栏放在顶部**（`.bar`，水平排列、居中、自动换行），叠加 `.masthead` 标题（`padding-top:2.4rem`）。两处竖向 chrome 合计约 7–9rem，把本就修长的宋版书叶**压得很靠下**，首叶需滚动才能完整入眼。

这遵循的是现代书面「上下」规范，而非中国传统「自上而下、从右到左」的版式。目标：**借鉴宋代审美，把菜单移到右侧成竖栏，重排整体版面，简洁清爽、尽量不干扰读书**。

### 用户已定的两条审美取舍
1. **右栏 = 横排竖栏（侧栏式）**：控件用横排文字、纵向分组堆叠（易读、下拉/滑块无需特殊处理），栏宽约 10rem。
2. **书名 = 竖式题签并入栏顶**：顶部不放标题，书名作竖排「签条」置于右栏最顶端（仿线装书封面签条），是栏内唯一竖排元素、宋代点睛。阅读区只剩书叶 + 版心 + 尾跋，竖向空间全让给书。

## 涉及文件（改动高度聚焦）

| 文件 | 改动 |
|---|---|
| `src/render/html-songke.js` | 重排 `<body>` 标记：删顶部 `.masthead`，把 `#mhTitle`/`#mhSub` 移入右栏题签；`.bar` 重构为分组的右栏 `.rail`。**所有控件 id 保持不变**。 |
| `src/viewer/songke.css` | 主体改动：新增 `.rail` 固定右栏样式、题签样式、分组规则；`.book`/`.colophon`/`.draft-card` 让位；下载菜单改向左弹出；响应式折叠。 |
| `src/viewer/songke.js` | 仅**新增**窄屏右栏开合的小段逻辑；其余渲染/交互/状态同步逻辑、所有 id 引用全部不动。 |

布局引擎（`typeset-songke.js` / `songke.js` 模型）与渲染逻辑（`render()`/`sync()`/`go()`）**零改动**——纯表现层（HTML 结构 + CSS）重排。

## 目标版面结构

### 新 DOM（html-songke.js `<body>`）
```
<body>
  <aside class="rail" id="rail">
    <div class="tiqian">                       ← 竖式题签（仿签条）
      <div class="zhu" id="mhTitle"></div>     ← 书名（vertical-rl，楷体，细边框，朱点小缀）
      <p class="ke" id="mhSub"></p>            ← 注文版式小字（横排、muted）
    </div>
    <a class="btn nav" id="navToc" href="..."></a>   ← 目录（栏顶）
    <section class="rg">                       ← 翻叶组
      前葉 #btnPrev ｜ 後葉 #btnNext
      第X葉 #folioNow（居中指示）
      卷/叶 #btnMode
    </section>
    <section class="rg">                       ← 校读组
      繁/简 #btnZh ｜ 句读 #btnDu
    </section>
    <section class="rg">                       ← 版面组
      字面 #faceSel ｜ 注式 #zhuwenSel ｜ 界行 #btnJie ｜ 字号 #lblZoom+#zoom
    </section>
    <section class="rg">                       ← 藏用组（仅非 draft 渲染）
      下载 #dl（菜单 #dlMenu 向左弹出）
    </section>
  </aside>

  <div id="book" class="book ruled"></div>     ← 阅读区：顶部无标题，书居中靠上
  ${draftCard}
  <p class="colophon" id="colophon"></p>

  <button id="railToggle" aria-label="開合目錄"></button>  ← 窄屏悬浮开合钮（新增）
</body>
```

### 右栏 CSS（songke.css 核心新增）
- `.rail{position:fixed;right:0;top:0;bottom:0;width:var(--rail-w);overflow-y:auto;display:flex;flex-direction:column;gap:…}`，`--rail-w≈10rem`。
- `body{padding-right:var(--rail-w)}`（桌面）让书叶/尾跋整体左移，不被栏遮。
- **题签**：`.tiqian .zhu{writing-mode:vertical-rl;font-family:var(--kai);letter-spacing:.3em;border:1px solid rgba(216,198,160,.3);padding:.5rem .35rem}`——细边框竖排签条，点缀朱色；`#mhSub` 横排小字 muted。
- **分组**：`.rg{border-top:1px solid rgba(216,198,160,.16);padding:.7rem .9rem;display:flex;flex-direction:column;gap:.5rem}`，组内控件横排、两两成行。
- **控件**：沿用现有按钮/下拉配色，仅把水平 flex-wrap 改为竖向堆叠；`input[type=range]` 宽度适配栏宽。
- **下载菜单**：`.dl-menu` 由 `top:100%;right:0` 改为 `right:calc(100% + .4rem);top:0`——向左飞入阅读区，避免在视口右缘被裁。
- **不干扰读书**：右栏默认低对比（muted），`:hover`/`:focus-within` 时提亮，目光始终留在书上。

### 响应式（沿用现有 `@media(max-width:820px)` 断思路，取 ~860px）
- 桌面：右栏常显固定。
- 窄屏：`body{padding-right:0}`；`.rail{transform:translateX(100%);transition:…}` 默认收起为抽屉；右缘露出竖式悬浮钮 `#railToggle`（题签形「卷」字签），点击给 `.rail` 加/去 `.open` 滑出。
- `songke.js` 新增：`#railToggle.onclick` 切 `.rail.open`；点栏外/Esc 收起（复用下载菜单的收起模式）。

## 复用与一致性
- 保留全部控件 id → `songke.js` 的 `sync()`/`render()`/`go()` 与各 `onclick` 完全不动。
- 调色沿用 `:root` 既有变量（`--kai/--song/--zhu/--rule`、纸墨色系），分组细线仿 `.half` 版框线的淡墨手感。
- 窄屏悬浮钮的「点击外部收起」复用 `#dlMenu` 已有的 document click/Esc 模式。

## 验证（实现后）
1. **构建**：`npm run build -- --work=daxue --only=html`（非 draft，含下载）；再 `--work=lunyu7`（draft，无下载钮 + draftCard）验证两条路径。
2. **目检截图**（遵 CLAUDE.md §避坑）：`NODE_PATH=$PWD/node_modules` 起脚本，`chromium.launch({channel:'chrome'})`，固定视口 + 元素级截图（`.rail`、`#book`、整页），确认：书叶抬到顶部、右栏竖排题签、横排分组、下载向左弹、窄屏抽屉开合。**不把 PNG 读进上下文**。
3. **回归**：`npm run validate`（引擎未动，expect 应变；若报红说明误触布局引擎，需排查）。pre-commit 会自动跑 validate；触及 `src/render|viewer/` 会加跑幽兰 `verify`（scroll 引擎，本次未改其渲染器/数据，应通过）。
4. **交互**：繁简、句读、界行、字面/注式切换、前/后叶、字号滑块、下载菜单、键盘 ←/→ 翻叶逐一目检。
