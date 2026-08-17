# PDF 预览与网盘分发方案

> 状态：已实施（2026-08，分支 engine/pdf-preview-netdisk 合并入 dev）

## 背景

- 全量构建 66 个 PDF 共 **2 GB**，单卷最高 98 MB（尚书卷三 98 MB × 3 字面）
- 宋版引擎每部作品按字面（楷/宋/行楷）逐叶截图生成多页 PDF，是最耗时的构建步骤
- PDF 已通过 `.dockerignore` 排除出镜像，走 `dist/` 卷挂载，但构建慢、占磁盘

## 方案与实施

### 一、构建：默认只生成预览 PDF

修改 `src/render/pdf-songke.js`：

- 新增 `maxLeaves` 参数，默认 **5 叶**（10 个半叶），循环取 `Math.min(n, maxLeaves)`
- 从 `meta.export.previewLeaves` 读取，可按作品覆盖（如某书只要前 3 叶）
- 生成 PDF 文件名不变（如 `Daxue-Songke-Kai.pdf`），体积从 ~90MB 降至 ~15MB
- 构建日志标注预览叶数：`[PDF] Kai面：預覽前 5 葉（共 15 葉，全量用 --pdf-full）`

修改 `tools/cli.js`，新增 `--pdf-full` 标志：

```
node tools/cli.js build --work=daxue --pdf-full   # 全量 PDF（用于上传网盘）
node tools/cli.js build --work=daxue               # 默认：仅预览前 5 叶
node tools/cli.js build                             # 全量构建：所有作品仅预览
```

手卷引擎（`pdf.js`）本就单页，无需改动。

### 二、网盘链接配置：一书一链 + 总文件夹兜底

在 `src/site/home.js`：

```js
// 全局兜底：共享网盘文件夹（收纳无独立链接的书）
const NETDISK_FOLDER = 'https://pan.baidu.com/s/1i3e4N9SLcnwJBhRD0LbQAw?pwd=6666';

const BOOK_META = {
  daxue:     { collation: '精校', diben: '當塗郡本', netdisk: '' },  // 重要书填独立链接
  zhongyong: { collation: '精校', diben: '當塗郡本', netdisk: '' },
  lunyu:     { collation: '初校', diben: '當塗郡本' },  // 无 netdisk → 走 NETDISK_FOLDER
  // ...
};
```

单卷作品（手卷等无 `book` 归属的）可在 `works/<id>/meta.yaml` 顶层加 `netdisk: <url>`；未配的也走全局兜底。

**链接优先级**：`meta.netdisk`（单卷）→ `BOOK_META[book.id].netdisk`（属书之卷）→ `NETDISK_FOLDER`（全局兜底）→ 都不配则不显示网盘行。

### 三、下载菜单：预览标注 + 网盘外链

修改 `src/render/html-songke.js` 下载菜单：

- 预览 PDF 链接：`楷体试读`（`title` 属性提示「前五叶预览」；`--pdf-full` 时无标注）
- 末尾追加网盘外链：`全量资源 · 网盘`（一书一链时）/ `全量资源 · 网盘共享夹`（兜底时），新标签页打开
- 网盘行与试读项之间以分隔线（`.dl-sep`）分组，区分「本站预览 / 外部全量」

修改 `src/render/html.js` 下载菜单：同理追加网盘外链行；手卷 JPG 项显示 `宋体长图` 等。

修改 `src/site/aggregate.js`：BOOK_META 合并时将 `netdisk` 透传到 book 对象（备目录页后续使用）。

### 四、UI 简体化与工具栏精简

**简体化**（用户可读性优先，正文仍保留繁简切换）：

- 工具栏控件固定简体：`目录 / 繁体 / 界行 / 单页阅读 / 前叶 / 后叶 / 字号 / 下载`
- 宋版 `songke.js` 新增 `convUi()` 强制简体转换工具控件文案；`conv()` 保持随正文繁简切换
- 手卷 `viewer.js` 同步简体（`简体`/`繁体` 按钮控制正文）
- 下载菜单构建期以 `opencc-js` 转换字体标签为简体

**工具栏精简**：

- 宋版：朱点按钮（朱点四式循环：经注并朱/惟经施朱/惟注施朱/白文无点）后移至字号滑块右侧；单叶/通叶披览改为「单页阅读/滚动阅读」
- 手卷：移除 topbar 统计区（全卷行/谱文行/摹录字/处夹注/厘米）；三体按钮（宋体/写经体/行楷）改为 `select` 下拉选择，与宋版字面下拉一致

### 五、Docker

**无需改动**。当前 `.dockerignore` 已排除 `dist/**/*.pdf`，PDF 走 `./dist:/media:ro` 卷挂载。预览 PDF 体积小，仍可走此路径提供下载。

### 六、工作流程

1. 日常构建 `npm run build`：只生成预览 PDF，速度快、体积小
2. 需要全量 PDF 时：`node tools/cli.js build --work=<id> --pdf-full`
3. 上传到百度网盘：
   - 重要书：单独建分享链接，填入 `BOOK_META[id].netdisk`
   - 其余书：拖入共享文件夹即可，无需单独分享
4. 重新构建站点页即生效

## 涉及文件

| 文件 | 改动 |
|------|------|
| `src/render/pdf-songke.js` | 加 `maxLeaves` 限制，支持预览模式 |
| `tools/cli.js` | 新增 `--pdf-full` 标志，透传到渲染器 |
| `src/site/home.js` | NETDISK_FOLDER 全局兜底 + BOOK_META 新增 `netdisk` 字段 |
| `src/site/aggregate.js` | 透传 netdisk 到 book 对象 |
| `src/render/html-songke.js` | 下载菜单简体 + 网盘外链 + 预览标注 + 分隔线；朱点按钮后移 |
| `src/render/html.js` | 下载菜单简体 + 网盘外链；去 facts 统计区；三体按钮改下拉 |
| `src/viewer/songke.js/css` | convUi 简体；单页阅读/滚动阅读；dl-sep 样式 |
| `src/viewer/viewer.js/css` | faceSel 下拉逻辑；简体文案；select/dl-sep 样式 |

## 不改动的部分

- `pdf.js`（手卷 PDF）：单页输出，无性能问题
- Docker / nginx 配置：PDF 排除和卷挂载已就绪
- 站点 TOC 页：暂不显示下载链接，后续可加
