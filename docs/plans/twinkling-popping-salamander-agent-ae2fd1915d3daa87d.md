# 兰木工具链调查：「中庸章句」→「大学章句」可复用流程

背景：把「中庸章句」已走通的"扫描 → 逐格转写 → 覆校 → 善本点校分栏 md → songke 卷入库 → expect 基准同步"流程搬到「大学章句」。Medium 广度只读调查。

---

## 一、核心结论速览

**整个流程分两大阶段**，分别对应两条独立的数据管道：

1. **M2 底本管道**（善本干净底本 shanben-v2.json）：`recollate.js → build-v2.js → verify-v2.js`
2. **M3 版面判定管道**（经注分栏 + 入引擎）：两条并行路线择一
   - **路线 A（旧）**：`judge-grid.js`（列级判经注）→ `build-songke.js` → `build-works.js`
   - **路线 B（新·中庸推荐）**：`grid-transcribe.js`（逐格转写）→ `build-songke-transcribe.js` → `build-works.js`
3. **P 管道**（对校）：`run.js --step=all` = align → diff → verify → officer → export

**没有真正的"一键全流程"脚本**，只有：
- `collation/tools/pipeline.js`：从 M2 完成之后跑完"M3 + P 全链"（**不包含 M0/M2**）
- `collation/run.js --step=all`：只跑 P 阶段（从 M3 完成后开始）

**断点续跑全部基于 sha256 门控**：输出文件顶层带 `base.sha256`，与当前 M2 底本哈希比对，不一致即清空重跑；页号 `done` 集合里已存在的页自动跳过。

**按页并行完全可行**：页与页独立，无跨页依赖。所有带 `--pages=` 的工具都支持切段并行。

---

## 二、完整工具链流程表

