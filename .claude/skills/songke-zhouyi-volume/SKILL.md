---
name: songke-zhouyi-volume
description: 从十三经注疏 exe 制作周易正义宋版影刻直出卷（zhouyi-juanN）。exe 解包、DOM 提取、繁简转换、opencc 修正、校验构建的完整工作流。影刻直出引擎（layout: songke-facsimile）。
---

# 周易正义宋版影刻直出卷制作

将《十三经注疏》exe 中的周易正义篇章转为 `works/zhouyi-juanN/` 宋版影刻直出数据。**数据源为 G 管线逐格转写 + 参校文本，exe 文本仅作参校参考。**

> **引擎说明：** 当前标准为 `songke-facsimile`（影刻直出，`layout: songke-facsimile`），逐格坐标直出。旧版 `songke`（宋版善刻，`layout: songke`）已废弃。如需旧版流程，参考 git history 中 `zhouyi-juanN` 系列作品。

## 数据源

影刻直出作品的数据源为 **G 管线（grid-collation skill）** 逐格网格转写，从善本影印 PDF/OCR 经 G1→G5 五阶段派生。详见 `grid-collation` 技能。

exe 文本仅用于参校参照，不再作为主数据源。

## 工作流

### 1. G 管线（主流程）

```bash
# 详见 grid-collation 技能
# 前置：input_data/周易正义/第N卷/ 就绪（当涂郡本/儒藏本 PDF+OCR）
```

### 2. meta.yaml / seals / ornaments

复制上一卷 songke-facsimile meta.yaml 改：

| 字段 | 修改 |
|------|------|
| `id` | `zhouyi-juanN` |
| `title` | 周易正義卷N（影刻直出） |
| `subtitle` | 当涂郡斋刊递修本 · 逐格还原 · 卷N内容 |
| `docTitle` | 周易正義卷N — 宋版影刻 |
| `layout` | `songke-facsimile`（固定） |
| `facsimile.banxinTitle` | 周易卷N |
| `facsimile.cover.slip` | 宋本周易正義卷N |
| `export.base` | `Zhouyi-JuanN-Songke` |
| `aboutHtml` | 更新卷次 |

`gong: 牛山`、faces/fallbackStacks/spec/sources 不变。
`seals.yaml`: `seals: []`；`ornaments.yaml`: `orchids: []`。
`expect: null`（暂不设回归基准，待稳定后填）。

### 3. 校验构建

```bash
npm run validate -- --work=zhouyi-juanN
npm run build -- --work=zhouyi-juanN --only=html   # 快速验证
npm run build -- --work=zhouyi-juanN               # 出 PDF
```

### 4. 提交

分支命名 `content/zhouyi-juanN-facsimile`（从 dev 切出）；提交信息用中文，写明：G 管线质检数据、构建结果。完成后 push origin dev。

## 附录：旧版 exe 解包（仅参校参考）

以下为旧版 `songke` 引擎的 exe 抽取流程，仅作文本参校参考，不再用于主数据生产：

### 1. 解包 exe（UPX）

```bash
upx -d "input_data/十三经注疏/01.《周易正义》.exe" -o "input_data/十三经注疏/01_zhouyi_unpacked.exe"
```

### 2. DOM 提取

```bash
node tools/extract-zhouyi.js zhouyi_extracted/vol01_shangjing_qianzhuan.txt --vol=一 --out=works/zhouyi-juan1/text.yaml
```

### 3. 字符校正参考

| opencc 产出 | 正确 | 说明 |
|-------------|-------|------|
| 雲 | 云 | 疏文中"X雲"均为"X云"（X说） |
| 矇 | 蒙 | 蒙卦名 |
| 禦 | 御 | 周易原文用"御寇" |
| 繫 | 系 | 系辞（繫辭）保留为系辞 |
