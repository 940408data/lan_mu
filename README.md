# 兰木（lan_mu）

兰，是幽兰之兰，也是兰亭之兰；木，是桐木之木。兰木致力于书法、古籍、音乐的现代数字文创。「一次校录，多态呈现」——同一份结构化数据，产出 Web 交互卷、JPG/PNG 长图与 PDF 三种形态。

首个复刻对象：**《碣石調 · 幽蘭第五》**唐人写本（东京国立博物馆 TB-1393），现存唯一古琴文字谱，全卷 242 行、4758 字。

第二部：**《蘭亭集序》**（神龙本字序，27 行 × 12 字，324 字）——纯数据接入，引擎零改动，验证了模板通用性。

## 架构

四层结构，数据与表现彻底分离：

```
works/        内容数据层（每部作品一个目录，纯 YAML + 资产）
  ├─ youlan/  meta.yaml（元信息/版式/导出参数）
  │           text.yaml（正文 + marks 笔墨编码 + 夹注）
  │           seals.yaml（印章）ornaments.yaml（纸面装饰）assets/（扫描图等）
  └─ lanting/ 同构四件套；无 marks（按 seed 确定性生成）、无夹注/扫描图
src/core/     版面引擎：load.js 读入 → typeset.js 排版 → calligraphy.js 笔墨 → mount.js 装裱
src/fonts/    字体管线：fonts.yaml 登记册 / fonts.js 解析注入 / subset.js 子集化
src/render/   渲染器：html.js（交互卷）/ image.js（JPG+PNG）/ pdf.js / browser.js
tools/        cli.js（构建入口）/ verify-replica.js（保真验收）/ serve.js（本地预览）
dist/         产物（gitignore，npm run build 生成）
```

## 常用命令

```powershell
npm install
npm run build     # 全量构建：字体子集 → HTML → 出图（JPG+PNG）→ PDF
npm run verify    # 复刻保真验收：242 列逐字符比对、印章/纸面 svg 一致性
npm run dev       # 本地预览服务器（含 B 级字体的本机注入；首页为作品列表，端口被占自动顺延）
npm run validate  # 数据校验
npm run new <id>  # 新建作品脚手架
```

## 字体三级授权管线

| 级别 | 授权 | 用法 |
|---|---|---|
| A | 开源（如 OFL） | 子集化为 woff2，随页嵌入 |
| B | 免费商用但禁嵌入 | 仅本机出图：`fontLocal` 双轨，出图端注入 `file://` @font-face |
| C | 付费 | 预留 |

角色（faces）配置见 `works/<id>/meta.yaml`，支持 `font`（主）+ `fontLocal`（B 级兜底）双轨。字体源文件置于 `src/fonts/src/<id>/`（不入仓库，按 `fonts.yaml` 中 `source` 自行下载）。

当前幽兰用字：宋体（source-han-serif，A）、寫經體（fahua-wenkai，A，待补文件）、行楷（lxgw-wenkai-tc，A + 英椎行书 ac-gyosyo，B 双轨）。

## 出图方案

Playwright 无头 Chromium 打开 dist HTML，按字体角色逐版截图。整卷宽 × 缩放超过 Chromium 单次截图 16384px 上限（超限内容会回绕重复），故按 8000 设备像素分片 `clip` 截图，pngjs 无损水平拼接，同一像素数据输出 **JPG**（quality 88）与 **PNG**（无损存档版）两份。

## 确定性

版面由 `meta.yaml` 的 `seed` 与数据文件完全决定；构建产物逐字节可复现，`verify` 通过即视为复刻保真。

## 模板通用性

新作品仅需 `npm run new <id>` 后填四个 YAML（meta / text / seals / ornaments），引擎、字体管线、出图、预览全部复用：marks 可省略（按 seed 确定性生成），夹注/扫描图/纸纹/点缀均为可选。已知边界：`typeset.js` 的「谱文行」统计按幽兰分区名（谱题/文字谱/尾题）计数，其他作品该项为 0，不影响构建。

## 已知经验

- local-only `@font-face` 在本机不命中时会进入 error 状态，阻塞字体栈后续 url() 字体的自动加载——B 级字体在访客端只放 bare family name，出图端才注入含 url 的 @font-face。
- `file://` 字体在 `http://` origin 下被 Chromium 阻止，本地预览由 `tools/serve.js` 以 HTTP 路由注入。
