# 兰亩（lan_mu）

古代书籍、书法、绘画的现代数字复刻。「一次校录，多态呈现」——同一份结构化数据，产出 Web 交互卷、JPG/PNG 长图与 PDF 三种形态。

首个复刻对象：**《碣石調 · 幽蘭第五》**唐人写本（东京国立博物馆 TB-1393），现存唯一古琴文字谱，全卷 242 行、4758 字。

## 架构

四层结构，数据与表现彻底分离：

```
works/        内容数据层（每部作品一个目录，纯 YAML + 资产）
  └─ youlan/  meta.yaml（元信息/版式/导出参数）
              text.yaml（正文 + marks 笔墨编码 + 夹注）
              seals.yaml（印章）ornaments.yaml（纸面装饰）assets/（扫描图等）
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
npm run dev       # 本地预览服务器（含 B 级字体的本机注入）
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

## 已知经验

- local-only `@font-face` 在本机不命中时会进入 error 状态，阻塞字体栈后续 url() 字体的自动加载——B 级字体在访客端只放 bare family name，出图端才注入含 url 的 @font-face。
- `file://` 字体在 `http://` origin 下被 Chromium 阻止，本地预览由 `tools/serve.js` 以 HTTP 路由注入。
