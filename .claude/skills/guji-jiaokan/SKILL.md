---
name: guji-jiaokan
description: AI 古籍校勘通用流程——以公开善本为底、现代点校本对校，经视觉互证+版面结构判定+校书官智能体，产出善本点校本（公开）与现代本（自用）。核心方法论「版面结构先行」：先抽样总结该书版面网格，由顶格/退格规则客观推导经注，而非让视觉主观猜。用于把任意古籍扫描+OCR 加工成可进兰木 songke 引擎的点校数据。新古籍（中庸/论语/孟子等）照本技能逐步执行即可。
---

# AI 古籍校勘（双轨对校）

把一部古籍的**公开善本**（底本）与**现代点校本**（对校本）经多智能体校勘，产出两份点校文本。已实证：《大学章句》端到端走通（works/daxue-songben 进引擎）。代码 `collation/`，全流程与产物总览见 `docs/古籍校勘流水线.md`（**先读它**），方法论见 `docs/古籍校勘实施实录.md`。

## 前置（开工备齐）

1. **数据落位** `input_data/<书>/{善本,现代本}_{pdf,ocr}/`：分页 PDF（page_XXXX.pdf）+ 每页 OCR md。
2. **版本登记** `collation/config/editions.yaml`：善本 A 级公开 / 现代本 B 级自用，works 映射。
3. **视觉配置** `collation/config/vision.yaml`：初校/覆校模型、阈值、思考开关。
4. **key**：env `DASHSCOPE_API_KEY`（逗号分隔多 key，脚本 resolveApiKey 自读，**勿嵌命令行、勿入仓**）。

## 核心方法论（三条铁律）

1. **版面结构先行（grid-first）**：禁止让视觉直接猜经注（实测仅 43.5%）。先 `layoutProbe` 抽样总结该书网格（列×行、每格字数、顶格/退格），再由规则客观判经注（核验 91.7%）。**每本书版面不同，必须先抽样。**
2. **两路互证**：视觉重 OCR 不单独采信——与旧 OCR 逐字比对，一致采信、相异规则仲裁、真疑难覆校看扫描。视觉漏字采旧、多字舍、异体存善本原刻字形。
3. **边界三层**：视觉只答「实印何字/版面结构」（客观层）；校书官给学术倾向+理据（倾向层）；真学术争议归人（裁决层，悬置不强行定论）。

## 标准流程（逐步执行，每步有质量闸）

```bash
# M0 版面抽样（每书必做）：layoutProbe 抽 3-5 页 → 记录 列×行/格字制/顶退格规则
#    （产物将落 layout.json，见流水线文档缺口②）

# M2 干净底本（仅善本侧）
node collation/tools/recollate.js <书> --pages=1-N --conc=3     # 视觉重OCR+互证 → recollate-*.json
#   闸：平均一致率 ≥90%，低则查版面/旧OCR质量
node collation/tools/build-v2.js <书>                           # 规则仲裁 → shanben-v2.json + pending-verify.json
node collation/tools/verify-v2.js <书> --conc=3                 # 覆校真疑难 → verify-report.json
node collation/tools/build-v2.js <书>                           # 再跑应用覆校 → shanben-v2.json 终态★

# M3 版面判定经注（--cols/--rows 用 M0 抽样所得该书网格）
node collation/tools/judge-grid.js <书> --pages=<正文起>-<正文止> --conc=3 --cols=16 --rows=15
node collation/tools/verify-jz.js <workId> --jz=collation/data/<书>/grid.json   # 有既有works时核验，≥90%为佳
node collation/tools/build-songke.js <书>                       # → output/善本点校本-分栏.md

# P3-P4 对齐对校
node collation/run.js <书> --step=align && node collation/run.js <书> --step=diff

# P4.5 夺/衍簇核验（当前为独立工具；并入 run.js 待审批，见流水线文档§5）
node collation/tools/cluster-dy.js <书>                         # 字级夺/衍 → 簇级（带锚点+双页码）→ clusters.json
node collation/tools/verify-clusters.js <书> --conc=3           # 双侧视觉核验 → clusters-verify.json
#   结论四分类：现代OCR误(剔除留痕)/善本底本误(回修shanben-v2重跑P3起)/真异文(送校书官)/书题牌记(剔除)

# P5 校书官（真异文+ocr疑+核验为真的夺衍换簇）
node collation/run.js <书> --step=officer                       # 4官并行、增量保存、断点续传

# P6 出具
node collation/run.js <书> --step=export                        # → output/{善本点校本,现代本,校勘记}.md + flags.yaml

# P7 人工：flags.yaml 悬置项核他本/石经 → 回写 verdicts.json human 字段 → 重跑 export 吸收

# M6 进引擎（善本底独立新作品，不动通行本）
node collation/tools/build-works.js <书> <新作品id> --base=<模板作品>
npm run build -- --work=<新作品id> --only=html                  # 验证
```

## 中庸章句（下一部，直接可用）

- 善本 78 页；**先 M0 抽样确认中庸网格**（可能与大学 16×15 不同）。
- 正文约 page 7/8 起；序另成卷（zhongyongxu-songben）；33 章强锚 `右第X章`（align 已含）。
- 书末题跋页视觉差，归人工。
- 现状：仅有 mock 占位产物（166 条 161 悬置），须按上流程全量重跑（task #15）。

## 视觉两角色与思考开关

| 角色 | 底层模型 | 触发 |
|---|---|---|
| 初校 | qwen3.7-plus | 默认（快/省） |
| 覆校 | qwen3.8-max | 初校 conf<0.7 升级 |

思考开关按任务：纯 OCR 照录**关思考**（快 5.7×）；版面判定/单字辨形/网格转写/簇核验**开思考**（保精度）。dpi ≥150。

## 双本分流（法理）

- 善本点校本：公开善本+原创点校，可公开传播。
- 现代本：有整理者著作权，**自用、不入 dist、不外传**。两线物理隔离。

## 坑与对策

| 坑 | 对策 |
|---|---|
| 视觉直接猜经注（43.5%） | 版面结构先行：抽样→规则→网格→核验 |
| 关思考判版面变糙 | 版面/网格/核验任务开思考；仅纯 OCR 关 |
| 视觉漏字 | 互证缺字采旧 OCR |
| CJK-Ext-B astral 字错位 | normChar 未映射 astral 归一单码元占位（align.js 已处理） |
| 页中书题/页眉混入 | 对齐剥书题 + P4.5 规则归类「书题牌记」 |
| 夺/衍字级炸开虚增体量 | cluster-dy 簇级归并 + verify-clusters 双侧核验 |
| 校书官串行无保存 | officer 增量保存+断点续传+条间并行 |
| key 触发分类器超时 | resolveApiKey 自读，勿嵌 bash |
| 书末题跋页识别差 | 归人工 |
| 善本异体混用（母/毋） | 底本忠实实印，校勘判断另议 |

## 每书 Checklist

- [ ] 前置四项齐备（数据/登记/配置/key）
- [ ] M0 版面抽样结论记录
- [ ] M2 互证 ≥90% + 覆校完成 + shanben-v2 终态
- [ ] M3 判定核验 ≥90%（有 ground truth 时）
- [ ] P4.5 全部夺/衍簇有核验结论
- [ ] P5 校书官真跑（非 mock）无 error
- [ ] P7 悬置项人工终裁回写
- [ ] M6 进引擎 `build --only=html` 通过
