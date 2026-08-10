# 兰木（lan_mu）

兰，是幽兰之兰，也是兰亭之兰；木，是桐木之木。兰木致力于书法、古籍、音乐的现代数字文创。「一次校录，多态呈现」——同一份结构化数据，产出 Web 交互卷、JPG/PNG 长图与 PDF 三种形态。

首个复刻对象：**《碣石調 · 幽蘭第五》**唐人写本（东京国立博物馆 TB-1393），现存唯一古琴文字谱，全卷 242 行、4758 字。

第二部：**《蘭亭集序》**（神龙本字序，27 行 × 12 字，324 字）——纯数据接入，引擎零改动，验证了模板通用性。

第三部：**《歸去來兮辭》**（依骈对断句、参差成行，31 列 339 字）；第四部：**《般若波羅蜜多心經》**（玄奘译，经文 260 字）。后两部同为纯数据接入。

第五、六、七部：**《論語集注》卷之一**（朱熹，學而第一十六章 + 為政第二二十四章）、**《大學章句》**（朱熹，經一章 + 傳十章全帙，含格物致知補傳）与**《大學章句序》**（朱熹自序，純大字無注，獨立成卷）——接入**宋版善刻引擎**：专事古籍刻本式排版（半叶八行、经文大字单行、注文小字双行，一列惟纯经或纯注、遇章别行、遇注另起列，版心鱼尾、朱笔圈点），字面可下拉选择楷体/宋体（朱雀仿宋）/英雄行楷三式，与专事书法的手卷引擎并列为双引擎。

## 架构

四层结构，数据与表现彻底分离：

```
works/        内容数据层（每部作品一个目录，纯 YAML + 资产）
  ├─ youlan/  meta.yaml（元信息/版式/导出参数）
  │           text.yaml（正文 + marks 笔墨编码 + 夹注）
  │           seals.yaml（印章）ornaments.yaml（纸面装饰）assets/（扫描图等）
  └─ lanting/ 同构四件套；无 marks（按 seed 确定性生成）、无夹注/扫描图
src/core/     版面引擎：load.js 读入 → 版式模型分派（meta.layout）
  ├─ model/scroll.js  手卷引擎（书法）：typeset.js 排版 → calligraphy.js 笔墨 → mount.js 装裱
  └─ model/songke.js  宋版善刻引擎（古籍）：typeset-songke.js 经注分栏 → 半叶/书叶配对
src/fonts/    字体管线：fonts.yaml 登记册 / fonts.js 解析注入 / subset.js 子集化
src/render/   渲染器：html.js / image.js / pdf.js（手卷）+ html-songke.js / pdf-songke.js（宋版，每字面一版 PDF，不出长图）+ browser.js
src/viewer/   查看器：viewer.css/js（手卷）+ songke.css/js（书叶）
tools/        cli.js（构建入口）/ verify-replica.js（保真验收）/ serve.js（本地预览）
dist/         产物（gitignore，npm run build 生成）
```

## 常用命令

```powershell
npm install
npm run build     # 全量构建：字体子集 → HTML → 出图（手卷 JPG+PNG；宋版略过，径出每字面一版 PDF）→ PDF
npm run verify    # 复刻保真验收：242 列逐字符比对、印章/纸面 svg 一致性
npm run dev       # 本地预览服务器（含 B 级字体的本机注入；首页为作品列表，端口被占自动顺延）
npm run validate  # 数据校验
npm run new <id>  # 新建作品脚手架
```

## 部署与启动

### 环境依赖

- Node.js ≥ 18（开发于 v20）+ npm；依赖见 `package.json`（fontkit/subset-font 子集化、playwright 出图、opencc-js 繁简映射、pdf-lib 等）
- 出图（JPG/PNG/PDF）需无头 Chromium：优先 Playwright 自带（`npx playwright install chromium`），缺失时自动回落系统 Chrome/Edge（`src/render/browser.js`）
- 以上仅**构建期**需要；`dist/` 为纯静态产物，运行期零依赖

### 字体准备（仅首次）

