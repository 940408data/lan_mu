# 大学章句逐格 · 两 worktree 并行全流程

## Context（为什么做）

中庸章句逐格已在 `c3b8922` 完成全流程（75 页逐格 + 经注分栏 md，达完成态）。大学章句同构（16×15 网格、当涂郡本底本），但逐格转写**只做了 p2–p9 共 8 页**，正文页域 p6–p36（31 页）中**p10–p36 共 27 页未做**，下游 `善本点校本-分栏-逐格.md` 仅 11 行骨架、verify-report 仅 1 条。本计划补齐 p10–p36 逐格，跑通到与中庸同构的完成态。

逐格转写页间独立、每页落盘可续跑，是全流程唯一可并行且最耗时的瓶颈（qwen3.8-max 每页 5–10 分钟，27 页单线约 3–5 小时）。按页范围切两支并行可将墙钟压到一半。

## 已查清事实

- **原图**：`/root/lan_mu/input_data/大学章句/当涂郡本_pdf/page_0001.pdf`..`page_0040.pdf`（40 页），gitignored（`.gitignore` 第 13 行 `/input_data/`）。
- **INPUT_DATA 定位**（`collation/src/io.js:21-22`）：`REPO_ROOT = collation/..`（仓库根）→ `INPUT_DATA = <repoRoot>/input_data`。worktree 里 REPO_ROOT 解析为 worktree 根，故 **worktree 需自建 `input_data` 软链 → 主仓 `/root/lan_mu/input_data`**（见 memory「collation-worktree-input-data」）。
- **layout**：cols=16 rows=15，`textPages=[6,36]`，`colophonFrom=37`，jingStart=顶格 / zhuStart=退一格。
- **逐格现状**：`grid-transcribe.json` 已有 p2–p9（8 页，1553 有字格，engine=覆校 qwen3.8-max）；缺 p10–p36。另存 `grid-transcribe-gpt5.json`（p2–9 对照）。
- **数据 git 状态**：大学章句 19 个文件**全部 tracked 在 dev**；唯一未跟踪 = `output/善本点校本-分栏-逐格.md`（11 行骨架）。worktree 从 dev 切出即自带全部前置成果。
- **grid-transcribe.js CLI**（`collation/tools/grid-transcribe.js`）：
  - `node collation/tools/grid-transcribe.js 大学章句 --pages=10-36 --suffix=part1 --force-deep [--conc=N]`
  - `--pages=起-止` 必填；`--suffix=NAME` → 输出 `grid-transcribe-NAME.json` + `-log.json`（隔离两支互不覆盖）
  - `--force-deep` 强制 qwen3.8-max 覆校；`--conc` 默认 1
  - **断点续跑**：读旧文件比对 `base.sha256`，匹配则跳过 `done[pg]`；每页实时落盘
- **build-songke-transcribe.js**（`collation/tools/build-songke-transcribe.js`）：读**主** `grid-transcribe.json`（无 suffix），按 layout.textPages 过滤聚合经【經】/注【注】，写 `output/善本点校本-分栏-逐格.md`。**依赖主文件完整** → 收尾须先把两 part 的 pages 合并进主文件。
- 费用：中庸均页 ¥0.64，大学 27 页约 ¥17（两支并行不增总量）。

## 两 worktree + 分支分工

按页范围对半切，两支用不同 `--suffix` 隔离输出：

| worktree | 路径 | 分支 | 页范围 | suffix | 页数 |
|---|---|---|---|---|---|
| A | `.claude/worktrees/daxue-grid-a` | `content/daxue-grid-a` | p10–p22 | `part1` | 13 |
| B | `.claude/worktrees/daxue-grid-b` | `content/daxue-grid-b` | p23–p36 | `part2` | 14 |

序跋 p37–p40 不做逐格（与中庸一致，中庸只做到正文末 p76）。p2–p9 已有，不重跑。

## 执行步骤

### 阶段 1：建两 worktree + 软链（主仓 dev 工作区）
```
git worktree add .claude/worktrees/daxue-grid-a -b content/daxue-grid-a dev
git worktree add .claude/worktrees/daxue-grid-b -b content/daxue-grid-b dev
# 各 worktree 建 input_data 软链（脚本靠它定位 PDF）
ln -s /root/lan_mu/input_data .claude/worktrees/daxue-grid-a/input_data
ln -s /root/lan_mu/input_data .claude/worktrees/daxue-grid-b/input_data
```

