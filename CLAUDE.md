# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

兰木（lan_mu）：书法、古籍、音乐的现代数字文创。核心理念「一次校录，多态呈现」——同一份结构化 YAML 数据，由版面引擎产出 Web 交互卷、JPG/PNG 长图、PDF 三种形态。数据与表现彻底分离，新作品仅填四个 YAML 即可复用全部引擎。

CommonJS 模块（`"type": "commonjs"`），Node.js ≥ 18（开发于 v20）。仓库语言为中文，代码注释、提交信息、用户面向文案均用中文。

## 常用命令

```bash
npm install                      # 首次（含 Playwright 依赖；出图另需 npx playwright install chromium）
npm run build                    # 全量构建：字体子集 → HTML → 出图 → PDF（全部作品）
npm run build -- --work=youlan              # 单部作品
npm run build -- --work=lanting --only=html # 仅 HTML（改数据/样式后快速重建，only 可含 html,jpg,pdf）
npm run validate                 # 数据校验（行数/字数/夹注/印/兰 与 meta.expect 基准比对）
npm run verify                   # 幽兰复刻保真验收（dist 与根目录 Youlan-Scroll.html 逐字符比对，退出码 0=通过）
npm run dev                      # 本地预览（node tools/serve.js，默认 8125，端口被占自动顺延）
node tools/serve.js 8127         # 指定端口预览
npm run new <id>                 # 新建作品脚手架（id 须 ^[a-z0-9-]+$）
npm run font:register <id> --file=<路径> --family=<英文名> --license=A|B|C   # 登记字体到 fonts.yaml
node tools/gen-index.js          # 构建后生成 dist/index.html 静态首页（生产部署需要；dev 时由 serve.js 动态生成）
```

**无测试框架、无 linter。** 最接近「测试」的是 `npm run verify`（幽兰逐字符保真验收）与 `npm run validate`（全作品数据基准校验）。改引擎后务必跑 `verify` 确认幽兰未回归——它是逐字节可复现性的守门人。

## 高层架构

### 双引擎，按 meta.layout 分派

`src/core/load.js` 装载 `works/<id>/` 的 YAML → `WorkData`；`src/core/model/scroll.js` 的 `buildLayout(work)` 读 `work.meta.layout` 分派到两个版式模型之一，产出中间表示 `LayoutTree`，三渲染器（html/image/pdf）共用：

- **手卷引擎（layout: scroll）** — `src/core/model/scroll.js` → `typeset.js`（排版，展开 sections→columns）→ `calligraphy.js`（逐字笔墨微变换 k/j/h）→ `mount.js`（印章/兰花装裱）。渲染器：`html.js` / `image.js` / `pdf.js`。
- **宋版善刻引擎（layout: songke）** — `src/core/model/songke.js` → `typeset-songke.js`（经注分栏，j=经文大字单行、z=注文小字双行，半叶配对成叶）。渲染器：`html-songke.js` / `pdf-songke.js`。**宋版不出长图**——改用每字面一版 PDF（`--only=jpg` 对宋版是空操作）。

### 构建管线（tools/cli.js cmdBuild）

每作品顺序：① 字体子集（`src/fonts/subset.js`，仅 A 级）→ ② HTML（按 songke 标志选渲染器）→ ③ 扫描图（仅手卷 `work.scan`）→ ④ JPG（手卷；宋版跳过）→ ⑤ PDF。产物写 `dist/works/<id>/`。**全量构建（不带 `--work`）末尾自动生成站点页**（见下节）。

### 站点页（src/site/）：首页「藏书」+ 书目页「目录叶」

作品页之外的两级站点页，视觉与宋刻同源（暗案底/纸墨/朱记）：

- **首页** `dist/index.html` — 只列「书」不列卷：顶部检索框（书名/卷次/篇名即输即显，繁简双轨——简体串构建期 opencc 预转入索引）+ 部类速达锚点；书为瓷青封面线装书影（左上签条题名、左缘订线、右下朱印）立于座上，按 `meta.category` 分部（經/子/書/禮樂）；多卷书 → 目录页，单卷（手卷等无 `book` 块者）→ 直达作品页。
- **目录页** `dist/books/<bookId>/index.html` — 宋刻目录叶：半叶八行、版心鱼尾刻工，每卷一条（大字卷次列 + 双行小字篇名列，序类无篇名者单列），整条即链接，自动分叶；draft 卷于大字列末缀朱色「需點校」。
- **书目归属**：各卷 `meta.book` 块（`id`/`title`/`order`/`entry{big,sub}`），`src/site/aggregate.js` 聚合校验；`order` 用原书卷次，序说/读法类以 0.1/0.2 置前。
- **双轨生成**：`tools/serve.js` 对 `/` 与 `/books/<id>/` 动态渲染（dev 免重建）；`tools/gen-index.js` 与全量 build 末尾产出静态文件（生产）。
- **站点小字库**：`src/site/build.js` 以站点全部用字子集化 A 级楷/宋 → `dist/assets/fonts/`；源字体缺失时页面自动落系统回退栈（dev 不构子集亦可预览）。

### 数据模型（works/&lt;id&gt;/）

每个作品一个目录，四件套 YAML + `assets/`：
- `meta.yaml` — 元信息、版式参数（scroll 几何 / songke 版式）、`seed`（确定性种子）、`expect`（校验基准，可 null）、`faces`（字体角色，支持 `font` 主 + `fontLocal` B 级兜底双轨）、`fallbackStacks`（系统字体回退栈）、`aboutHtml`。属书之卷另有 `book` 块（书目归属，见「站点页」节）。
- `text.yaml` — 正文。**两种结构随引擎而异**：
  - 手卷：`sections[].columns[]`，每列 `line`/`class`/`text`，可选 `marks`（逐字 3 位数字 k/j/h 紧凑串）、`note`（夹注，含 `at` 起始偏移）、`du`（句读段，须为 text 连续前缀片段，构建期前缀接龙校验）。
  - 宋版：`sections[].blocks[]`，每块 `{type: j|z, text}`。