- A 级字体源文件（ttf/otf）置于 `src/fonts/src/<id>/`（不入仓库；下载址见 `src/fonts/fonts.yaml` 的 `source`），如 zhuque-fangsong、lxgw-wenkai-tc；构建时自动子集化为 woff2 随页嵌入
- B 级字体（fahua-wenkai 写经体、ac-gyosyo 英椎行书）授权禁嵌入：本机出图/预览需置同名文件或系统已安装该字体；缺失时自动回退系统楷体等，不阻断构建

### 构建

```powershell
npm install
npm run build                            # 全部作品：子集 → HTML → 三体 JPG/PNG → PDF
npm run build -- --work=xinjing          # 单部作品
npm run build -- --work=lanting --only=html   # 仅 HTML（改数据/样式后快速重建）
npm run validate                         # 数据校验（行数/字数/印/兰 与 expect 基准）
npm run verify                           # 幽兰复刻保真验收
```

注意：`works/*.yaml` 与引擎（viewer/css/html.js）的改动**须重建**才在预览/出图生效——`dist/` 是构建产物，预览读的是它。

### 本地启动

```powershell
npm run dev                 # 即 node tools/serve.js，默认 8125，被占自动顺延
node tools/serve.js 8127    # 指定端口
```

- 首页 `http://localhost:<port>/` 为作品列表；单卷 `/works/<id>/index.html`
- serve.js 另以 `/b-fonts/` HTTP 路由向本机预览注入 B 级字体（dist 不含此注入，B 级不外泄）；静态部署无此增强
- 残留进程清端口（Windows）：`netstat -ano | findstr 812` 查 PID，`Stop-Process -Id <PID> -Force`

### 静态部署

- `dist/` 整体即站点根目录（HTML + fonts/woff2 + 三体 JPG/PNG + PDF），可直投 nginx / GitHub Pages / 对象存储等任意静态托管，无需服务端运行时
- 保持 `/works/<id>/` 目录结构不变（页内字体、扫描图、下载菜单均相对同级路径）
- 与本地预览的唯一差异：B 级字体无 `/b-fonts/` 注入，访客端视其系统安装情况回退；A 级子集、三體切换、句讀/簡體、長圖下載、PDF 均不受影响

## 字体三级授权管线

| 级别 | 授权 | 用法 |
|---|---|---|
| A | 开源（如 OFL） | 子集化为 woff2，随页嵌入 |
| B | 免费商用但禁嵌入 | 仅本机出图：`fontLocal` 双轨，出图端注入 `file://` @font-face |
| C | 付费 | 预留 |

角色（faces）配置见 `works/<id>/meta.yaml`，支持 `font`（主）+ `fontLocal`（B 级兜底）双轨。字体源文件置于 `src/fonts/src/<id>/`（不入仓库，按 `fonts.yaml` 中 `source` 自行下载）。

当前用字：宋体（zhuque-fangsong 朱雀仿宋，A，改刻自民国活字「南宋」；此前为思源宋体 source-han-serif）、寫經體（fahua-wenkai，B，待补文件）、行楷（lxgw-wenkai-tc，A + 英椎行书 ac-gyosyo，B 双轨）。

## 出图方案

Playwright 无头 Chromium 打开 dist HTML，按字体角色逐版截图。整卷宽 × 缩放超过 Chromium 单次截图 16384px 上限（超限内容会回绕重复），故按 8000 设备像素分片 `clip` 截图，pngjs 无损水平拼接，同一像素数据输出 **JPG**（quality 88）与 **PNG**（无损存档版）两份。

## 确定性

版面由 `meta.yaml` 的 `seed` 与数据文件完全决定；构建产物逐字节可复现，`verify` 通过即视为复刻保真。

## 模板通用性

新作品仅需 `npm run new <id>` 后填四个 YAML（meta / text / seals / ornaments），引擎、字体管线、出图、预览全部复用：marks 可省略（按 seed 确定性生成），夹注/扫描图/纸纹/点缀均为可选。已知边界：`typeset.js` 的「谱文行」统计按幽兰分区名（谱题/文字谱/尾题）计数，其他作品该项为 0，不影响构建。

## 已知经验

- local-only `@font-face` 在本机不命中时会进入 error 状态，阻塞字体栈后续 url() 字体的自动加载——B 级字体在访客端只放 bare family name，出图端才注入含 url 的 @font-face。
- `file://` 字体在 `http://` origin 下被 Chromium 阻止，本地预览由 `tools/serve.js` 以 HTTP 路由注入。