| 步骤 | 脚本 | 命令样例 | 输入 → 输出 | 可按页并行 |
|---|---|---|---|---|
| **M0 版面抽样** | `collation/tools/layout-probe.js` | `node collation/tools/layout-probe.js 大学章句 --pages=8,30,50` | 善本 PDF 抽样页 → `data/<书>/layout.json`（网格 cols×rows、顶/退格规则、textPages） | ✅ 多页同时 probe（`--conc`），但通常 3 页就够 |
| **M2-1 视觉重 OCR + 互证** | `collation/tools/recollate.js` | `node collation/tools/recollate.js 大学章句 --pages=1-40 --conc=3` | 善本 PDF + 旧 OCR → `data/<书>/recollate-1-40.json`（每页一致率+diffs） | ✅ 强烈建议切段（已切出 `recollate-1-40.json`、`recollate-8-9.json` 等先例） |
| **M2-2 仲裁出干净底本** | `collation/tools/build-v2.js` | `node collation/tools/build-v2.js 大学章句 --in=recollate-1-40.json` | recollate-*.json → `shanben-v2.json` + `pending-verify.json` | ❌ 单文件批处理，不能按页拆 |
| **M2-3 覆校真疑难** | `collation/tools/verify-v2.js` | `node collation/tools/verify-v2.js 大学章句 --conc=3 [--start-page=N --page-count=N]` | pending-verify.json + 善本 PDF → 直改 `shanben-v2.json` + `verify-report.json` | ✅ 可 `--start-page/--page-count` 切段；也支持 `--limit` |
| **M3-A 列级经注判定**（路线 A） | `collation/tools/judge-grid.js` | `node collation/tools/judge-grid.js 大学章句 --pages=7-76 --conc=3` | layout.json + 善本 PDF → `grid.json`（页×列×{col,type:j/z,start,text}） | ✅ 完全按页独立 |
| **M3-A 核验** | `collation/tools/verify-jz.js` | `node collation/tools/verify-jz.js daxue-songben --jz=collation/data/大学章句/grid.json` | works/<id>/text.yaml + grid.json → `jz.json`（量化判定准确率） | ❌ 单次评估 |
| **M3-A 出分栏 md** | `collation/tools/build-songke.js` | `node collation/tools/build-songke.js 大学章句` | grid.json + shanben-v2.json → `output/善本点校本-分栏.md` | ❌ 一次全成 |
| **M3-B 逐格转写**（路线 B·推荐） | `collation/tools/grid-transcribe.js` | `node collation/tools/grid-transcribe.js 大学章句 --pages=7-76 --conc=3 [--force-deep] [--model=X --endpoint=Y] [--suffix=gpt5]` | layout.json + 善本 PDF → `grid-transcribe.json`（页×格×{col,row,char,start}）+ `grid-transcribe-log.json` | ✅ 完全按页独立（最佳切分点） |
| **M3-B 逐格→分栏 md** | `collation/tools/build-songke-transcribe.js`（commit 39cae62） | `node collation/tools/build-songke-transcribe.js 大学章句 [--pages=2,9]` | grid-transcribe.json → `output/善本点校本-分栏-逐格.md` | ❌ 一次全成（但内部可按 `--pages=` 过滤输出段） |
| **M6 进引擎** | `collation/tools/build-works.js` | `node collation/tools/build-works.js 大学章句 daxue-songben --base=daxue [--from=transcribe]` | grid.json（或 `--from=transcribe` 时读 grid-transcribe.json 逐格聚合）→ `works/<新id>/{text.yaml, meta.yaml, seals.yaml, ornaments.yaml}`，meta.yaml 里 `expect: {chars, jChars, zChars}` 按版面实算写入；另支持 `--pages=a-b`（序卷等非正文卷）、`--section-name/--section-id`、`--subtitle`、`--book/--book-title` | ❌ 单次生成 |
| **P1.5 清洗** | `collation/tools/clean.js --write` | `node collation/tools/clean.js 大学章句 --write` | shanben-v2.json → 清洗后版本 | ❌ 全文件 |
| **P3-P6 对校全链** | `collation/run.js --step=all` | `node collation/run.js 大学章句 --step=all` | shanben-v2.json + 现代本 → `output/善本点校本.md` + `output/校勘记.md` + 精校台.html | ❌ 主流程串行 |
| **质量报告** | `collation/tools/quality-report.js` | `node collation/tools/quality-report.js 大学章句 [--write]` | align(workId) → 控制台 JSON / `works/<id>/quality-report.json` | ❌ 单次 |
| **覆校意见跨工作树合并** | `collation/tools/merge-verify-report.js` | `node collation/tools/merge-verify-report.js 大学章句 --report=... --pending=...` | 另一分支的 verify-report + pending-verify → 合并到当前工作树（不改 shanben-v2，由本分支 build-v2 重新仲裁） | ❌ 合并操作 |
| **P4.5 善本底本误回修** | `collation/tools/apply-basefix.js` | `node collation/tools/apply-basefix.js 大学章句 [--dry]` | clusters-verify.json 中"善本底本误"簇 → 直改 shanben-v2 + basefix-log.json；之后需重跑 diff/verify/officer/export | ❌ 回修后触发链式重跑 |
| **后处理流水线** | `collation/tools/pipeline.js` | `node collation/tools/pipeline.js 大学章句 --pages=7-76 --conc=3` | 从 M2 完成态出发，依次跑 clean → judge-grid → build-songke → run.js --step=all | ❌ 编排脚本，内部各步可重入 |

---

## 三、grid-transcribe-log.json 顶层字段语义

```json
{
  "work": "中庸章句",
  "model": null,                  // 顶层 model=null 表示没强制模型（走自动路由）
  "endpoint": null,               // 顶层 endpoint=null 用 vision.yaml 默认
  "base": {
    "file": "shanben-v2.json",
    "sha256": "0ad7...",          // ⭐ M2 底本哈希。是"断点续跑"的门控键
    "pendingVerify": 0
  },
  "logs": [                       // ⭐ 每次跑一页追加一条。是覆校/转写的增量日志
    { "page":27, "engine":"覆校(qwen3.8-max)", "model":"qwen3.8-max",
      "usage":{...}, "cost":0.638, "filled":183, "empty":57, "cells":240,
      "renderTime":2260, "apiTime":335852, "totalTime":338112 }
  ]
}
```

**"base" 字段**：记录这次逐格转写所依赖的 M2 底本。`grid-transcribe.json` 同样带 `base.sha256`。**下次跑时脚本会比较 `old.base.sha256 === m2.sha256`，不等就清空 done 重跑**——这是"换底本就要全部重转"的保护机制。

**"logs" 字段**：增量日志。每成功一页就 push 一条（含 engine 标签、token、cost、耗时）。脚本启动时从 `*-log.json` 恢复 pageLogs 数组，但**不会用 log 判重**——判重看的是 `grid-transcribe.json` 的 `pages[*].n`。所以 log 是财务/性能追溯用，断点续跑靠 `grid-transcribe.json` 的 pages 列表。

