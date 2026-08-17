# G5 数据模型探索：网格基础层 + overlay → works/text.yaml · 善本点校本 · 校勘记

## TL;DR（G5 消费端直接可用的数据模型）

基础层 `grid-transcribe.json` 是**视觉逐格**（cell = 一个书页上的一个汉字位），overlay `grid-overlay.json` 是**参校+标签+sections+fixes 的旁挂层**。G5 派生「连续文本 / songke blocks / 校勘记」所需的最小消费模型：

```
for section in overlay.sections:            # 12 节（大学：xu + jing + zhuan1..10）
  for each cell in section.from .. section.to (按 col 升、列内 row 升):
    role = labelMap[page][col]              # 'j' | 'z' | 'title'
    char = applyFixes(cell, overlay.fixes)  # kind:'sub' 替换；kind:'insert' 补入
    if role == 'title': 跳过或并入上一 j block
    else: 按 role 归入 j 大字块 / z 小字块（连续同 role 合并）
```

---

## 1. 基础层 grid-transcribe.json

### Schema
```jsonc
{
  "work": "大学章句",
  "base": { "file": "shanben-v2.json", "sha256": "…", "pendingVerify": 0 },
  "layout": { "cols": 16, "rows": 15 },     // 全书最大网格（右起 16 列 × 15 行）
  "pages": [
    {
      "n": 2,                              // 叶码（= 底本 shanben-v2 页号）
      "engine": "覆校(qwen3.8-max)",        // 视觉 OCR 引擎（G1 产物）
      "conf": null,                          // 引擎置信度（目前未用）
      "cells": [
        { "col": 1, "row": 1, "char": "大", "start": "頂格" },
        { "col": 1, "row": 2, "char": "學" },
        { "col": 1, "row": 3, "char": "章" },
        // ... row 4..15 同列
        { "col": 2, "row": 1, "char": "大", "start": "頂格" },
        // ...
      ]
    }
  ]
}
```

### 字段细节
| 字段 | 类型 | 说明 |
|---|---|---|
| `pages[].n` | number | 叶码（与 shanben-v2.pages[].n 对齐） |
| `pages[].cells[].col` | number | 列号（右起 1..16） |
| `pages[].cells[].row` | number | 行号（上起 1..15） |
| `pages[].cells[].char` | string | 视觉识别字（单字；空字符串=空格） |
| `pages[].cells[].start` | string? | 仅列首字有；取值 `"頂格"` / `"退一格"` / `"退两格"`（继承式：列内其余字无此字段） |

### ○ 符号格处理
- ○ 等符号格（○/〇/①-⑩/标点）**保留在 cells 数组**中（坐标不断裂）
- **不进对齐用的 gridStr**：`src/grid.js:56-74` 的 `loadBaseGrid` + `stripCh` 过滤
- `STRIP` 正则（`src/grid.js:23`）定义完整过滤集：`[，。！？…○〇①-⑩·—…\s？！↑↓]`
- G5 派生连续文本时，○ 应作为**分隔符/段落标记**保留在 z 小字文本中（见 works/daxue/text.yaml 第 11 行 `○大學者…`），**不进 j 大字**

### 样本（大学 p2）
120 cells = 8 cols × 15 rows；col 1 为「大學章句序」（序首列），col 2-8 为序正文，全顶格 → 全 j。

---

## 2. overlay grid-overlay.json 完整 Schema

```jsonc
{
  "schemaVersion": 1,
  "work": "大学章句",
  "base": {
    "file": "grid-transcribe.json",
    "sha256": "af85ff6a…"      // 基础层指纹；fixes 合入时会校验
  },
  "stats": { /* 见下 */ },
  "variants": { "oldOcr": {…}, "modern": {…} },   // G2 参校差异
  "labels": [ { "page", "col", "role", "text" } ], // G3 列级角色
  "sections": [ { "id", "name", "from", "to" } ],  // G3 章节边界
  "fixes": []                                        // G4 裁决产物（目前恒空）
}
```

### 2.1 stats（信息性汇总，消费端可不读）
```json
{
  "pages": 35, "cells": 6780,
  "oldOcr":   { "agree": 6719, "sub": 18, "missing": 5, "extra": 8 },
  "modern":   { "agree": 6668, "sub": 36, "missing": 8, "extra": 41,
                "anchors": { "hard": 11, "soft": 44, "kept": 54, "segs": 55 },
                "unanchoredSegs": 0 },
  "labels":   { "cols": 546, "titles": 11 },
  "sections": 12
}
```

