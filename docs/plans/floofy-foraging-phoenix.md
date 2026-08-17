# G5 单一出口：grid-export.js（text.yaml 入库）

## Context

网格基 G1–G4 已实施并双书验收：基础层 `grid-transcribe.json`（逐格）+ overlay `grid-overlay.json`（参校/labels/sections）+ `grid-officer.js`（四官建议）+ `grid-review.js`（精校台人决）+ `grid-review-merge.js`（写 `overlay.fixes`）。**但全仓无脚本消费 overlay 派生 works 产物**——`build-works.js` 走 `grid.json`/`transcribeToGrid` + 文本 match 切节，完全忽略 overlay（labels/sections/fixes）；`fixes` 回灌只是存档，进不了 `works/<id>/text.yaml`（文档 §1 自标「G5 未实施」）。

G5 缺口即此：让 fixes 真正生效（改字进 songke 引擎）的前提，是一个直接消费「基础层 + overlay + fixes」的单一出口。本计划补这个出口，最小切口只做 `text.yaml` 入库；善本点校本.md / 校勘记.md 二期。旧 `build-works.js` / `export.js` 保留可跑做对照，验收后下线。

## 决策（用户已定）

- **范围**：只 `text.yaml` 入库（最小切口）
- **关系**：新建独立脚本，旧 `build-works.js` / `export.js` 保留对照

## 新建文件

`collation/tools/grid-export.js`

## 复用（已验证 file:line，勿重写）

- `loadBaseGrid(tr)` @ `src/grid.js:58-75` —— 基础层 → `{pages, flat, gridStr, strIdx}`；输出的 cell **已带 `page` 字段、已 `sort(col,row)`、已 filter 空格**。`require('../src/grid')` 直接用。
- text.yaml 内联拼接格式 @ `build-works.js:118-122`：`  - id: ${id}\n    name: ${name}\n    blocks:\n` + `      - { type: ${t}, text: ${text} }\n`（非 yaml.stringify）。
- countTokens @ `build-works.js:112-113`（`NON_TOKENS` set + `[...text].filter`）—— `build-works` 未 export，`grid-export` 内**复制实现 + 注释「与 build-works.js:112 一致，待抽共享」**。
- fixes 消费逻辑 @ `grid-review-merge.js:38-64`（写入的反向即消费：`fixMap[p:c:r]=to`、`insertAfter[p:c:r]=text`）。

## 重写函数（grid-export.js 内）

1. **`cellsInRange(base, from, to)`**：遍历 `base.pages[].cells`（已 sort col,row、带 page），三级比较 `(page,col,row)` 取闭区间 `[from,to]`。跨页跨列精确到格，section 边界落在列中间不吞整列。
2. **`deriveBlocks(cells, labelMap, fixMap, insertAfter)`**：
   - `role = labelMap[p:c]`（overlay.labels）
   - `role === 'title'` → 跳过（section.name 已含章名）
   - `ch = fixMap[p:c:r] ?? c.char`（sub 改字）
   - ○ 在 `j` 跳过、在 `z` 保留作段落分隔
   - 连续同 role 合并 `block{type, text}`（同 build-works:75-77）
   - `insertAfter[p:c:r]` 在该格后追加（补夺文）—— **注意把 insert 应用放在 title/○ 跳过 `continue` 之前**，否则被跳过格的 insert 会丢（边界罕见：fixes 当前空 + ○+insert+j 组合，但实现须防）
3. **`renderTextYaml(workId, sections)`**：复用 build-works:118-122 格式。
4. **`exportWork(workId, newId)`**：装 `tr`+`ov` → 建 `fixMap`/`insertAfter`/`labelMap` 索引 → 逐 `ov.sections` 调 `cellsInRange`+`deriveBlocks` → `renderTextYaml` → 写 `works/<newId>/text.yaml`。

## CLI

```
node collation/tools/grid-export.js <书名> <新作品id>
例: node collation/tools/grid-export.js 大学章句 daxue-songben-g5
    node collation/tools/grid-export.js 中庸章句 zhongyong-songben-g5
```

## 输出

`works/<newId>/text.yaml`（`sections[].blocks[]{type:j|z, text}`）。meta/seals/ornaments 本次不产（沿用旧 build-works 或二期）。

## 验收（fixes 恒空 → 纯基础层+overlay 派生基线）

- **大学**：12 sections（xu + jing + zhuan1..10）/ 含序（旧 daxue-songben 仅 1 section 缺序 12%，§4 实测旧 ~5923 字）。
- **中庸**：34 sections（xu + zhang1..33）/ 含序（旧缺序+首章命名不一致）。
- 逐 section 查 id/name；逐 block 查 type/text。
- **重点**：title 列不入 blocks——新 text.yaml 不含「右經一章」「右傳之X章」等章题字（G5 vs 旧差异：旧 build-works 不过滤 title，章题字混进 block）；○ 在 j 跳过、z 保留（如 z block 见 `○大學者…`）。
- 字数/section 数/block 数三维比对；可选逐块 diff vs 旧 text.yaml（容忍 title 差异）。

## 边界

- 大学 p4/p25 重叠区（§5 短板，G2 重跑前残留）：`cellsInRange` 坐标切片重叠格只取一次；验收查 zhuan5/zhuan6 字数异常。
- 缺页 p37-40（题跋/刊记）：查 overlay.sections 末节 `to` ≤ p36，不在范围自然跳过。
- 跨页 section（xu: p2c1r1→p6c2r6）：三级比较正确切片。

## 二期扩展（本次不做）

- fixes 填入后重跑：`grid-review-merge --write` → `grid-export` 重跑 → text.yaml 体现改字（`git diff` 可见）。
- meta.yaml/expect：复用 build-works:124-135 模板逻辑。
- 善本点校本.md：blocks→连续文本 + `punctuate-llm` 句读。
- 校勘记.md：overlay.variants(oldOcr/modern) + fixes 三源归并，按 section，位置用格坐标。
- 抽共享模块 `songke-pipeline.js`（countTokens/cellsInRange/deriveBlocks/renderTextYaml），build-works 与 grid-export 共用，消除复制。

## 不做

- 不改 build-works.js / export.js（保留对照）。
- 不产 meta/seals/ornaments、善本点校本、校勘记（二期）。

## 验证方式（端到端）

1. 实现 `grid-export.js`。
2. `node collation/tools/grid-export.js 大学章句 daxue-songben-g5` → 查 12 sections / 含序 / 无 title 章题字 / ○ 处理。
3. `node collation/tools/grid-export.js 中庸章句 zhongyong-songben-g5` → 查 34 sections / 含序。
4. 与 `works/daxue-songben/text.yaml` 逐块对照（容忍 title 差异与序的增量）。
5. 可选：`npm run build -- --work=daxue-songben-g5 --only=html` 验证 text.yaml 能进 songke 引擎渲染（不回归）。