**两阶段触发方式**：
- **首轮基础转写**：直接跑 `node collation/tools/grid-transcribe.js 大学章句 --pages=7-76`，不传 `--force-deep` 也不传 `--model`。脚本会走 `gridTranscribe()` 的自动路由：先初校 qwen3.7-plus，conf<0.7 升级覆校 qwen3.8-max（vision.js:156-195）。但 `gridTranscribe` 在经注同大字版面时会**直接走覆校**（vision.js:275-287），不走初校。中庸/大学都属于这种"经注同大字"版面，所以实际日志里 engine 全是 `覆校(qwen3.8-max)`。
- **覆校轮次**（换模型/endpoint 重转）：加 `--suffix=xxx` 避免覆盖原文件。例如：
  - `--suffix=gpt5 --model=gpt-5 --endpoint=... --api-key=...`（大学章句已跑过，见 `grid-transcribe-gpt5.json`）
  - `--force-deep`：强制覆校模型（跳过初校路由），用于已经确定要用 deep 模型的场景

---

## 四、经注判定（j=经文顶格 / z=注文退格）的三条路径

1. **视觉直接判列级 start**：`judge-grid.js` 调 `gridColumns()`，让视觉给每列判"顶格/退一格/退两格"→ 顶格=j、退格=z。**实测 3.7-plus 不稳，vision.js:275 已硬编码直接走 qwen3.8-max 覆校模型**。
2. **逐格转写后推导**：`grid-transcribe.js` 调 `gridTranscribe()`，每格含 `{col,row,char,start}`，`build-songke-transcribe.js` 聚合列时根据 `start==="顶格"` 判 j、否则 z。
3. **ground-truth 核验**：`verify-jz.js` 用已有 `works/<id>/text.yaml` 作真相，对视觉判定打分（≥90% 为佳）。**大学章句已有 `jz.json`**。

---

## 五、产出文件对应

| 产物 | 生成脚本 |
|---|---|
| `output/善本点校本.md` | `run.js --step=export`（P6 双本之一，含校勘记夹注） |
| `output/善本点校本-分栏.md` | `build-songke.js`（路线 A，基于 grid.json 列级） |
| `output/善本点校本-分栏-逐格.md` | `build-songke-transcribe.js`（路线 B，基于 grid-transcribe.json 逐格聚合） |
| `output/校勘记.md` | `run.js --step=export`（P6） |
| `output/精校台.html` | `run.js --step=export`（P7 人工台面） |
| `quality-report.json` | `quality-report.js` |
| `verify-report.json` | `verify-v2.js`（M2-3）+ `run.js --step=verify`（P4.5 簇核验） |
| `pending-verify.json` | `build-v2.js` 输出（M2-2 阶段真疑难清单） |

---

## 六、Skills 覆盖边界

| Skill | 覆盖范围 | 与通用流程关系 |
|---|---|---|
| `guji-jiaokan` | **通用方法论 + 全链 checklist**：M0→M2→M3→P3→P6→M7。新古籍照此走 | 主技能，大学/中庸均适用 |
| `songke-lunyu-volume` | **论语分卷**：从四书章句集注.CHM → 抽取/繁简/`○` 补入/校验 → works/lunyuN。**不走视觉、不走 M 系列**，是 CHM 文本抽取路径 | 与 `guji-jiaokan` 完全正交；用于"已有干净文本、只需分卷入库" |
| `songke-zhouyi-volume` | **周易分卷**：从 exe 解包 → DOM 提取 → 繁简 → opencc 修正 → 校验。`expect` 字段先留空跑 `npm run validate` 回填 | 与 `songke-lunyu-volume` 同模式；与 `guji-jiaokan` 正交 |

**结论**：大学章句从扫描图重走，应套用 `guji-jiaokan` 全流程。`songke-lunyu-volume`/`songke-zhouyi-volume` 只适用于"已有可抽取电子文本"的路径，对大学章句不适用（大学章句需要视觉 OCR）。

---

## 七、全流程串并行结构 & 两支并行最佳切点

### 串行骨架
```
M0 → M2-1 → M2-2 → M2-3 → M3 → P3 → P4 → P4.5 → P5 → P6 → M6
 │      │       │       │     │                              │
 │      │       │       │     └── 两条路线择一（A 或 B）       └── expect 自动写入 meta.yaml
 │      │       │       └── pending-verify 必须清零才能进 M3
 │      │       └── 单文件批处理
 │      └── 可按段切分（如 1-20、21-40）
 └── 3 页抽样即可
```