### 2.2 variants.oldOcr（G2a 旧 OCR 逐格对比；页级对齐）
```ts
{
  agree: number,
  sub: [{                         // 异字（格字 vs 旧 OCR）
    page, col, row,               // 格坐标
    grid: "宮",                   // 基础层格字
    old: "宫",                    // 旧 OCR 字
    ctxSb: "…王【宮】國都…",     // 善本上下文（±10 字，归一化后）
    ctxOld: "…王【宫】國都…"     // 旧 OCR 上下文
  }],
  missing: [{                     // 旧 OCR 缺（ins in old→grid 视角 = del）
    page,
    after: { col, row } | null,   // 插入位置前一字坐标；整页缺时 null
    text: "朱熹章句",             // 缺失文本
    whole?: true                  // 整页缺失标记
  }],
  extra: [{                       // 格有旧 OCR 无（del in old→grid 视角 = ins）
    page, col, row, grid: "日"
  }]
}
```

### 2.3 variants.modern（G2b 现代点校本全书流对比）
```ts
{
  agree, preclean: { latex, heading-first-kept, running-head, collation-note, page-number, colophon, inline-note },
  anchors: { hard, soft, kept, segs },
  unanchoredSegs,
  sub: [{ page, col, row, grid, modern, ctxSb, ctxXd }],   // ctxXd = 现代本上下文
  missing: [{ page, after, text }],                         // 现代本有、格无（夺文候选）
  extra: [{ page, col, row, grid }]                         // 格有、现代本无
}
```

**关键差异**：oldOcr.sub 用 `old` + `ctxOld`；modern.sub 用 `modern` + `ctxXd`（儒藏本）。G5 校勘记需分两源呈现。

### 2.4 labels[]（G3 列级角色；每列一条）
```ts
{ page: 2, col: 1, role: 'j',     text: "大學章句序" }
{ page: 6, col: 10, role: 'z',    text: "大舊音泰今讀如字" }
{ page: 10, col: 9, role: 'title', text: "右經一章蓋孔子之言而曾子述" }
```

| role | 含义 | 派生规则 | 函数位置 |
|---|---|---|---|
| `j` | 经传大字 | start="頂格"（或继承：列首字 row=1 → 顶格） | `src/transcribe.js:10-27 colsOfPage` |
| `z` | 章句小字（注） | start="退一格"/"退两格"（或 row=2 起） | 同上 |
| `title` | 章题列（覆盖 j/z） | 章题锚（`右經一章` / `右傳之X章` / `右第X章`）坐标所覆盖的列 | `src/grid.js:250-277 labelGrid` |

**实际取值只有 j/z/title 三种**（大学 546 列 = 228 j + 307 z + 11 title；中庸 1181 列 = 463 j + 677 z + 41 title）。代码注释里提到 `preface/running-head/footnote/colophon/skip` 是**设计预留**，当前未实现（页眉/校记等在 `precleanModern` 里作为 modern.preclean.excluded[] 留痕，但不入 labels）。

**j/z 判定细节**（`src/transcribe.js:10-27`）：
- 按 col 分组 → 列内按 row 排序 → `text = cells.map(c => c.char).join('')`
- `start` = 列内首个带 start 字段的 cell 的 start；若全无则按 row 推（row=1→顶格，row=2→退一格，否则→退两格）
- `type = (start === '顶格' || start === '頂格') ? 'j' : 'z'`

**title 覆盖规则**（`src/grid.js:267-277`）：
- 章题锚在 `gridStr`（过滤后的纯字串）中 matchAll `CHAPTER_RE`
- 从 `cellOf(m.index)` 到 `cellOf(m.index + m[0].length - 1)` 跨页覆盖
- 被覆盖的列原 role（j/z）全部改写为 `title`

### 2.5 sections[]（G3 章节边界；锚点收束式）
```ts
{
  id: 'jing' | 'zhuan1..10' | 'zhang1..33' | 'xu',
  name: '經一章' | '傳之首章' | '首章' | '序',
  from: { page, col, row },   // 节首字坐标（格级）
  to:   { page, col, row }    // 节末字坐标
}
```

