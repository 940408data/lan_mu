# 多 worktree 多 agent 协作实践与规范

> 本文档记录 2026-08-12 一次多 worktree + 多 agent 多任务协作的实践与收尾清理，实证暴露的四个问题，并提炼为可复用规范。若加入 `CLAUDE.md`，可作「多 worktree + 多 agent 协作」一节援引本文。
>
> 约定：【实证/问题/规范/速查】标签分小节；命令均经本次实践验证。

## 协作模式

并行开发采用「多 worktree + worktree 内建分支 + 每 worktree 一个 agent 会话」：

| 层 | 做法 | 路径/命名 |
|---|---|---|
| 工作区 | 每任务一个 git worktree | `.claude/worktrees/<语义名>` |
| 分支 | worktree 内建对应分支 | `<type>/<语义名>`（content/engine/infra/fix/docs） |
| Agent | 每 worktree 一个 claude 会话，cwd 钉在该 worktree | — |

理论优势：任务隔离（互不踩踏）、并行提速、可独立验证后合并。本次实践证明优势成立，但**回收与收敛环节缺规范**，导致大量废料堆积。

## 本次实践

2026-08-12 单日以该模式推进：

| 维度 | 内容 | 产出 |
|---|---|---|
| 内容校录 | 论语六七八卷、孟子各卷、幽兰引擎三作品（读山海经/赤壁赋/湖心亭看雪） | 多个 `content/*` 分支合并入 dev |
| 审美探索 | 唐/宋/明首页审美 + 书卡详情交互 | 4 个 `engine/portal-*` 分支 |
| 站点引擎 | 目录叶、首页视觉精修 | `engine/songke-*`、`engine/portal-refine*` |

峰值同时存在 **8 个 worktree、30+ 本地分支、5 个 serve 预览进程（8125–8128）**。日终清理时回收为：1 worktree（主 dev）、1 分支（dev）。

## 暴露的问题（实证）

**【问题#1】临时分支无语义命名、合并后不回收**：清理时发现 9 个 `worktree-agent-<随机hash>` 分支，全部已合并 dev，但 agent 退出时未删本地分支；命名无语义，事后无法追溯每个分支做过什么。→ 9 个全 `-d` 删除。

**【问题#2】locked worktree 僵尸化**：一个 worktree 被 agent session lock（`locked claude session …`），占用它的 claude 进程已跑 13.6h，任务实际早已完成，但进程未退出、worktree 无法 `remove`（locked 拒绝）。需手动 `unlock` + `kill <pid>` + `remove --force` 才能回收。

**【问题#3】探索性产物未归档、漂在中间态**：一个 worktree 停在 dev 旧点 + 139 行未提交 `site.css`（首页视觉精修），既没提交也没丢弃，长期占用 worktree；删则丢失、留则占位，进退两难。→ 评审后判定不值得留，`--force` 丢弃。

**【问题#4】并行探索无收敛流程**：唐/宋/明审美探索 4 个分支并存于 dev 之外，没有「评审→取一舍三→合并」的节奏，取舍依赖人工临时判断，易积压。→ 唐明丢弃、宋推远程存档、book-detail 并入 dev。

## 清理实践（安全删除流程）

### 分级识别

```bash
git branch --merged dev          # 列已合并分支（可 -d 安全删）
git worktree list --porcelain    # 看 locked 状态
git -C <path> status --porcelain # 逐 worktree 查未提交内容
```

**分级**：
- 无风险：纯本地已合并、无 worktree、无远程（如 `worktree-agent-*`）→ `-d` 直接删
- 低风险：已合并、远程有镜像 → 删本地，远程留备份
- 有风险：未合并（独立提交）/ 未提交内容 / locked → 先定内容去留，再删

### worktree 删除

| 场景 | 命令 |
|---|---|
| 工作区干净 | `git worktree remove <path>` |
| 有未跟踪/未提交（确认丢弃） | `git worktree remove --force <path>` |
| locked | `git worktree unlock <path>` → `remove --force`（先查 pid 活性，进程在则 `kill`） |

### 分支删除

- 已合并：`git branch -d <name>`（安全，未合并会拒）
- 未合并且确认丢弃：`git branch -D <name>`
- 远程：`git push origin --delete <name>`（外向不可逆，确认后再做）

### 合并后验证（守门）

并入 dev 后跑：
- `npm run validate`（数据基准 + 站点聚合校验）
- `npm run verify`（幽兰逐字节保真，**改 src/ 必跑**）
- `node tools/gen-index.js`（站点首页/目录页渲染，改 `src/site/` 时直接测到）

本次 book-detail 并入 dev：validate / verify / gen-index 三闸全过。

## 规范（候选加入 CLAUDE.md）

1. **分支命名带语义**：agent 临时分支用 `<type>/<语义名>`（如 `engine/portal-song`），**禁用** `worktree-agent-<hash>` 等无语义名；合并/丢弃后立即 `git branch -d/-D` 回收本地分支。

2. **worktree 路径统一**：开发用 `.claude/worktrees/<语义名>`；审核预览用 `.preview-wt/<语义名>`，审核完即删，不长期保留。

3. **退出即回收**：agent 任务完成退出前，`git worktree remove` + `git branch -d` 清理本任务 worktree 与分支；locked worktree 超 1h 无活动视为僵尸，`unlock` + `kill <pid>` + `remove --force` 回收。

4. **探索即收敛**：探索性分支定期评审，**提交归档或显式丢弃**，不留未提交中间态长期漂着；并行探索 ≤ 3 个，评审后取一舍余并入 dev。

5. **删除前三查**：查 `git branch --merged dev`（是否可安全删）、查 `git status`（有无未提交内容先定去留）、查 locked worktree 的 pid 活性（进程在先 kill）。

## 命令速查

```bash
# 看全貌
git worktree list --porcelain
git branch -vv
git branch --merged dev

# 逐 worktree 查未提交
git -C <path> status --porcelain

# 删 worktree（干净/强删/locked）
git worktree remove <path>
git worktree remove --force <path>
git worktree unlock <path> && git worktree remove --force <path>

# 删分支（安全/强删/远程）
git branch -d <name>
git branch -D <name>
git push origin --delete <name>

# 合并后守门
npm run validate && npm run verify && node tools/gen-index.js
```

## 文件清单（本分支产出）

- `docs/多worktree多agent协作实践与规范.md` — 本文（实践记录 + 规范 + 速查）
