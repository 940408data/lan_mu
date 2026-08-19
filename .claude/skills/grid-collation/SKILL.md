---
name: grid-collation
description: 网格基校勘 G 管线通用流程——以视觉逐格（qwen3.8-max，禁 mock）为唯一基础层，旧 OCR 与现代点校本旁挂参校，四校书官审议 + 精校台人工裁决 + fixes 唯一改字通道 + G5 单源出口（songke-facsimile 影刻直出产 grid.yaml）。适用任意分卷/平铺古籍（论语/孟子集注等大部头照本技能逐步执行）。旧管线 skill 见 guji-jiaokan（双轨过渡期，验收后下线）。
---

# 网格基校勘（G 管线）

五阶段：G1 视觉逐格 → G2/G3 参校挂格 + 标签层 → G4 四官 + 精校台 → G5 单一出口。已实证：大学章句 / 中庸章句（双书验收 8.8 分）、论语集注卷一（通用性验证）。代码 `collation/`，设计见 `docs/网格基流程重构方案.md`，操作手册见 `docs/网格基精校台启动指南.md`。

## 三条铁律

1. 基础层 `grid-transcribe.json` 永不直接修改；改字只能经「精校台裁决 → grid-review-merge → overlay.fixes」通道。
2. **G1 逐格视觉一律 `--force-deep`（qwen3.8-max 覆校）**——初校路由与 mock 都不允许（后续一切层以此为基石）。
3. 参校层只记差异（variants），不改基础层。

## 前置（每书必做，产出=登记文件，无代码改动）

1. **数据落位**：平铺 `input_data/<书>/{当涂郡本,儒藏本}_{ocr,pdf}/` 或分卷 `input_data/<书>/<卷>/…`（页码全局连续，工具自动卷路由）。**分卷书每卷一作品**：每卷独立 workId（如 论语集注卷二），登记 `inputBook: 论语集注` 指回原书目录——保证各卷基础层指纹/裁决链互不作废。
2. **版本登记** `collation/config/editions.yaml`：works 映射 + **锚规则登记**（`anchors.mode: pian` + 篇名表，或默认右X章收束式不登记）。
3. **版面抽样**：有 key 跑 `node collation/tools/layout-probe.js <书> --pages=卷首,中,卷末`；无 key 用本地证据链（PDF 尺寸对比同类书 + OCR 行款众数 + 浏览器实拍）→ 手写 `collation/data/<书>/layout.json`（cols×rows、经注起格、textPages、specialPages）。
4. **页范围与非标准页登记**：卷首扉页（宋本XX卷X）、半叶、OCR 空页（图版页）显式记 specialPages，G1 跳过。
5. **轻量底本**：`node collation/tools/build-v2-lite.js <书> --pages=起-止 --write`（当涂_ocr 直构 shanben-v2，剥扉页/幻觉行，留痕）。
6. **渲染环境**：pdftoppm 探测链 env `POPPLER_BIN` > 仓库 `__poppler/`（poppler-windows 解压即用）> PATH；key 写 `~/.bashrc`（`export DASHSCOPE_API_KEY="…"`，工具自读）。

## 标准流程（每步有质量闸，均可断点续跑）

```powershell
# G1 逐格转写（qwen3.8-max；先 3 页试跑看列数/密度/费用，再全量）
node collation/tools/grid-transcribe.js <书> --pages=A-B-C --force-deep          # 试跑
node collation/tools/grid-transcribe.js <书> --pages=起-止 --force-deep --conc=2 # 全量
#   闸：列数=layout 预期；填充密度与同类书同量级；抽 1 页与 OCR 剥行后文本逐字比

# G2/G3 参校挂格 + 标签层（分卷书自动路由；务必显式 --input-root）
node collation/tools/grid-overlay.js <书> --input-root=d:/note/lan_mu/input_data --write
#   闸：G2a/G2b 一致率 ≥94%；sections 与登记结构一致；超长无锚段 0；预清洗留痕无正文误剥

# G4 四官（mock 全量验证链路 → 真实引擎按预算；只审议 sub 类）
node collation/tools/grid-officer.js <书>
node collation/tools/grid-review.js <书>          # 精校台 HTML（私有目录，双击打开）

# 人工裁决（浏览器）→ 导出裁决 JSON →
node collation/tools/grid-review-merge.js <书> --file=精校裁决-<书>.json --write

# G5 单一出口（songke-facsimile 影刻直出标准）——产 grid.yaml（逐格坐标三元组）
#   旧 songke 引擎（text.yaml）用 grid-export.js，见附录
node collation/tools/grid-to-work.js <书> <新作品id> --write
npm run validate -- --work=<新作品id> && npm run build -- --work=<新作品id> --only=html
```

