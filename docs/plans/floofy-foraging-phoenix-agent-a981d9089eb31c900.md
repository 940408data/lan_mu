# G5 单一出口：export.js 数据源切换摸底（overlay 替换 verdicts/shanben-v2）

## 0. TL;DR 结论

**旧 P6 数据源**：`result.segments`（来自 align/diff）+ `result.variants/clusters/verdicts` + `shanben-v2.json` + `punctuation-llm.json`，由 `buildShanbenPunctuated()` 拼字。善本字来源 = `seg.shanben.detail[*].sb.ch`（对齐时从 shanben-v2 投影过来的字符网格）。

**新 G5 数据源（overlay）**：`grid-overlay.json`（base + labels + sections + fixes）。字从 overlay.cells / labels 取；经/注类型、页码、行列坐标、分章结构全部从 overlay 拿；fixes 是单一反向改写层。

**要改的 export.js 函数**：`exportAll()`（入口）、`buildShanbenPunctuated()`（punctuate.js，核心拼字逻辑，目前吃 `result.segments`）。
**可复用的**：`composeNote()`（校勘记句）、校勘记 markdown 表格渲染、`buildXiandaiText()`、`buildQualityReport()`、flags.yaml 拼装、精校台 review.buildPayload()。

---

## 1. 现有 export.js 数据流图（输入 → 函数 → 输出，含 file:line）

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ exportAll(result, workId)                                  export.js:48       │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  输入：                                                                       │
│   • result.work                export.js:51  (work 元数据)                    │
│   • result.segments            export.js:73 (punctuate) / 225 (aligned.json) │
│       ← 每段含 segId / shanben.detail[].sb.ch / xiandai.raw / orphan          │
│       ← 来源：P2 align.js 对齐结果（吃 shanben-v2.json + 现代本）              │
│   • result.variants            export.js:91  (字级异文，来自 P4 diff)          │
│   • result.clusters            export.js:92  (夺衍换簇，来自 P4.5 cluster)     │
│   • result.verdicts            export.js:93  (校书官裁决)                      │
│   • result.verdictSummary      export.js:172                                  │
│   • result.summary             export.js:176                                  │
│   • result.cleaned.xiandai     export.js:66/72 (P1.5 清洗后的现代本正文流)      │
│   • result.cleaned.shanben.quality.blockers  export.js:68                     │
│                                                                               │
│   • loadWork(workId)           export.js:51  → { shanben, xiandai }           │
│   • loadM2Base(workId)         export.js:52  → { sha256 }（basefix-log 闸）   │
│   • loadVerifications(workId)  export.js:95  → P4.5 核验结果（cluster.js）     │
│   • privatePath(...,'punctuation-llm.json')  export.js:55（LLM 标点建议）      │
│   • privatePath(...,'full-review.json')      export.js:74                      │
│   • internalReadPath(...,'basefix-log.json') export.js:97                      │
│                                                                               │
│  核心拼字：                                                                   │
│   • buildShanbenPunctuated(result)                 punctuate.js:68             │
│       → 逐 seg：segShanbenText(seg) = seg.shanben.detail[].sb.ch 拼接         │
│       → 段末加 sentenceEnder(seg.xiandai.raw) 一个标点                        │
│       → 若有 LLM decisions，则 applyPunctuationMarks 覆盖                    │
│       → 输出 { text: "分段\n", segments, resolvedCount, orphanCount }         │
│   • buildXiandaiText(result.cleaned.xiandai)       punctuate.js:108           │
│       → 直接返回 ed.bodyText                                                  │
│                                                                               │
│  输出（write 调用）：                                                           │
│   公开 data/<work>/output/                                                   │
│     • 善本点校本.md           export.js:113   (header + sb.text)               │
│     • 校勘记.md               export.js:222   (五节 markdown 表格)             │
│     • punctuated.json         export.js:235   (schemaVersion:1)               │
│     • quality-report.json     export.js:244                                   │
│   公开 data/<work>/ (root)                                                   │
│     • 善本点校本-分栏.md       （由 review 或其他步骤生成，不在此）              │
│   私有 input_data/<work>/_derived/collation/                                 │
│     • output/现代本.md         export.js:127                                   │
│     • output/校书官工作记录.md  export.js:142                                   │
│     • output/精校台.html        export.js:251                                   │
│     • aligned.json             export.js:225                                   │
│     • diffs.json               export.js:230                                   │
│     • clusters.json            export.js:233                                   │
│     • verdicts.json            export.js:234                                   │
│     • flags.yaml               export.js:269                                   │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 善本点校本.md 怎么拼（关键代码路径）