**大学样本（12 节）**：
| id | name | from | to |
|---|---|---|---|
| xu | 序 | p2c1r1 | p6c2r6 |
| jing | 經一章 | p6c9r1 | p10c9r6 |
| zhuan1 | 傳之首章 | p10c9r7 | p11c14r7 |
| zhuan2..10 | … | … | … |
| zhuan10 | 傳之十章 | p26c12r8 | p36c16r7 |

**边界算法**（`src/grid.js:278-313`）：
1. 检测 `右第.+章` → 中庸模式（zhang1..33）；否则大学模式（jing + zhuan1..10）
2. 序尾锚 `淳熙[己已]酉…新安朱熹序`（`PREFACE_END_RE`）收束 `xu` 节
3. 序尾锚后开 `jing`（大学）/ `zhang1`（中庸）
4. 每个章题锚（除最后一个）**收束其前正文**，新节名 = **下一锚章名去「右」**（例：`右傳之二章` 收束 `zhuan1` 正文，新开 `zhuan2:傳之二章`）
5. 尾锚不开节，尾节至 `gridStr.length - 1`

### 2.6 fixes[]（G4 裁决产物；当前恒空）

由 `tools/grid-review-merge.js` 写入，是唯一改字通道。**两种 kind**：

#### kind:'sub'（单字改字）
```ts
{
  kind: 'sub',
  page: 14, col: 16, row: 10,
  from: '鐋',                      // 基础层原字
  to: '錫',                        // 裁决选定字（oldOcr/modern/custom）
  evidence: "oldOcr=∅; modern=錫; human=modern; note=…",
  decidedAt: "2025-…"
}
```
- 幂等：`(page,col,row)` 为键覆盖旧条目（`grid-review-merge.js:36,51`）
- choice='keep-grid' → 删除该坐标的 fix；choice='defer' → 不入 fixes

#### kind:'insert'（补夺文）
```ts
{
  kind: 'insert',
  page: 6,
  after: { col: 10, row: 10 },     // 插入位置的前一字坐标
  text: "朱熹章句",                 // 补入文本（可多字）
  evidence: "src=modern; human=insert; note=…",
  decidedAt: "2025-…"
}
```

---

## 3. 关键函数路径（G5 消费时直接调用/参考）

| 函数 | 位置 | 用途 |
|---|---|---|
| `loadBaseGrid(tr)` | `src/grid.js:58-75` | 基础层 → flat 格序列 + gridStr + strIdx 索引；○ 等符号格不进 gridStr 但保留 flat |
| `colsOfPage(page)` | `src/transcribe.js:10-27` | 逐格 → 列级聚合（j/z 判定单一事实源） |
| `transcribeToGrid(tr)` | `src/transcribe.js:34-40` | 基础层 → grid.json 形状（pages[].cols[]） |
| `labelGrid(base, modernAligned)` | `src/grid.js:251-315` | labels + sections 派生（含章题锚 → title 覆盖 + 收束式 section 切分） |
| `buildOverlay(workId, opts)` | `src/grid.js:318-390` | 主入口：产出 overlay 完整 JSON |
| `editOps(a, b)` | `src/grid.js:32-51` | Wagner-Fischer 编辑距离 → ops（供 G2a/G2b） |
| `precleanModern(lines, ctx)` | `src/grid.js:133-174` | 现代本预清洗（LaTeX/页眉/校记/页码 → excluded[]） |
| `alignOldOcr(base, v2)` | `src/grid.js:78-130` | G2a 页级编辑对齐 |
| `alignModern(base, modernRaw, ctx)` | `src/grid.js:177-248` | G2b 全书流锚定分段 + 对齐 |
| merge 入口 | `tools/grid-review-merge.js:38-64` | decisions + runs → fixes（唯一写 fixes 的脚本） |
| 现有 blocks 派生 | `tools/build-works.js:68-79` | 列级连续同 type 合并为 blocks（G5 应改用 overlay.labels + section.from/to 精确定界） |
| 现有 sections 派生 | `tools/build-works.js:82-107` | 文本 match 切节（G5 应直接消费 overlay.sections） |

---

## 4. G5 派生算法（消费端伪码）

### 4.1 连续文本 + songke blocks（按 sections 顺序、col/row 竖排）

