# 兰木 · AI 古籍校对系统（collation/）

兰木（lan_mu）的上游校勘子系统。承兰木「一次校录，多态呈现」之理念——本系统负责把
**扫描善本**与**现代点校本**经多智能体校勘，产出两份点校文本；其中**善本点校本**可公开传播，
并可转写为 `works/<id>/text.yaml`，喂入兰木 songke 引擎。

实证案例：`input_data/` 下的《大学章句》《中庸章句》——当涂郡斋刊递修本（南宋公开善本）
与儒藏精华编（现代点校本）双轨对校。

- **方案设计** → [DESIGN.md](DESIGN.md)（七阶段流水线、版本法理、校书官制度、数据模型）
- **校书官画像** → [officers/](officers/)（刘向 / 解缙 / 戴震 / 纪昀）

## 流水线（七阶段）

```
P0 装载 → P1 OCR* → P2 AI初校 → P2.5 视觉复核 → P3 对齐 → P4 对校 → P5 校书官 → P6 双本出具 → P7 人工
 io.js           llm.js       reconfirm.js     align.js   diff.js   officer.js    export.js      flags
```
\* P1 已由 `input_data/*_ocr/` 提供；如需对新扫描补跑，用 `tools/pointcheck/ocr.js`。

| 阶段 | 模块 | 干什么 |
|---|---|---|
| P0 装载 | `src/io.js` | 读两本 OCR md + PDF 页索引 → `Edition` |
| P2 AI 初校 | `src/llm.js` | 清洗/异体归一/经注判；mock 兜底保证可跑 |
| P2.5 视觉复核 | `src/reconfirm.js` | 对善本扫描再调 VLM/OCR 确认疑难字 |
| P3 对齐 | `src/align.js` | 句级锚点对齐（indexOf + 编辑距离兜底，异体归一，去内联校记） |
| P4 对校 | `src/diff.js` | 字级异文 + 归类（异体/真异文/ocr疑/夺/衍） |
| P5 校书官 | `src/officer.js` + `officers/` | 四官各陈意见 → 陈列 → resolved/suspended |
| P6 双本出具 | `src/export.js` + `src/punctuate.js` | 善本点校本(公开) + 现代本(自用) + 校勘记 |
| P7 人工 | `flags.yaml` | 悬置疑问 + ocr疑 + deferred 终裁回写 |

## 用法

```bash
# 全链跑一部作品（无 API key 走 mock 基线，仍产出完整双本）
node collation/run.js 大学章句
node collation/run.js 中庸章句

# 指定阶段
node collation/run.js 大学章句 --step=align      # 仅对齐
node collation/run.js 大学章句 --step=diff        # 仅对校
node collation/run.js 大学章句 --step=officer     # 校书官裁决
node collation/run.js 大学章句 --step=export      # 用既有 verdicts.json 出具双本

# 真实 LLM（置 env 后自动启用，无则 mock）
ANTHROPIC_API_KEY=... node collation/run.js 大学章句
# 或通义千问
DASHSCOPE_API_KEY=... node collation/run.js 大学章句
```

产物见 `collation/data/<书名>/`：`aligned.json` / `diffs.json` / `verdicts.json` +
`output/{善本点校本.md, 现代本.md, 校勘记.md}` + `flags.yaml`。

## 双本分流（法理）

| 本 | 底本 | 用途 | 法理 |
|---|---|---|---|
| 善本点校本 | 当涂郡本（公开善本，A级） | **可公开传播** | 公有领域善本 + 原创点校 |
| 现代本 | 儒藏本（现代点校本，B级） | **仅供自修** | 整理者著作权，不入 dist/不外传 |

两线物理隔离：善本点校本只引善本之字，绝不混入现代本受著作权保护的整理成果。

## 校书官（智能体）

| 官 | 时代 | 方法论 | 主校法 |
|---|---|---|---|
| 刘向 | 西汉 | 辨章学术、考镜源流 | 本校/他校 |
| 解缙 | 明 | 群籍类书旁证 | 他校 |
| 戴震 | 清 | 由字通词、音韵训诂 | 理校/训校 |
| 纪昀 | 清 | 折中定谳、综众取平 | 折中 |

裁决总则：**从理不从众**——四官意见并列陈列，不一意求同；能定给定论，难定给暂拟 + 线索，绝不强不知以为知。
画像见 `officers/*.md`，既供 Node 端 LLM 调用，亦可由 Claude Code Agent 实跑 live 裁决。

## AI 模型接入（`src/llm.js`）

- **可插拔**：`ANTHROPIC_API_KEY` → Claude；`DASHSCOPE_API_KEY` → 通义千问（OpenAI 兼容）；皆无 → 确定性 mock。
- **mock 兜底**：按各官方法论倾向 + 异文类型出确定性意见，标 `engine:'mock'`，保证全链可跑可验。
- 强制 JSON 输出（schema + 解析校验 + 兜底），用 Node ≥18 全局 fetch，无需额外 SDK。

## 与兰木既有设施的关系

- **`tools/pointcheck/`**（`ocr.js` P1 + `ai.js` P2 规则基线）：本系统**延伸而非替代**之——
  pointcheck 止于"草稿 text.yaml + flags"，本系统续上对校→校书官→双本出具。
- **`works/<id>/text.yaml`**：兰木 songke 引擎消费品。本系统的**善本点校本**经人工复核后，
  可转写为 `text.yaml`（`sections[].blocks[]{type:j|z,text}`），作 `works/daxue`/`works/zhongyong` 的善本底来源（现为通行本）。
- **`input_data/`**：gitignored 源数据，运行期读取，不入仓库；产物写 `collation/data/`（小体量 JSON/MD，可入仓）。

## 局限与后续

- **经注大小学**：善本 flat OCR md 已丢失经(j大字)/注(z小字)区分；须 tsv 字高（`tools/pointcheck/ocr.js`）或视觉复核补回。当前善本点校本经注混排未细分（DESIGN §9）。
- **异体归一表**：`src/align.js` 的 `VARIANT_MAP` 为手定，覆盖大学、中庸常见善本古异体；扩至论语/孟子等更大部头时需扩充（对齐失配会自动走 fuzzy/异体标，校书官与人工复核兜底）。
- **句读点校的笔墨微变换**（兰木 `calligraphy.js` 按 seed 生成）不在本系统范畴，由下游引擎处理。
- 论语、孟子集注体量巨大（445/547 页善本），当前实证止于大学、中庸；流水线已为大批量留好分页/分批接口。