### 断点续跑机制
- **M2-1 recollate.js**：输出文件名含页范围（`recollate-1-40.json`），重跑同范围会覆盖；切不同范围可并行。
- **M2-3 verify-v2.js**：`--start-page/--page-count` 切段；但**直改 shanben-v2.json**，多进程同写会冲突。需串行或加文件锁。
- **M3 grid-transcribe / judge-grid**：**以页号为 key 存 done 集合，启动时加载，成功一页立即持久化**。不同页号段可跑在不同进程/机器，只要 `--suffix` 不同或写不同临时文件再合并（目前脚本不内置合并，需手工或脚本合并 pages 数组）。
- **M6 build-works.js**：依赖 `grid.base.sha256 === m2.sha256` 且 `pendingCount === 0`，否则抛错。

### 两支并行最佳切点
**M3 阶段（grid-transcribe 或 judge-grid）** 是唯一切两支并行收益最大的点：

- **切法**：大学章句正文 p7-p76（70 页）切为 `--pages=7-40` 与 `--pages=41-76` 两支
- **前提**：输出文件用不同 `--suffix` 避免覆盖（如 `--suffix=a` / `--suffix=b`），跑完手工合并 `pages` 数组；或把两个输出放不同目录再合
- **页间完全独立**：vision.js 的 `gridTranscribe` / `gridColumns` 单次调用只处理一页 b64，无跨页上下文
- **收益**：转写是最耗 API 成本与时间的步骤（单页 5-10 分钟 API 时间），切两支 ≈ 减半墙钟时间
- **成本**：费用翻倍不了（总 token 不变），只是并发

M2 阶段（recollate）也可按段并行（大学已有 `recollate-1-40.json` + `recollate-8-9.json` 两段的先例），但 recollate 之后必须**用 build-v2.js 把所有段合一次**产 shanben-v2.json，所以并行度受限。

**不推荐的并行点**：verify-v2.js（直改同一文件）、run.js --step=all（内部串行依赖 align→diff→verify→officer→export）。

---

## 八、关键配置位置

| 文件 | 作用 |
|---|---|
| `collation/config/editions.yaml` | 善本/现代本登记、works 映射（`works[workId].shanben`） |
| `collation/config/vision.yaml` | 初校/覆校模型名、阈值、思考开关、key 环境变量名 |
| `env DASHSCOPE_API_KEY` | 视觉 API key（逗号分隔多 key）；脚本 `resolveApiKey` 自读 |
| `collation/data/<书>/layout.json` | M0 版面抽样结论 |
| `collation/data/<书>/shanben-v2.json` | M2 干净底本（终态） |
| `collation/data/<书>/grid.json` | M3 列级经注判定（路线 A） |
| `collation/data/<书>/grid-transcribe.json` | M3 逐格转写（路线 B） |
| `works/<id>/{text,meta,seals,ornaments}.yaml` | 引擎作品四件套 |

---

## 九、大学章句开工建议顺序

1. 确认 `collation/data/大学章句/` 现有 M2 底本是否还有效（shanben-v2.json 已存在，pendingVerify=0，base.sha256=`0427d8a...`）
2. 确认 `layout.json` 已登记（大学与中庸同版式 16×15，已落盘）
3. 走路线 B：`node collation/tools/grid-transcribe.js 大学章句 --pages=7-76 --conc=3`（已部分完成？看现有 grid-transcribe.json 的 pages 长度）
4. `node collation/tools/build-songke-transcribe.js 大学章句`
5. `node collation/tools/build-works.js 大学章句 daxue-songben --base=daxue --from=transcribe` → expect 自动写入
   （中庸路线 B 已走通：正文卷 zhongyong-songben 经 5012/注 8400；序卷用 `--pages=2-6 --section-name=…` 另成 zhongyongxu-songben）
6. `npm run validate` 验证 expect 一致
7. `node collation/run.js 大学章句 --step=all` 跑 P 链出校勘记
8. `node collation/tools/quality-report.js 大学章句 --write`

**已存在产物**：大学章句目录下已有 `grid.json` + `grid-transcribe.json` + `grid-transcribe-gpt5.json` + `jz.json`，说明 M3 两条路线都跑过。需要核对 pages 是否已覆盖全部正文页，再决定是否补跑或重跑。