**入口**：`exportAll()` → `export.js:103-113`
```js
const baselineSb = buildShanbenPunctuated(result);         // export.js:53
// ... 可选覆盖 LLM 标点 decisions                          export.js:55-65
sb.text                                                     // export.js:110
```

**拼字核心**：`punctuate.js:68-105` `buildShanbenPunctuated(result, options)`
- 遍历 `result.segments`（每段 = 现代本一句 + 对齐的善本字符集合）
- 跳过 `seg.orphan`（现代本独有，善本未对应）
- 取字：`segShanbenText(seg)` = `seg.shanben.detail.filter(d => d.sb).map(d => d.sb.ch).join('')` (punctuate.js:19-22)
  - **来源 = shanben.detail[].sb.ch**，这是 P2 align.js 从 `shanben-v2.json` 的 page-grid 投到 seg 上的字符
- 段末标点：`sentenceEnder(seg.xiandai.raw)` = 该段现代本 raw 里最后一个 `。！？；` (punctuate.js:13-16)
- 拼接：`txt + punct`（一行 = 一段善本连续字 + 一个现代本句末标点）
- LLM 标点覆盖（如 approved）：`applyPunctuationMarks(txt, decision.marks, {strict:true})` (punctuate.js:92-100)
- **resolved / 人工裁定**：原本计划内联夹注，但现版本**已改为只入校勘记**，正文不再附注（punctuate.js:88 注释："正文与流程性校记分层；裁定只进入校勘记，不再以内联'采某本'污染正文"）

**善本字实际来源链**：
```
shanben-v2.json (page-grid)
   ↓ P2 align.js（网格↔现代本句对齐）
result.segments[i].shanben.detail[j].sb.ch  (每个字符带 page/col/row)
   ↓ P5b buildShanbenPunctuated()
善本点校本.md 一行 = 一段内所有 sb.ch 拼接 + 段末标点
```

**resolved 如何反映到正文**：
- 当前实现：**resolved 不改字**。善本点校本一律保留底本字（`sb.ch`），resolved 只入校勘记。
- suspended：同样不改字，只入校勘记。
- 异体字（v1-v8...）：同样不改字，善本原样保留（旣/稟/閒/埽/彞/丗/頽），入校勘记"存古，不裁"。

→ **G5 影响**：G5 改数据源后，善本字从 `overlay.cells[page][col][row].ch` 取（经 labels 识别 j/z 角色），位置信息从 overlay.cells 的 grid 坐标直接来，不再依赖 align.js 的 seg.shanben.detail 投影。

---

## 3. 校勘记.md 格式（现有结构）

文件：`data/<work>/output/校勘记.md`（公开），由 `export.js:173-222` 拼装。

### 头部（export.js:173-179）
```
# <work.title> · 校勘记

> 字级异文 N 条（真异文 X / ocr疑 Y / 异体 Z）；夺衍换簇 M 个（真 a / 噪声 b / 底本已修 c 待修 d / 待核 e）。
> 校书官：resolved R，suspended S，人工裁定 H（engine: <vs.engine>）。
> 体例：每条带环节出处——发现于对校（P4），核验于 P4.5（引擎+置信），裁决于校书官（加权+悬置三规则）或人工（精校台）。
```

