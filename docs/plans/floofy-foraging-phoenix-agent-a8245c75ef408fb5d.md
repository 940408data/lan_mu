# M6 入库脚本现状摸底 — G5 单一出口合并依据

## 一、三脚本职责对比表

| 维度 | build-songke.js | build-songke-transcribe.js | build-works.js |
|---|---|---|---|
| **角色** | M3 收尾：列级 grid.json → 善本点校本 markdown 预览 | 路线 B 版：逐格 grid-transcribe → 善本点校本 markdown 预览 | **M6 入库**：版面判定 → works/<id>/ 四件套 |
| **输入文件** | `data/<work>/grid.json` + `layout.json`（textPages）+ `verdicts.json`（加载但未用） | `data/<work>/grid-transcribe.json` + `layout.json` | 路线 A：`grid.json`；路线 B：`grid-transcribe.json`（通过 `--from=transcribe`）；额外读 `layout.json`、`works/<base>/meta.yaml`、`seals.yaml`、`ornaments.yaml` |
| **输出** | `data/<work>/output/善本点校本-分栏.md`（markdown 预览） | `data/<work>/output/善本点校本-分栏-逐格.md` | `works/<newId>/{text.yaml, meta.yaml, seals.yaml, ornaments.yaml}` 四件套 |
| **blocks 聚合** | 同 build-works 路线 A 的合并逻辑，但多了 `page` 字段 | 调 `colsOfPage(pg)` 聚合逐格为列后合并 | 同 build-songke.js 的列级合并（路线 A 直读 grid.json；路线 B 由 `transcribeToGrid()` 把 grid-transcribe 转成 grid.json 形状后再走同一条路） |
| **sections 切分** | **不切 sections**——全卷一维 blocks 数组 | 不切 | **切 sections**：大学/中庸按「右傳之X章 / 右經一章 / 右第X章」正则锚点切；序卷用 `--section-name/--section-id` 强制单节 |
| **j/z 判定** | 直接读 `col.type`（grid.json 已由 judge-grid 标好） | `colsOfPage()`：`start === '顶格' → j`，否则 → z | 同 build-songke（路线 A）或 `transcribeToGrid()` 后再走同路（路线 B） |
| **额外产物** | 无 | 无 | `expect: { chars, jChars, zChars }` 字数统计（`countTokens` 去句读括号按 code point 计）；`meta.yaml`（以 `<base>/meta.yaml` 模板改 id/title/book/expect） |
| **校验** | `grid.base.sha256 === m2.sha256` | 无 sha 校验（潜在漏洞） | 两路都校 sha；且 `m2.pendingCount === 0`（禁止带待覆校底本入库） |

## 二、各脚本生成 blocks/sections 的关键代码路径

### build-songke.js（路线 A，列级）
- L22：读 `data/<work>/grid.json`
- L24：读 `layout.json` 取 `textPages` 作为正文页域
- L37–46：**主循环** — 逐页逐列，`last.type === col.type` 合并，否则新建 block（保留 `page: pg.n`）
- L55–58：每 block 渲染 `**【經】**`/`**【注】**` 行
- L59–61：写 `data/<work>/output/善本点校本-分栏.md`

### build-songke-transcribe.js（路线 B，逐格）
- L20：读 `data/<work>/grid-transcribe.json`
- L23：`require('../src/transcribe').colsOfPage`
- L33–41：**主循环** — 和 build-songke.js L37–46 **几乎逐字相同**，唯一差别：`for (const c of colsOfPage(pg))` 替代 `for (const col of pg.cols)`
- L53–55：写 `data/<work>/output/善本点校本-分栏-逐格.md`

### build-works.js（M6 入库，路线 A/B 双支持）
- L30：`loadM2Base(workId)` 取 sha 基准
- L34–50：**路线分叉**
  - `flags.from === 'transcribe'`（路线 B）→ 读 `grid-transcribe.json`，调 `transcribeToGrid(tr)` 转成 grid 形状
  - 否则（路线 A）→ 直读 `grid.json`
  - 两路都校 `grid.base.sha256 === m2.sha256`
- L56–66：页域选择（layout.textPages 默认；`--pages=a-b`/`--pages=2,5` 覆盖）
- L68–79：**列→block 聚合**（核心循环，与 build-songke.js L37–46 **完全等价**）
- L81–107：**章节切分**（独有）
  - 中庸模式：正则 `/右第([一二三四五六七八九十百]+)章/` → 切出 `zhangN` 节
  - 大学模式：正则 `/右(傳之[首一二三四五六七八九十]+章|經一章)/` → 切出 `zhuanN` 节
  - 单节卷（序）：`--section-name` + `--section-id` 重命名
- L109–115：`countTokens` 统计 jChars/zChars（去句读按 Unicode code point 计）
- L117–122：写 `text.yaml`（内联字符串拼接，非 yaml.stringify）
- L124–135：生成 `meta.yaml`（以 base 作品为模板）
- L137–145：写四件套，seals/ornaments 直接从 base 复制

### collation/src/transcribe.js（共享库）
- L10–27：`colsOfPage(page)` — 逐格按 `col` 分组、`row` 升序，text=char 拼接，start 优先取显式 `c.start`、否则按 `row===1 → '顶格'` / `row===2 → '退一格'` / 否则 `'退两格'`，type = 顶格→j 否则→z
- L34–40：`transcribeToGrid(tr)` — 把 grid-transcribe 转成 grid.json 形状，使 build-works 可无差别消费

## 三、路线 A vs 路线 B 实际代码差异

