# 贡献规范

本仓库为「兰木」项目（书法/古籍/音乐数字文创）。采用 Trunk-Based 工作流，`dev` 为集成分支（trunk）。以下分支与提交规范结合业界惯例与本项目「数据/表现分离」理念制定。

## 工作流

```
dev（trunk）──┬── <type>/<desc>  短命特性分支
              └── 合回 dev → 删分支
```

- 所有分支从 `dev` 切出，合回 `dev`，合并后删除。
- 寿命数小时到数天，不长期挂分支。
- 无 `main/master`；生产 `dist/` 由 `dev` 构建。
- 紧急修复同特性分支流程，仅用 `fix/` 前缀。

### 合并评审（分级）

合回 `dev` 前是否需评审，按改动性质分级：

- **琐碎改动**（文档、样式、小修、基建）：可直接本地 `merge --no-ff` 进 `dev` 并推送。
- **实质改动**（新系统/子系统、引擎、排版、内容校录、字体管线）：必须开分支、推送、**发 PR 经评审后方可合并**；**禁止直接本地 `merge`+push 进 `dev`**。

> 缘由：单人 trunk-based 下本地 merge 是常态，但实质改动直接进共享的 `dev` 会绕过把关。判不准性质时，一律按实质改动处理（开分支 + PR 评审）。

## 分支命名

`<type>/<kebab-desc>`，全小写、短横线、无空格；desc 首位放 work id 或引擎名便于 grep。

| 类型 | 用于 | 改动落点 | 示例 |
|---|---|---|---|
| `content/` | 内容校录（某本书/卷的文字数据） | `works/<id>/*.yaml` | `content/lunyu8`、`content/daxue`、`content/youlan-订补` |
| `engine/` | 引擎/排版/字体/渲染代码 | `src/core/`、`src/render/`、`src/fonts/`、`css/` | `engine/songke-per-face-pdf`、`engine/scroll-calligraphy`、`engine/font-b-track` |
| `infra/` | 基建（构建/部署/工具/文档） | `tools/`、`Dockerfile*`、`docker-compose*`、`package.json`、`CLAUDE.md` | `infra/docker-tmpfs`、`infra/proofread-tools` |
| `fix/` | 跨类小修/紧急修复 | 不限 | `fix/verify-regression` |

> **区分作品与引擎**：`youlan` 是作品 id，不是引擎名。引擎是 `scroll`（手卷）/ `songke`（宋版）。动幽兰的**文字**用 `content/youlan`；动手卷**引擎**用 `engine/scroll-...`，二者别混。

## 提交信息

Conventional Commits 变体——英文 type + 中文 subject：

```
<type>(<scope>): <中文祈使描述>
```

- **type**：`feat` `fix` `docs` `style` `refactor` `perf` `build` `ci` `chore` `test`
- **scope**（可省）：work id（`lunyu8`）或引擎/子系统（`songke`/`scroll`/`fonts`/`docker`）
- **subject**：中文祈使（新增…/修正…/优化…）

示例：

| 规范写法 |
|---|
| `feat(lunyu8): 新增論語集注卷八（衛靈公第十五 + 季氏第十六）` |
| `fix(songke): extract-lunyu 无注章独立成 j` |
| `fix(lunyu5): 校正 opencc 字符` |
| `build(docker): /tmp 改用 tmpfs` |
| `docs: 新增 CLAUDE.md` |
| `chore(skill): 增补卷六经验 + 校录工具转正` |

合并提交：`Merge branch 'content/lunyu8' into dev：論語集注卷八`。

## Tag 策略

- **暂不引 semver（v1.2.3）**：本项目不发版库、无 API 兼容契约，semver 是负担。
- **按需打内容里程碑标签**（annotated）：在内容完整性节点（如全十卷校录完成、某次部署快照）打，便于复现回滚：

  ```bash
  git tag -a lunyu-全帙 -m "論語集注卷一至卷十全帙校录完成"
  git tag -a deploy-2026-08 -m "部署快照"
  ```

- 罕用，不给每卷/每次提交打。
- 引擎将来若作为独立库/模板对外发布，再引 semver。

## 本地质量门（pre-commit hook）

仓库 `.githooks/pre-commit` 在提交前自动执行：

1. **`npm run validate`**（始终）——全作品数据校验，失败则阻止提交。
2. **幽兰复刻保真**（仅当改动触及 `src/core|render|fonts|viewer/`、`works/youlan/`、`css/` 时）——先 `build --work=youlan --only=html`，再 `verify`（dist 与 `Youlan-Scroll.html` 逐字节比对），不一致则阻止提交。

这是本项目逐字节可复现性的守门人。`npm install` 经 `prepare` 脚本自动配置 `core.hooksPath`；手动配置：

```bash
git config core.hooksPath .githooks
```

绕过（仅在环境异常时）：`git commit --no-verify`。

## 快速上手

```bash
git checkout dev
git checkout -b content/lunyu8          # 按类型开分支
# ...改 works/lunyu8/*.yaml...
npm run validate                        # 本地先自检
git add works/lunyu8/
git commit -m "feat(lunyu8): 新增論語集注卷八（衛靈公第十五 + 季氏第十六）"
# pre-commit hook 自动跑 validate（+ 条件 verify）
git checkout dev && git merge --no-ff content/lunyu8   # 合回 dev
git branch -d content/lunyu8            # 删分支
```