- `seals.yaml` / `ornaments.yaml` — 印章、兰花/纸面装饰，均可缺省。

### 确定性渲染

版面完全由 `meta.seed` + 数据文件决定。`calligraphy.js` 的 `mulberry32(seed, line)` PRNG 跨平台一致——无 marks 时按种子确定性生成笔墨，HTML/JPG/PDF 三端永远一致，构建逐字节可复现。`npm run verify` 通过即视为复刻保真。

### 字体三级授权管线（src/fonts/）

`fonts.yaml` 登记册 / `fonts.js` 解析 / `subset.js` 子集化。源字体二进制置于 `src/fonts/src/<id>/`，**不入仓库**（`.gitignore` 忽略），须按 `fonts.yaml` 中 `source` 链接自行下载：

| 级 | 授权 | 用法 |
|---|---|---|
| A | 开源（OFL 等） | 子集化为 woff2 随页嵌入 |
| B | 免费商用但禁嵌入 | 仅本机出图：`fontLocal` 双轨，出图端注入；**不进 dist** |
| C | 付费 | 预留 |

关键陷阱：B 级字体（如英椎行书）在访客端只放 bare family name，本机预览由 `tools/serve.js` 经 `/b-fonts/` HTTP 路由注入 `@font-face`（`file://` 字体在 `http://` origin 下被 Chromium 阻止）。dist 不含此注入，B 级不外泄。`local()` @font-face 不命中时会阻塞字体栈后续 url() 字体加载，故双轨设计。

### 出图（src/render/browser.js + image.js）

Playwright 无头 Chromium 打开 dist HTML 按字体角色逐版截图；缺失时自动回落系统 Chrome/Edge。整卷宽 × 缩放超 Chromium 单次 16384px 上限（超限内容回绕重复），故按 8000 设备像素分片 `clip` 截图，pngjs 无损水平拼接，同像素数据输出 JPG（quality 88）+ PNG（无损存档）两份。**出图仅构建期需要；dist 为纯静态产物，运行期零依赖。**

`opencc-js`（繁简映射）在 `html.js` / `html-songke.js` 烘焙进 HTML，供查看器端繁简切换。

## 部署

两种 Dockerfile：
- **`Dockerfile`**（生产，docker-compose 默认用此）— nginx:alpine 托管**预构建**的 `dist/`。须先本地 `npm run build && node tools/gen-index.js`，再 `docker compose build`。镜像小、快。
- **`Dockerfile.full`**（CI/CD）— 多阶段，含 Playwright 构建层（`mcr.microsoft.com/playwright`），容器内完成 `npm run build` + `gen-index`。

端口 8080，healthcheck `/healthz`，nginx 配置见 `docker/nginx.conf`（静态托管 + gzip + 安全头 + 资源长缓存 / HTML 不缓存）。dist 整体即站点根，保持 `/works/<id>/` 目录结构（页内字体、扫描图、下载菜单均相对同级路径）。

## 关键操作准则

- **改 `works/*.yaml` 或引擎（viewer/css/html.js）后必须重建**才在预览/出图生效——预览读的是 `dist/`，非源码。
- **新作品**：`npm run new <id>` 后填四 YAML，marks 可省（按 seed 生成），夹注/扫描图/纸纹/点缀均可选。已知边界：`typeset.js` 的 `scoreLines` 统计按幽兰分区名（譜題/文字譜/尾題）计数，其他作品该项为 0，不影响构建。
- **校录完成后**填 `meta.expect` 作为校验基准；`npm run validate` 会在实得值 ≠ 基准时报错。**`expect` 仅用于 `validate`（测试/验证），不影响 build/渲染/产物/功能**——`npm run build` 从 `text.yaml`+`seed` 经引擎渲染，不读 `expect`；dist、前端服务、出图、PDF 全与之无关。
- **`expect` 是静态回归锚点，不自动跟随引擎**。引擎改版式（如注文均齐/经注合栏，`src/core/typeset-songke.js`）会让**布局字段**（columns/halves/leaves）变 → `expect` 须重同步；**文字量**（chars/jChars/zChars）由 `text.yaml` 决定、不随引擎变。故**改引擎后应跑 `validate`，把受影响作品的 `expect` 按新实得重填**（可脚本批量：置 null → validate 取实得 → 回填），否则回归检查报红。这是静态基准设计的固有代价（换得意外回归检测能力）。
- 改版式几何/字体后跑 `npm run build -- --work=<id> --only=html` 快速验证，再全量 build 出图。
- 主分支为 `dev`（非 main/master）；PR 目标分支用 `dev`。
- **分支/提交规范见 `CONTRIBUTING.md`**：分支名 `<type>/<kebab-desc>`（`content/`校录、`engine/`引擎排版、`infra/`基建、`fix/`修复），提交信息 `<type>(<scope>): <中文描述>`；Tag 仅在内容里程碑按需打（暂不引 semver）。
- **pre-commit hook**（`.githooks/`，`npm install` 经 `prepare` 自动配置 `core.hooksPath`）：提交前自动跑 `validate`，改动触及 `src/core|render|fonts|viewer/`、`works/youlan/`、`css/` 时加跑幽兰 `verify`（逐字节保真守门）。绕过用 `git commit --no-verify`。