```js
const tr = load('grid-transcribe.json');
const ov = load('grid-overlay.json');

// 1) 建索引
const fixMap = new Map();                          // "p:c:r" -> fix
const insertAfter = new Map();                     // "p:c:r" -> inserted text
for (const f of ov.fixes) {
  if (f.kind === 'sub')    fixMap.set(`${f.page}:${f.col}:${f.row}`, f.to);
  if (f.kind === 'insert') insertAfter.set(`${f.page}:${f.after.col}:${f.after.row}`, f.text);
}
const labelMap = new Map();                        // "p:c" -> role
for (const l of ov.labels) labelMap.set(`${l.page}:${l.col}`, l.role);

// 2) 按 section 顺序派生 blocks
for (const sec of ov.sections) {
  const cells = cellsInRange(tr, sec.from, sec.to);   // 按 col 升、列内 row 升
  const blocks = [];
  let cur = null;
  for (const c of cells) {
    const role = labelMap.get(`${c.page}:${c.col}`);  // 'j' | 'z' | 'title'
    if (role === 'title') continue;                    // 章题列不入 blocks（或另存 sec.heading）
    // 应用 fixes：○ 符号保留在 z（作为段落分隔）；sub 替换
    let ch = fixMap.get(`${c.page}:${c.col}:${c.row}`) ?? c.char;
    if (!ch || ch === '○') {
      // ○ 在 j 中跳过；在 z 中保留为分隔符
      if (role === 'j') continue;
    }
    // insert fix：在 c 之后追加（夺文）
    const inserted = insertAfter.get(`${c.page}:${c.col}:${c.row}`) || '';
    const text = ch + inserted;
    if (!cur || cur.type !== role) { cur = { type: role, text: '' }; blocks.push(cur); }
    cur.text += text;
  }
  yield { ...sec, blocks };
}
```

### 4.2 善本点校本.md

- 按 section 顺序
- j block → 经传正文（大字；段首缩进 2 字符）
- z block → 章句小字（双行夹注格式；或现代 markdown 用 `> ` 引用块）
- ○ 保留为段落分隔标记
- fixes 应用后文本（不显式标注校改，校勘记另出）

### 4.3 校勘记

- 来源 1：`variants.oldOcr.sub` + `variants.modern.sub` → 异字校
- 来源 2：`fixes[]` → 裁决改字校（`kind:'sub'` 显式标注 from→to + evidence）
- 来源 3：`variants.*.missing` + `fixes[kind='insert']` → 夺文补入校
- 按 section 定界（校勘记章节与 text.yaml sections 对齐）

---

## 5. 印证样本（大学章句 p2-p6 序 + p6 经首）

**p2 cells（序首列）**：120 cells；col 1 row 1-5 = `大學章句序`（start=頂格 → label j）；col 1 row 6-15 空；col 2-8 全部 start=頂格 → j。

**label 样本**：`{ page:2, col:1, role:'j', text:'大學章句序' }` —— text = 列内非空 char 连接。

**section 样本**：`xu: 序` from `{page:2,col:1,row:1}` to `{page:6,col:2,row:6}` —— 收束于序尾锚 `淳熙己酉…新安朱熹序`（在 gridStr 中的位置映射回格坐标）。

**○ 样本**：p7 c1 r9 char='○'（start 继承列首）；在 z 列中保留为段落分隔。

**fixes 样本**：当前大学/中庸两书 `fixes: []`（G4 精校台尚未跑过裁决）。

---

## 6. G5 缺口清单（实施要点）

1. **无脚本消费 fixes** —— 现有 `build-works.js` 走 `grid.json` 或 `transcribeToGrid(tr)`，只看 labels（j/z）和文本 match 切节；**完全忽略 overlay.fixes**。G5 新脚本需：
   - 加载 overlay（不是 grid.json）
   - 用 `overlay.sections` 替代文本 match 切节（更精确；边界是格坐标而非文本锚）
   - 用 `overlay.labels` 替代 `colsOfPage` 输出（已含 title 覆盖）
   - 应用 `overlay.fixes` 替换/补入字符
2. **songke blocks 派生需处理 title 列** —— 章题列（role='title'）不入 j/z blocks，但可作为 section.heading 元数据
3. **○ 在连续文本中的取舍** —— 保留在 z（段落分隔）；j 中跳过（现有 works/daxue/text.yaml 已采用此策略）
4. **跨 section 边界的 col** —— section.from/to 是格坐标；需正确切片（不能按整列吞）
5. **校勘记需同时呈现三源**（variants.oldOcr / variants.modern / fixes），按 section 归并