### 阶段 2：两支并行逐格转写（两个 agent 会话，各自在 worktree 内并行）
- 支 A（在 `.claude/worktrees/daxue-grid-a`）：
  `node collation/tools/grid-transcribe.js 大学章句 --pages=10-22 --suffix=part1 --force-deep --conc=1`
- 支 B（在 `.claude/worktrees/daxue-grid-b`）：
  `node collation/tools/grid-transcribe.js 大学章句 --pages=23-36 --suffix=part2 --force-deep --conc=1`
- 前置：确保 shell 有 API key（`CUSTOM_API_KEY` 或 `TEAMO_API_KEY` 环境变量，中庸跑通即说明环境具备；worktree 继承主仓 env）。
- 中断可重跑同命令续传（done[pg] 跳过）。
- 各自产出 `grid-transcribe-part1.json` / `grid-transcribe-part2.json` + log，各自 `git add` + commit。

### 阶段 3：收尾合并 + 下游（主仓 dev 工作区）
1. **拉两 part 文件到主仓**：`git checkout content/daxue-grid-a -- collation/data/大学章句/grid-transcribe-part1.json grid-transcribe-part1-log.json`，part2 同理。
2. **合并 pages 进主 grid-transcribe.json**：一次性 node 脚本——读主文件（p2–9）+ part1（p10–22）+ part2（p23–36），按页号 `n` 去重排序合并 `pages` 数组，保留 `work/base/layout` 字段，写回主 `grid-transcribe.json`。校验：pages 覆盖 n=2..36 全 35 页、无缺页。
3. **产出分栏逐格 md**：`node collation/tools/build-songke-transcribe.js 大学章句` → 完整 `output/善本点校本-分栏-逐格.md`。
4. **覆校验证**：跑 `collation/tools/verify-grid-reconstruct.js`（或 `collation/run.js 大学章句 --step=verify`）更新 `verify-report.json`。
5. **质量报告**：`node collation/tools/quality-report.js 大学章句` 更新 `quality-report.json`（status draft→可发布）。
6. **提交**：主仓 dev 一次提交（完整 grid-transcribe.json + log + 分栏-逐格.md + verify + quality），合并两 part 分支到 dev 或直接删除 part 分支（part 文件已并入主文件，可留作对照或清理）。

## 验证（对齐中庸 c3b8922 完成态）
- `grid-transcribe.json`：pages 覆盖 n=2..36（35 页），无空页，有字格率 ~80%（对齐中庸 80.8%）。
- `output/善本点校本-分栏-逐格.md`：行数 ~200+（中庸 567 行/75页，大学 35 页正文按比例约 250 行），经【經】/注【注】段数对称、朱熹序在首、无 TODO/占位。
- `verify-report.json`：覆校记录数显著增多（中庸 55+ 条）。
- `quality-report.json`：status 非 draft。
- 目检 p10、p22、p36 抽样页填充率正常。
- 两 worktree 合并后 `git worktree remove` 回收，`git branch -d content/daxue-grid-a content/daxue-grid-b`。

## 风险与注意
- **API key 可用性**：两 worktree shell 须能读到 key（继承主仓 env 即可）；qwen3.8-max 思考超时曾致 fetch failed（commit 5631d1c 已修 fetch→https.request 600s），`--conc=1` 稳妥，勿盲目上调。
- **input_data 软链**：缺则脚本找不到 PDF 直接跳过该页（`grid-transcribe.js:114` `if (!fs.existsSync(pdfPath)) continue`）——静默跳页，须确认软链生效。
- **合并正确性**：pages 合并按 `n` 去重，避免 part 间页号重叠或遗漏；合并后立即校验页数。
- **经注判定旧坑**（memory「zhongyong-jingzhu-pitfall」、朱熹总论顶格）：build-songke-transcribe 用顶格=j/退格=z 规则客观判定，中庸已验证正确；大学朱熹章句序同结构，应无碍，但收尾后目检首段经/注归属。
- **分支命名**：遵循 `<type>/<kebab-desc>`（content 类型），禁用无语义 hash 名。

## 边界（本计划不含）
- 不做 works/ 下 songke 卷入库（那是更下游，由 songke-lunyu/songke-zhouyi 类 skill 负责；本计划止于 collation 层逐格全流程）。
- 不动中庸数据、不动引擎、不动站点页。
- 不清理既有冗余 worktree（grid-transcribe-zy-1/2/3 等）——除非用户另行指示。