### 五节表格结构
| 节 | 列 | 数据源（行号） | 位置字段 |
|---|---|---|---|
| 一、真异文（字级·校书官裁决） | 编号 · 类型 · 善本 · 现代本 · **所在句(现代本)** · 裁决 · 采纳 · 理据/悬置原因 | `result.variants` 非异体 (export.js:145-151) | **`segTextOf(v)` = 现代本句片段，截 22 字**（不是 segId 也不是格坐标） |
| 二、夺衍换（簇级·P4.5 视觉核验） | 编号 · 类 · 善本 · 现代本 · 善页 · 今页 · 核验 · 裁决 · 采纳 | `result.clusters` (export.js:152-168) | **`c.sbPages.join('/')` / `c.xdPage` = 页号** |
| 三、异体（存古不裁） | 编号 · 善本 · 现代本 · 所在句(现代本) | `result.variants` type=异体 (export.js:169-170) | 现代本句截 30 字 |
| 四、善本底本修复记录 | 已回修：页/底本误作/善本实印/依据；待回修：同二 | `fixLog` (export.js:97-100, 202-204) / `fixRows` (162-167) | **`f.page` = 页号** |
| 附录A 已核验噪声 | 同二 | `noiseRows` (export.js:166) | 页号 |
| 附录B 定论体例 | 列表 `- <diffId> <composeNote(v)>` | `verdicts` resolved/human (export.js:218-220) | 无位置 |

### 单条结构（真异文为例）
```
| v23 | 真异文 | 至 | 止 | 言明明德、新民，皆當止於至善之地而不遷。 | resolved | 现代本 | 「至」，今本作「止」。機器初判從今本作「止」，待人工覆核。 |
```
- 编号 = `v.diffId`（如 v23）或 `c.id`（如 c1）
- **位置 = 所在句(现代本) 文本片段**，不是 segId、不是格坐标
- 理据由 `composeNote(v)`（export.js:33-46）按 type=夺/衍/换 + verdict=human/suspended/shanben/xiandai 组合四库体例句

### 关键发现
- 校勘记**完全没有格坐标**，位置只到"现代本所在句"或"善本页号"粒度
- 这意味着 G5 改 overlay 后，**校勘记格式可完全复用**——只需把变体的位置字段映射到 overlay 的 section/label 即可，表格渲染逻辑一行不用动

---

## 4. 现有输出样本印证

### 善本点校本.md（大学章句 output/ 前若干行，见上）
```markdown
# 大學章句 · 善本点校本

> 底本：当涂郡斋刊递修本（四书章句集注）（公开善本，A 级，可公开传播）。
> 句读由本系统点校；正文与校勘记分层，异文裁定见《校勘记》。经注分栏见 善本点校本-分栏.md。
> 文本状态：draft（3 个现代本句段未在善本对应；...）。

大學章句序大學之書古之大學所以教人之法也。
蓋自天降生民則旣莫不與之以仁義禮智之性。
...
```
- **无经注分栏**（"经注分栏见 善本点校本-分栏.md"）—— 正文纯平铺
- **无夹注**（resolved 不进正文）
- **一字不改**（旣/稟/閒/丗 等古字原样）
- 一段 = 一行，段末一个现代本句末标点

### 校勘记.md（大学章句 output/ 前若干行，见上）
```markdown
# 大學章句 · 校勘记
> 字级异文 98 条（真异文 29 / ocr疑 0 / 异体 69）；夺衍换簇 21 个（真 3 / 噪声 15 / 底本已修 12 待修 3 / 待核 0）。
...
## 一、真异文（字级 · 校书官裁决）
| 编号 | 类型 | 善本 | 现代本 | 所在句(现代本) | 裁决 | 采纳 | 理据/悬置原因 |
| v9 | 真异文 | 以 | 性 | 時則有若孔子之性下 | suspended | 暂拟现代本 | 首选得票 0.55 < τ0.55；... |
```