| 位置 | 路线 A（列级 grid.json） | 路线 B（逐格 grid-transcribe） |
|---|---|---|
| 数据源 | `grid.json`（judge-grid.js 产出，列级，qwen3.7-plus 视觉判 type） | `grid-transcribe.json`（grid-transcribe.js 产出，逐格，qwen3.8-max 标 col/row/char/start） |
| build-works.js L36–50 | 直接 `JSON.parse` grid.json | `transcribeToGrid(tr)` 先聚合为列再喂入 |
| build-songke.js | `for (const col of pg.cols)` | —（无 B 版） |
| build-songke-transcribe.js | — | `for (const c of colsOfPage(pg))`（等价于路线 A 的 `pg.cols`） |
| **下游消费完全一致** | blocks 聚合、sections 切、type 判断全部走同一条路径 | 同上 |

**关键洞察**：`transcribeToGrid()` 已经把路线 B 抹平成路线 A 的形状。两路在 build-works.js 内**唯一**分叉点是 L36–50 的 14 行；下游 68–146 行**完全复用**。这是 G5 单一出口的现成骨架。

## 四、works/ 下 songke 类作品实际目录与 text.yaml 现状

**已入库 songben 作品**：
- `works/daxue-songben/` → `text.yaml`（大学章句，sections 含 經一章 + 傳之首章…傳之十章）
- `works/zhongyong-songben/` → `text.yaml`（中庸章句，sections 含 首章 + 第一章…第三十三章）
- `works/zhongyongxu-songben/` → `text.yaml`（中庸章句序，**单节** id=xu，name=中庸章句序）

**每目录四件套**：`{text.yaml, meta.yaml, seals.yaml, ornaments.yaml}`

**text.yaml 格式**（取样 daxue-songben）：
```yaml
# 大学章句（当涂郡斋刊递修本·善本底）：j 为经传大字，z 为章句小字。版面结构先行：顶格经/退格注。
sections:
  - id: jing
    name: 經一章
    blocks:
      - { type: j, text: 方則未必無小補云淳熙己酉二月甲子新安朱熹序大學朱熹章句 }
      - { type: z, text: 大舊音泰今讀如字子程子曰大學孔氏之遺書… }
      - { type: j, text: 大學之道在明明德在親民在止於至善 }
      ...
  - id: zhuan1
    name: 傳之首章
    blocks: ...
```

**注意**：text 字段是**连续字符串**，不分段不分句。j 与 z 严格按列顺序交替。

## 五、G5 单一出口应复用的已有函数

| 函数/逻辑 | 当前所在 | G5 复用建议 |
|---|---|---|
| `colsOfPage(page)` | `collation/src/transcribe.js:10` | **保留并提升为单源**：G5 入库统一走逐格，由它聚合为列 |
| `transcribeToGrid(tr)` | `collation/src/transcribe.js:34` | **淘汰**（G5 不再需要抹平路线 B，因为只剩一路）；或直接让出口消费 `colsOfPage` 输出 |
| 列→block 合并循环 | `build-works.js:68-79` ≡ `build-songke.js:37-46` | **抽成纯函数** `mergeColsToBlocks(pages, inPage)`，返回 `blocks[]` |
| sections 切分（大学/中庸正则） | `build-works.js:81-107` | **抽成纯函数** `splitSectionsByAnchor(blocks, mode)`，正则 `/右第X章/` 与 `/右傳之X章|經一章/` 作为可配置锚点表 |
| `countTokens(text)` | `build-works.js:112-113` | **抽到共享模块**，meta.yaml 与质量校验都需复用 |
| 页域选择（layout.textPages + --pages） | `build-works.js:56-66` | **抽成纯函数** `makePageFilter(layout, flags)` |
| meta.yaml 模板化 | `build-works.js:124-135` | **保留为出口私有**（入库才需 meta） |
| sha256 + pendingCount 校验 | `build-works.js:41-51` | **提升到入口前置条件**，G5 单一出口强制校验 |

## 六、G5 单一出口设计要点（路线 A/B 消失后）

1. **唯一输入源**：`grid-transcribe.json`（基础层） + overlay（labels/sections，未来扩展） + fixes（覆校后）
   - 不再读 `grid.json` —— 它本身就是 `transcribeToGrid()` 的产物，G5 下是中间派生
2. **单一流水线**：
   ```
   grid-transcribe.json
     └─ colsOfPage() 聚合为列
     └─ mergeColsToBlocks()（现有 L68-79）
     └─ applyOverlay()（新：从 overlay 注入 labels/sections 切分点，替代硬编码正则）
     └─ applyFixes()（新：人工 fixes 覆盖个别 block 文本）
     └─ splitSections()（现有 L81-107 通用化，锚点表可配置）
     └─ 输出 text.yaml + meta.yaml
   ```
3. **消除重复**：`build-songke.js` 与 `build-songke-transcribe.js` 的 markdown 预览可从同一 intermediate IR 渲染（`blocks[]` 已是 IR），不再各自扫一遍
4. **待迁移**：
   - `build-songke.js` 的 `verdicts.json` 异文夹注支持（当前加载但未用）——G5 出口需决定是否纳入
   - `build-songke-transcribe.js` 的 sha 校验缺失——G5 出口统一补上

## 七、迁移步骤建议

1. 新建 `collation/src/songke-pipeline.js`，把上表纯函数搬入
2. 改造 `build-works.js` 调用新模块，删除 L36–50 路线分叉，固定走 grid-transcribe
3. 把 `build-songke.js` 与 `build-songke-transcribe.js` 改为同一 IR 的两种渲染（md 预览），或直接弃用（让 `build-works.js --preview` 兼做）
4. 迁移现有 daxue/zhongyong/zhongyongxu-songben 三份 text.yaml 做回归比对（字节级一致即可）