## 每书适配 Checklist

- [ ] 数据落位（平铺或分卷）+ editions.yaml 登记（title 繁体、锚规则）
- [ ] layout.json（版面规格 + textPages + specialPages 非标准页）
- [ ] build-v2-lite 底本（剥行留痕核对，空留痕=规则失效信号）
- [ ] 儒藏本预清洗留痕复核（① 序号/校记用语/卷尾题；缺则增量扩 precleanModern 规则并复验双书回归）
- [ ] G1 试跑 3 页（列数/密度/费用/文本抽比）
- [ ] works 四件套——meta.yaml（layout: songke-facsimile，参考 lunyu-songben-vol7 改 id/title/banxinTitle/colophon/seed/export.base）+ grid.yaml（G5 产）+ seals.yaml + ornaments.yaml
- [ ] 双书回归（大学/中庸 overlay dry-run 逐项不变）

## 坑表（实证回填）

| 坑 | 对策 |
|---|---|
| OCR md 是 LLM 照录，含幻觉插入（论语「欽定四庫全書」2 处，影像无） | **OCR 文本 ≠ 影像事实**：底本/版面层判断必须实拍核验；幻觉行由 build-v2-lite 剥除（留痕），G2a extra 类自然兜底 |
| grid.js 默认 inputRoot 指向仓库外（`d:/note/input_data`） | G2b 必须显式 `--input-root` |
| 剥行规则在「已剥 # 前缀的行」上执行，正则不得再要求 `#` | 留痕计数为空即规则失效 |
| 会话 shell 读不到新设的用户级 env | key 从注册表读出写入 `~/.bashrc`（resolveApiKey 自读） |
| playwright 渲染 PDF 兜底路径不可用（blob:nodedata 无法 goto；timeout 命令管道 stdin 失败） | 用 poppler：仓库 `__poppler/` 解压 + vision.js pdftoppmBin 自动探测 |
| 半叶 PDF（尺寸≈整叶一半）OCR 无文字输出 | 登记 specialPages 跳过，勿当模型失败 |
| 影像「左右半叶」与文字描述易混 | 坐标语义以 pdftoppm 实拍 + 逐格数据交叉验证（RTL col1=最右） |
| 卷尾题（論語卷第一）不匹配原 colophon 规则 | precleanModern ④ 增量 `^.{0,8}卷第[一二三四五六七八九十百]+$` |
| 篇题锚异体失配：格串为正体「為政」（qwen 输出+VARIANT_MAP 爲→為），登记原刻「爲政」 | deriveAnchors 已生成「原字形｜归一字形」双写 alternation，登记可写原刻；section.name 会取匹配文本（正体），原刻字形保留属 fixes 阶段 |
| 影印本同一版面重复拍摄（论语 p40/p41，G2b extra 单页飙高为信号） | layout.json specialPages 登记 `kind:dupPage, dupOf:N`，loadBaseGrid 装载时跳过副本（不改基础层文件）；先逐字比对两页文本+OCR md 确认 |
| `npm run build -- --work=x` 在 PowerShell 下 --work 丢失致全量构建 | 用 `node tools/cli.js build --work=x --only=html` 直调；PS 会把 stderr 字体回退警告包装成 ExitCode 1 假象，以「构建完成」文本为准 |
| 分卷书各卷共用 workId → 后卷追加页改变全书指纹，前卷裁决链作废 | 每卷独立 workId + `works[].inputBook` 指回原书目录（io.inputBookOf）；新增调用点务必同步包 inputBookOf |
| 儒藏论语篇名兼作页眉 → 硬锚不配对（卷二硬锚 0） | 无需处理：软锚兑底质量同量级（观测项，非坑） |

## 已知边界（勿越）

- extra/missing（衍/夺候选）不请四官，以书影为据（T3 视觉复核通道未建）。
- suspended 复议闭环未建；fixes 未清零可出口但需在验收报告标注。
- G5 标准出口为 grid.yaml（songke-facsimile 影刻直出）；旧 songke 引擎用 grid-export.js 产 text.yaml（见附录）。
- meta/seals/ornaments 手工维护；善本点校本.md / 校勘记.md 二期。

## 附录：旧 songke 引擎 G5（grid-export.js → text.yaml）

仅用于 `layout: songke` 的旧版宋版善刻作品，不再作为新作品的标准出口：

```powershell
# G5 旧出口（songke 引擎：sections[].blocks[]{type:j|z, text}）
node collation/tools/grid-export.js <书> <新作品id>
npm run validate -- --work=<新作品id> && npm run build -- --work=<新作品id> --only=html
```