### works/daxue-songben/text.yaml 现状（目标格式）
- **实际目录**：`/root/lan_mu/works/daxue-songben/`（含 meta.yaml, text.yaml, ornaments.yaml, seals.yaml）
- **现状**：1 section (`jing`) / 134 blocks / ~6225 字（**缺序**，序在另一卷或尚未录入）
- **目标**（G5）：12 sections（xu/jing/zhuan1..zhuan10）/ ~6745 字（与 grid-overlay 的 6780 cells 吻合）
- **block 结构**：`{ type: j|z, text: <无标点连续字> }`
  - `j` = 经（大字单行）；`z` = 注/传（小字双行）
  - text 字段 = 无标点纯汉字串（与 overlay.labels[*].text 格式一致）

示例 block：
```yaml
- { type: j, text: 大學之道在明明德在親民在止於至善 }
- { type: z, text: 程子曰親當作新○大學者大人之學也明明之也... }
```

### grid-overlay.json 现状（大学章句，4492 行）
```
{
  base: { file: "grid-transcribe.json", sha256: "..." },
  stats: { pages: 35, cells: 6780, sections: 12, labels: { cols: 546, titles: 11 } },
  variants: { oldOcr: { sub: [...] }, modern: { sub: [...] } },
  labels: [ { page, col, role: "j"|"z", text: "..." }, ... ],       # 546 个
  sections: [ { id: "xu"|"jing"|"zhuan1"..., name, from: {page,col,row}, to: {...} }, ... ],  # 12 个
  fixes: []
}
```

---

## 5. G5 改数据源需要动的 export.js 函数清单

### 必须改写（吃 overlay 而非 segments/verdicts）

| 函数 | 现位置 | 现状 | 改为 |
|---|---|---|---|
| `buildShanbenPunctuated()` | `src/punctuate.js:68` | 吃 `result.segments[].shanben.detail[].sb.ch` | 吃 `overlay.labels[]`（按 sections 分节，按 labels 顺序拼字）；标点逻辑（sentenceEnder / applyPunctuationMarks）保留 |
| `segShanbenText()` | `src/punctuate.js:19-22` | `seg.shanben.detail[].sb.ch` join | 改为 `overlay.labels[].text` join（按 section 分组） |
| `exportAll()` 善本点校本 header | `export.js:103-112` | 引用 `shanben.title`/`shanben.level`（来自 loadWork） | 保留；`sb.text` 由新 punctuate 返回（按 section 分节？或保持平铺——看产品需求） |
| `exportAll()` 中间 aligned.json 写出 | `export.js:225-229` | 遍历 `result.segments` | 改为遍历 overlay.labels + sections（或直接废弃，因 overlay 已是真相源） |

### 可完全复用（不碰）

| 函数 / 逻辑 | 位置 | 理由 |
|---|---|---|
| `composeNote(v)` | `export.js:33-46` | 纯字符串拼装，不吃数据源 |
| 校勘记 markdown 表格渲染（charRows / clusterRows / yitiRows / fixRows / noiseRows） | `export.js:145-222` | 吃 `variants/clusters/verdicts`；只要这些字段还在 result 里就照旧。**G5 若把变体也搬进 overlay.fixes 或 overlay.variants，需改取数路径，但行渲染模板保留** |
| `buildXiandaiText()` | `punctuate.js:108` | 吃 `result.cleaned.xiandai.bodyText`，与善本数据源无关 |
| `buildQualityReport()` | `src/quality.js` | 待查，但大概率独立 |
| `review.buildPayload()` / `review.collectImages()` / `review.buildReviewApp()` | `src/review.js` | 精校台独立 |
| `flags.yaml` 拼装 | `export.js:258-269` | 吃 verdicts + variants，同上 |
| `loadWork()` / `loadM2Base()` / paths 模块 | `src/io.js` / `src/paths.js` | 不动 |

### 待确认（需看 result 对象在新 G5 下的形状）

