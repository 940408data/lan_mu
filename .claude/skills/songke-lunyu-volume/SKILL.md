---
name: songke-lunyu-volume
description: 从四书章句集注.CHM 制作论语集注宋版影刻直出卷（lunyu-songben-volN）。抽取、繁简转换、○ 补入、字符校正、校验构建的完整工作流。用于新增/修正论语各卷（影刻直出引擎，layout: songke-facsimile）。
---

# 论语集注宋版影刻直出卷制作

将《四书章句集注》CHM 中的论语篇章转为 `works/lunyu-songben-volN/` 宋版影刻直出数据。**数据源为 G 管线（grid-collation）逐格转写产出，CHM 文本仅作参校参考。**

> **引擎说明：** 当前标准为 `songke-facsimile`（影刻直出，`layout: songke-facsimile`），逐格坐标直出。旧版 `songke`（宋版善刻，`layout: songke`）已废弃。如需旧版流程，参考 git history 中 `lunyuN` 系列作品。

## 数据源

影刻直出作品的数据源为 **G 管线（grid-collation skill）** 逐格网格转写，从善本影印 PDF/OCR 经 G1→G5 五阶段派生。详见 `grid-collation` 技能。

CHM 文本（`input_data/四书章句集注.CHM`）仅用于参校参照，不再作为主数据源。

## 工作流

### 1. G 管线（主流程）

```bash
# 详见 grid-collation 技能；以下为 lunyu-songben-volN 专有步骤
# 前置：input_data/论语集注/第N卷/ 就绪（当涂郡本/儒藏本 PDF+OCR）

# 1a. 登记 editions.yaml + 创建 layout.json
# 1b. G1 逐格转写（qwen3.8-max --force-deep）
# 1c. G2/G3 参校挂格
# 1d. G4 四官审议
# 1e. G5 出口：grid-to-work.js 产出 grid.yaml
```

### 2. meta.yaml / seals / ornaments

复制上一卷 songke-facsimile meta.yaml 改：

| 字段 | 修改 |
|------|------|
| `id` | `lunyu-songben-volN` |
| `title` | 論語集注·卷N（影刻直出） |
| `subtitle` | 当涂郡斋刊递修本 · 逐格还原 · 篇名 |
| `docTitle` | 論語集注卷N — 宋版影刻 |
| `ariaLabel` | 論語集注卷N，宋刻本逐格影刻还原，自右向左讀 |
| `seed` | 新 5 位数 `2120N` |
| `layout` | `songke-facsimile`（固定） |
| `facsimile.banxinTitle` | 論語 |
| `facsimile.cover.slip` | 宋本論語集注卷N |
| `facsimile.colophon` | 末句篇名+凡N章 |
| `export.base` | `LunyuN-Songke` |
| `aboutHtml` | 更新卷次/篇名 |

`gong: 牛山`、faces/fallbackStacks/spec/sources 不变。
`seals.yaml`: `seals: []`；`ornaments.yaml`: `orchids: []`。
`expect: null`（暂不设回归基准，待稳定后填）。

### 3. 校验构建

```bash
npm run validate -- --work=lunyu-songben-volN
npm run build -- --work=lunyu-songben-volN --only=html   # 快速验证
npm run build -- --work=lunyu-songben-volN               # 出 PDF（宋版影刻不出长图）
```

### 4. 提交

分支命名 `content/lunyu-volN-facsimile`（从 dev 切出）；提交信息用中文，写明：G 管线质检数据（葉/列/經字/注字/一致率/四官结果）、构建结果。完成后 push origin dev。

## 参考基线

- lunyu-songben-vol7（卷七 子路·憲問）：55 葉 / 870 列 / 經字 3033 · 注字 7550 / G2a 一致率 99.2% / G2b 一致率 99.1% / 四官 105/117 已决
- lunyu-songben-vol4（卷四 述而·泰伯）：44 葉 / 693 列 / 經字 1937 · 注字 6676
- lunyu-songben-vol8（卷八 衛靈公·季氏）：37 葉 / 584 列 / 經字 2171 · 注字 4781

## 附录：旧版 CHM 抽取（仅参校参考）

以下为旧版 `songke` 引擎的 CHM 抽取流程，仅作文本参校参考，不再用于主数据生产：

```bash
# 文件映射（CHM → 篇）
# input_data/chm_extract/<N>.htm，N = 论语篇次 + 6
# 卷七 子路第十三/憲問第十四 → 19 / 20

node tools/extract-lunyu.js input_data/chm_extract/<首篇htm> --name=<首篇篇名> --header --vol=<卷号汉字>
node tools/extract-lunyu.js input_data/chm_extract/<次篇htm> --name=<次篇篇名>
```

对校本：`input_data/lunyucollect.txt`（數位經典 UTF-8 繁体全文）。

字符校正参考（opencc 过度转换）：

| 误 | 正 | 说明 |
|-----|-----|------|
| 史記雲 | 史記云 | 云=说，非雲雨 |
| 山樑 | 山梁 | 论语原文用梁 |
| 後雕 | 後彫 | |
| 韞并 | 韞匵 | 匵=匣 |
| 亦佔反 | 亦占反 | 注音用占 |
