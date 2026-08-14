# 首页底端入口 + 三藏页 → 经史子集选编

## Context（缘由）
首页底端现入口为「三藏 · 儒釋道編選」，三藏页（/sanzang/）部类页签为「儒释道」（儒家经典/佛家/道家）。用户要求：首页底端改名「古典 · 經史子集選編」，三藏页部类页签改为经史子集四部，未收录书标「敬請期待」。

现有敬请期待机制（`virtTome`→`/coming-soon/`、`searchIndex` 纳入 virtual、`COPY.soon`）已就绪，且长物志（`book.id=changwuzhi`，category=子，6 卷 draft）、遵生八箋（`book.id=zunshengbajian`，category=子，8 卷 draft）已是仓库真书——改造为纯配置层改动，复用全部既有渲染/检索/敬请期待链路。

## 改动

### 1. `src/site/home.js` — TABS 经史子集 + COPY 文案
`TABS` 改为四部（题名一律繁体全称，与站点既有书影「大學/中庸/論語/孟子/長物志/遵生八箋」全称口径一致）：
```js
const TABS = [
  { key: '經選', books: [], virtual: ['詩經', '尚書', '周易', '春秋'] },
  { key: '史選', books: [], virtual: ['史記', '漢書', '後漢書', '三國志'] },
  { key: '子選', books: ['changwuzhi', 'zunshengbajian'], virtual: ['神奇秘譜', '閒情偶寄'] },
  { key: '集選', books: [], virtual: ['李太白文集', '杜工部集', '王右丞集'] },
];
```
- 经选「诗/书/易/春秋」→ 全称「詩經/尚書/周易/春秋」（用户原话为简称，此处取全称以与既有书影一致；**可应要求改回简称**）
- 子选：长物志、遵生八箋为真书（draft，书影标「需點校」，指向 `/books/changwuzhi/`、`/books/zunshengbajian/`）；神奇秘譜、閒情偶寄为敬请期待
- 渲染顺序：`renderSanzang` 先 `books`（真书）后 `virtual`，子选页签恰好呈「长物志·遵生八箋·神奇秘譜·閒情偶寄」，与用户列举序一致

`COPY`：
- `enterSanzang: '三藏'` → `'古典'`
- `sanzangSub: '儒釋道編選'` → `'經史子集選編'`
- 首页底端 `render.js:268` 用 `COPY`，自动跟随为「古典 · 經史子集選編 →」

### 2. `src/site/render.js` — 三藏页 title
- `renderSanzang` 的 `head('三藏 · 蘭木藏書', …)` → `head('經史子集 · 蘭木藏書', …)`
- 上方注释「儒釋道部類頁簽」→「經史子集部類頁簽」（约 line 160、278-279）
- 首页底端 line 268 不改（用 COPY 跟随）

### 3. `src/site/build.js` — 站点小字库收字补全
`collectSiteChars` 现遗漏：line 31 只 `add(COPY.enterShuku/COPY.shukuSub)`，未收 `enterSanzang/sanzangSub`（既有遗漏，旧文案「三藏/儒釋道編選」靠 UI_CHARS 凑巧够字）。补：
```js
add(COPY.enterSanzang); add(COPY.sanzangSub);
```
确保新文案「古典」「選」「編」等字入站点 A 级小字库（生产构建需要；dev 预览落系统字体不受影响）。`TABS.virtual` 新题名已由 line 29 自动收录。

### 4. `CLAUDE.md` — 文档同步
「三藏页」节：儒释道部类页签描述 → 经史子集四部（经选/史选/子选/集选，未收录书敬请期待）；首页底端入口名同步。

## 不改（复用 / 保留）
- **路径 `/sanzang/` 保留**：内部代号，用户不可见；改路径牵连 `serve.js` 路由、`build.js` put 路径、首页/书库等多处链接，收益小风险大。仅改面向用户的 title/文案/分类。
- **`aggregate.js` / `CAT_ORDER`**：无集部真书（集选全 virtual），书库不显示集部；三藏页 TABS 独立配置，不依赖 CAT_ORDER。
- **`TOPICS` / 专题页**：四时幽赏、四书涵泳不变。
- **`virtTome` / `searchIndex` / `coming-soon`**：敬请期待链路复用；virtual 题名自动入检索（`OpenCC` tw→cn 转简体索引）、自动链 `/coming-soon/?t=<题名>`。

## 敬请期待映射
| 部 | 真书（链目录页） | 敬请期待（virtual） |
|---|---|---|
| 经选 | — | 诗经、尚书、周易、春秋 |
| 史选 | — | 史记、汉书、后汉书、三国志 |
| 子选 | 长物志、遵生八箋（draft·需點校） | 神奇秘谱、闲情偶寄 |
| 集选 | — | 李太白文集、杜工部集、王右丞集 |

## 验证
1. worktree 内 `npm run build -- --only=html`（站点页）无报错；或 dev `node tools/serve.js 8126`（**改 JS 后须重启 serve**——Node require 缓存，CSS 方才热更）
2. 目检 `http://localhost:8126/`：
   - 首页底端：「古典 · 經史子集選編 →」，链接 `/sanzang/`
   - 三藏页：四页签 经选/史选/子选/集选；title「經史子集 · 蘭木藏書」
   - 子选页签：长物志/遵生八箋真书书影（标「需點校」）+ 神奇秘譜/閒情偶寄敬请期待占位
   - 经选/史选/集选页签：全敬请期待占位，点入 `/coming-soon/`
   - 检索框输入「史记」「李白」「诗经」等：命中显示敬请期待
3. pre-commit `validate`（全作品校验）通过；本改动不触幽兰 `src/`，故 `verify` 不触发

## worktree
- 基于 dev 新建 worktree `.claude/worktrees/site-jingshiziji` + 分支 `engine/site-jingshiziji`
- 改完构建预览无误后提交、合并回 dev（用户确认后 push，回收 worktree/分支）