1. **变体数据从哪来？** 旧：`result.variants`（P4 diff 产物）+ `result.clusters`（P4.5 簇）。新：是否从 overlay 派生？或保留独立 diff 阶段？这决定校勘记取数路径要不要改。
2. **verdicts 从哪来？** 校书官裁决仍需要输入（善本字 vs 现代本字 + 位置）。如果 overlay 取代 diff，verdicts 也得从 overlay 重建。
3. **`result.cleaned.xiandai` 是否保留？** 现代本出具吃 P1.5 清洗，与 overlay 无直接关系，应保留。
4. **`result.segments` 是否废弃？** 旧 P2 align 产物；overlay 本身就是对齐结果（labels + sections），可以取代 segments。
5. **punctuated.json 的 segments 字段**：`export.js:235-243` 写出 `sb.segments`。新 punctuate 需返回兼容格式（segId 改成 overlay label id 或 section:block 复合 id）。

---

## 6. G5 改造的最小切口建议

**Phase 1：punctuate.js 切到 overlay**
- 新增 `buildShanbenPunctuatedFromOverlay(overlay, options)`：
  - 按 `overlay.sections` 分节
  - 每节内按 `overlay.labels` 顺序拼 `label.text`
  - 标点仍走 sentenceEnder（需从某处取现代本句——可能从 works/text.yaml 的现代本对齐）或 LLM decisions
  - 返回兼容 `{ text, segments, resolvedCount, orphanCount, sourceHash }` 的形状
- 保留旧函数作回退（通过 feature flag 或 work.meta.layout 判断）

**Phase 2：exportAll() 入口切源**
- 读 `grid-overlay.json` 取代 `result.segments`（overlay 已是 truth）
- `result.variants/clusters/verdicts` 暂时保留（由旧 diff/cluster/verdict 阶段产出，后续再迁）
- 善本点校本.md 可按 sections 分节（加 `## <section.name>` 子标题），这是 G5 相对旧 P6 的格式升级

**Phase 3（后续）：变体/裁决也 overlay 化**
- 当 overlay.fixes 成为变体唯一来源，再改校勘记取数路径
- 此阶段 export.js 的表格渲染逻辑仍可复用

---

## 7. 关键 file:line 速查表

| 项 | 文件 | 行 |
|---|---|---|
| exportAll 入口 | `collation/src/export.js` | 48 |
| 读 result.segments | `collation/src/export.js` | 53 (punctuate 调用) / 225 (写出) |
| 读 result.variants | `collation/src/export.js` | 91 |
| 读 result.clusters | `collation/src/export.js` | 92 |
| 读 result.verdicts | `collation/src/export.js` | 93 |
| 写 善本点校本.md | `collation/src/export.js` | 113 |
| 写 校勘记.md | `collation/src/export.js` | 222 |
| 写 punctuated.json | `collation/src/export.js` | 235 |
| composeNote（校记句） | `collation/src/export.js` | 33-46 |
| charRows（字级异文表） | `collation/src/export.js` | 145-151 |
| clusterRows（簇级表） | `collation/src/export.js` | 152-168 |
| 善本拼字核心 | `collation/src/punctuate.js` | 68-105 |
| segShanbenText（取字） | `collation/src/punctuate.js` | 19-22 |
| sentenceEnder（取标点） | `collation/src/punctuate.js` | 13-16 |
| applyPunctuationMarks | `collation/src/punctuate.js` | 50-65 |
| 公私路径 | `collation/src/paths.js` | 10-35 |
| overlay 实例 | `collation/data/大学章句/grid-overlay.json` | 全 4492 行 |
| overlay sections (12) | `collation/data/大学章句/grid-overlay.json` | 4322-4491 |
| overlay labels (546) | `collation/data/大学章句/grid-overlay.json` | 1044-4321 |
| text.yaml 目标格式 | `works/daxue-songben/text.yaml` | 全 139 行 |

