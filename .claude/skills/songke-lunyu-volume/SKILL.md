---
name: songke-lunyu-volume
description: 从四书章句集注.CHM 制作论语集注宋版善刻卷（lunyuN）。抽取、繁简转换、○ 补入、字符校正、校验构建的完整工作流。用于新增/修正论语各卷。
---

# 论语集注宋版善刻卷制作

将《四书章句集注》CHM 中的论语篇章转为 `works/lunyuN/` 宋版善刻数据。**先跑抽取脚本得草稿，再逐字校录，最后校验构建。**

## 文件映射（CHM → 篇）

`input_data/chm_extract/<N>.htm`，N = 论语篇次 + 6（前 6 个文件为大学/序说等）：

| 卷 | 篇 | htm |
|---|---|---|
| 四 | 述而第七 / 泰伯第八 | 13 / 14 |
| 五 | 子罕第九 / 鄉黨第十 | 15 / 16 |
| 六 | 先進第十一 / 顏淵第十二 | 17 / 18 |
| 七 | 子路第十三 / 憲問第十四 | 19 / 20 |
| 八 | 衛靈公第十五 / 季氏第十六 | 21 / 22 |
| 九 | 陽貨第十七 / 微子第十八 | 23 / 24 |
| 十 | 子張第十九 / 堯曰第二十 | 25 / 26 |

对校本：`input_data/lunyucollect.txt`（數位經典 UTF-8 繁体全文，行首 `○`=章起首，行中 `○`=注内分节）。

## 工作流

### 1. 抽取草稿

```bash
node tools/extract-lunyu.js input_data/chm_extract/<首篇htm> --name=<首篇篇名> --header --vol=<卷号汉字>
node tools/extract-lunyu.js input_data/chm_extract/<次篇htm> --name=<次篇篇名>
```

首篇加 `--header`（卷首两 j：論語集注卷之X / 新安朱熹集註）。输出 YAML blocks 行，拼入 text.yaml 两个 section。

脚本已内置：GBK 解码 → 章界（≥2 空段）合并经注碎片 → 篇旨独立/校记丢弃 → opencc s2tw + CORRECT 修正（歎/游/欲/繫/弔/戚/里/并/范）→ 引号「」『』→ rule A（注音→释义补○）+ rule B（各家引论前补○）。

### 2. 校录（关键，勿跳过）

对每章 z 块与对校本逐注比对。**○ 目标**：接近对校本注文内 ○ 数（约 +8%，lunyu5：79 vs 73）。

补 ○ 的时机（对校本有而脚本漏的）：
- 非注音起始 z 的首位引论（rule B 会跳过，需人工判断：释义后独立引论 → 补；并入释义者 → 不补）
- 释义段间语义分节（不同经句的释义之间）
- 连续注音段与后续释义之间

删 ○ 的时机：释义碎片间机械连接的 ○（脚本 v2 已去除，若旧数据有须删）。

**常见字符校正**（opencc 过度转/误转，以对校本为准）：

| 误 | 正 | 说明 |
|---|---|---|
| 史記雲 | 史記云 | 云=说，非雲雨 |
| 山樑 | 山梁 | 论语原文用梁 |
| 迴翔 | 回翔 | |
| 後雕 | 後彫 | |
| 韞并 | 韞匵 | 匵=匣 |
| 亦佔反 | 亦占反 | 注音用占 |
| 嘆→歎、遊→游、慾→欲、系→繫、吊→弔、慼→戚、裡→里、並→并 | | CORRECT 表已处理 |

其他必查：
- 篇旨中的 `〔一〕`校记注脚：删除（如鄉黨「按本篇实有十八节…」）
- 引号残留（如 `」` 误入注首）
- 于/於、麤/粗 等语境字：逐处按朱熹原文判断

### 3. meta.yaml / seals / ornaments

复制上一卷 meta.yaml 改：`id`、`title`（論語集注卷X）、`subtitle`、`docTitle`、`ariaLabel`、`seed`（新 5 位数）、`songke.banxinTitle`（論語卷X）、`songke.colophon` 末句（「篇名」凡N章…）、`export.base`（LunyuN-Songke）、`aboutHtml`。`gong: 牛山`、faces/fallbackStacks/spec/sources 不变。
`seals.yaml`: `seals: []`；`ornaments.yaml`: `orchids: []`。

### 4. 校验构建

```bash
npm run validate -- --work=lunyuN
npm run build -- --work=lunyuN --only=html   # 快速验证
npm run build -- --work=lunyuN               # 出三体 PDF（宋版不出长图）
```

### 5. 提交

分支命名 `lunyu_book<N>`（从上一卷分支切出）；提交信息用中文，写明：数据源、校验数字（葉/半葉/行/經字/注字）、构建结果、○ 与字符校正明细、残留项。完成后 push。

## 参考基线

- lunyu4（卷四）：z 块 101 ○，每章严格 1j+1z
- lunyu5（卷五）：z 块 79 ○ / 对校本 73；17 葉 / 33 半葉 / 262 行 / 經字 1435 · 注字 6301
- 对校本注文内 ○ 数（卷六至十可对照）：先進+顏淵 约 110、子路+憲問 约 130、衛靈公+季氏 约 110、陽貨+微子 约 90、子張+堯曰 约 80（以实际统计为准）
