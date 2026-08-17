# G5 单一出口实施计划：grid-export.js

## 1. 目标与范围

**目标**：新建 `collation/tools/grid-export.js`，从「基础层 grid-transcribe.json + overlay(grid-overlay.json) + fixes」派生 `works/<id>/text.yaml`（songke 格式），实现 G5 单一出口。

**范围**（最小切口）：
- ✅ 只做 text.yaml 入库
- ⏸ 善本点校本.md / 校勘记.md 留待二期
- ✅ 旧 `build-works.js` / `export.js` 保留可跑，验收期对照用，验收后下线

**验收基线**：
- 大学：12 sections / ~6745 字（vs 旧 1 section / 6225 字缺序）
- 中庸：34 sections / ~14452 字（vs 旧 34 sections 但缺序+首章命名不一致）
- fixes 当前恒空，产出=纯基础层+overlay 派生基线；fixes 填入后重跑才体现改字

---

## 2. 数据模型验证（已读文件确认）

### 2.1 基础层 `collation/data/<书>/grid-transcribe.json`

```json
{
  "work": "大学章句",
  "base": { "file": "shanben-v2.json", "sha256": "...", "pendingVerify": 0 },
  "layout": { "cols": 16, "rows": 15 },
  "pages": [
    {
      "n": 2,
      "cells": [
        { "col": 1, "row": 1, "char": "大", "start": "頂格" },
        { "col": 1, "row": 2, "char": "學" },
        ...
      ]
    }
  ]
}
```

**关键字段**：
- `pages[].cells[]` = `{col, row, char, start?}`
- `start` 仅列首字有值（頂格/退一格/退两格）
- ○ 等符号格保留在 cells 但不进对齐 gridStr

### 2.2 overlay `collation/data/<书>/grid-overlay.json`

```json
{
  "schemaVersion": 1,
  "work": "大学章句",
  "base": { "file": "grid-transcribe.json", "sha256": "..." },
  "stats": { "pages": 35, "cells": 6780, "sections": 12, ... },
  "variants": { "oldOcr": {...}, "modern": {...} },
  "labels": [
    { "page": 2, "col": 1, "role": "j", "text": "大學章句序" },
    { "page": 2, "col": 2, "role": "j", "text": "大學之書古之大學所以教人之法也" },
    ...
  ],
  "sections": [
    {
      "id": "xu",
      "name": "序",
      "from": { "page": 2, "col": 1, "row": 1 },
      "to": { "page": 6, "col": 2, "row": 6 }
    },
    {
      "id": "jing",
      "name": "經一章",
      "from": { "page": 6, "col": 9, "row": 1 },
      "to": { "page": 10, "col": 9, "row": 6 }
    },
    ...
  ],
  "fixes": []
}
```

**关键字段**：
- `labels[]` = `{page, col, role, text}`；role 实际只 j/z/title（j=頂格经传大字、z=退格章句小字、title=章题列覆盖 j/z）
- `sections[]` = `{id, name, from:{page,col,row}, to:{page,col,row}}`（格坐标边界）
- `fixes[]`：kind:'sub' `{page,col,row,from,to,evidence,decidedAt}` + kind:'insert' `{page,after:{col,row},text,evidence,decidedAt}`

### 2.3 输出格式 `works/<id>/text.yaml`

```yaml
# 大学章句（当涂郡斋刊递修本·善本底）：j 为经传大字，z 为章句小字。版面结构先行：顶格经/退格注。
sections:
  - id: xu
    name: 序
    blocks:
      - { type: j, text: 大學章句序 }
      - { type: j, text: 大學之書古之大學所以教人之法也 }
      ...
  - id: jing
    name: 經一章
    blocks:
      - { type: j, text: 大學之道在明明德在親民在止於至善 }
      - { type: z, text: 程子曰親當作新○大學者大人之學也... }
      ...
```

**结构**：`sections[].blocks[]{type:j|z, text:连续字}`

---

## 3. 复用函数清单（勿重写）

| 函数 | 位置 | 职责 | G5 复用方式 |
|------|------|------|-------------|
| `loadBaseGrid(tr)` | `src/grid.js:58-75` | 基础层→flat 格序列+gridStr+strIdx | ✅ 直接调用，获取 pages/flat |
| `colsOfPage(page)` | `src/transcribe.js:10-27` | 逐格→列级聚合（j/z 判定单一事实源） | ⚠️ 部分复用：G5 用 overlay.labels 判定 role，但可参考其列内 row 排序逻辑 |
| `buildOverlay(workId, opts)` | `src/grid.js:318-390` | overlay 主入口 | ❌ 不直接调用（G5 消费已生成的 overlay.json，不重新跑对齐） |
| blocks 派生 | `tools/build-works.js:68-79` | 列级连续同 type 合并 | ❌ 逻辑重写（G5 用 overlay.labels + section.from/to 精确界） |
| sections 派生 | `tools/build-works.js:82-107` | 文本 match 切节 | ❌ 逻辑重写（G5 直接消费 overlay.sections） |
| fixes 写入逻辑 | `tools/grid-review-merge.js:38-64` | fixMap/insertAfter 构建 | ✅ 反向即消费逻辑：`fixMap[p:c:r]=to`、`insertAfter[p:c:r]=text` |
| text.yaml 写出 | `tools/build-works.js:117-122` | 内联字符串拼接 | ✅ 复用格式（非 yaml.stringify） |
| meta/expect 产出 | `tools/build-works.js:109-135` | 字数统计+meta 模板 | ⚠️ 二期考虑；最小切口只 text.yaml |

---

## 4. grid-export.js 函数分解

### 4.1 主入口 `exportWork(workId, newId, opts)`

**职责**：CLI 入口，装载数据→派生→写出

**伪码**：
```javascript
function exportWork(workId, newId, opts = {}) {
  const dataDir = path.join(__dirname, '..', 'data', workId);
  const trFile = path.join(dataDir, 'grid-transcribe.json');
  const ovFile = path.join(dataDir, 'grid-overlay.json');
  
  // 1. 装载基础层+overlay
  const tr = JSON.parse(fs.readFileSync(trFile, 'utf8'));
  const ov = JSON.parse(fs.readFileSync(ovFile, 'utf8'));
  const base = loadBaseGrid(tr);
  
  // 2. 构建 fixes 索引（幂等消费）
  const fixMap = new Map();      // "p:c:r" -> to
  const insertAfter = new Map(); // "p:c:r" -> text
  for (const f of ov.fixes || []) {
    if (f.kind === 'sub') fixMap.set(`${f.page}:${f.col}:${f.row}`, f.to);
    else if (f.kind === 'insert') insertAfter.set(`${f.page}:${f.after.col}:${f.after.row}`, f.text);
  }
  
  // 3. 构建 label 索引
  const labelMap = new Map(); // "p:c" -> role
  for (const l of ov.labels || []) labelMap.set(`${l.page}:${l.col}`, l.role);
  
  // 4. 逐 section 派生 blocks
  const sections = [];
  for (const sec of ov.sections || []) {
    const cells = cellsInRange(base, sec.from, sec.to);
    const blocks = deriveBlocks(cells, labelMap, fixMap, insertAfter);
    sections.push({ id: sec.id, name: sec.name, blocks });
  }
  
  // 5. 写出 text.yaml
  const textYaml = renderTextYaml(workId, sections);
  const outDir = path.join(__dirname, '..', '..', 'works', newId);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'text.yaml'), textYaml);
  
  // 6. 统计输出
  const jChars = sections.flatMap(s => s.blocks).filter(b => b.type === 'j').reduce((s, b) => s + countTokens(b.text), 0);
  const zChars = sections.flatMap(s => s.blocks).filter(b => b.type === 'z').reduce((s, b) => s + countTokens(b.text), 0);
  console.log(`✓ works/${newId}/text.yaml：${sections.length} sections，${sections.reduce((s, sec) => s + sec.blocks.length, 0)} blocks（经字 ${jChars} / 注字 ${zChars}）`);
}
```

### 4.2 核心函数 `cellsInRange(base, from, to)`

**职责**：按 (page,col) 升序、列内 row 升序遍历取 from..to 闭区间；跨页跨列正确切片；section 边界落在列中间不吞整列

**伪码**：
```javascript
function cellsInRange(base, from, to) {
  const result = [];
  
  // 遍历所有页（base.pages 已按 page 升序）
  for (const pg of base.pages) {
    // 页范围过滤：只处理 from.page <= pg.n <= to.page
    if (pg.n < from.page || pg.n > to.page) continue;
    
    // 遍历列内 cells（已按 col 升、列内 row 升序）
    for (const c of pg.cells) {
      // 坐标比较函数
      const cmp = (a, b) => {
        if (a.page !== b.page) return a.page - b.page;
        if (a.col !== b.col) return a.col - b.col;
        return a.row - b.row;
      };
      
      // 闭区间 [from, to]
      if (cmp(c, from) >= 0 && cmp(c, to) <= 0) {
        result.push(c);
      }
    }
  }
  
  return result;
}
```

**边界处理**：
- 跨页 section（如 xu: p2c1r1 → p6c2r6）：遍历 p2/p3/p4/p5/p6，每页只取 [from, to] 范围内的格
- 边界落在列中间（如 from=p2c1r1, to=p6c2r6）：比较函数 `(page,col,row)` 三级排序，精确到格级切片，不吞整列
- 空 char 格：`loadBaseGrid` 已 filter 掉 `char.trim().length === 0` 的格，无需额外处理

### 4.3 块派生函数 `deriveBlocks(cells, labelMap, fixMap, insertAfter)`

**职责**：cells 按连续同 role 合并为 blocks；title 列不入 blocks；○ 在 j 跳过、在 z 保留；fixes 应用

**伪码**：
```javascript
function deriveBlocks(cells, labelMap, fixMap, insertAfter) {
  const blocks = [];
  let cur = null; // { type, text }
  
  for (const c of cells) {
    const key = `${c.page}:${c.col}`;
    const role = labelMap.get(key);
    
    // title 列不入 blocks（section.name 已含章名）
    if (role === 'title') continue;
    
    // 应用 fixes：sub 覆盖 char
    let ch = fixMap.get(`${c.page}:${c.col}:${c.row}`) || c.char;
    
    // ○ 处理：j 跳过，z 保留作段落分隔
    if (!ch || ch === '○') {
      if (role === 'j') continue;
      // z 保留 ○（如"○大學者…"）
    }
    
    // 连续同 role 合并
    if (cur && cur.type === role) {
      cur.text += ch;
    } else {
      if (cur) blocks.push(cur);
      cur = { type: role, text: ch };
    }
    
    // 应用 fixes：insert 补夺文
    const insKey = `${c.page}:${c.col}:${c.row}`;
    if (insertAfter.has(insKey)) {
      cur.text += insertAfter.get(insKey);
    }
  }
  
  if (cur) blocks.push(cur);
  return blocks;
}
```

**关键点**：
- title 列完全跳过（不产生 block）
- ○ 在 j 列跳过（不进 text），在 z 列保留（作段落分隔符）
- fixes 应用顺序：先 sub 覆盖 char，再 insert 补夺文（insertAfter 在当前格之后追加）
- 连续同 role 合并：相邻格 role 相同则 text 拼接，否则开新 block

### 4.4 字数统计函数 `countTokens(text)`

**职责**：引擎按 tokens 计字（句读和排版括号不占字格）

**实现**：直接复用 `build-works.js:112-113`

```javascript
const NON_TOKENS = new Set([...'。！？？，、；：「」『』（）〈〉—·']);
const countTokens = text => [...text].filter(ch => !NON_TOKENS.has(ch)).length;
```

### 4.5 文本渲染函数 `renderTextYaml(workId, sections)`

**职责**：生成 text.yaml 内联字符串（非 yaml.stringify）

**实现**：复用 `build-works.js:117-122` 格式

```javascript
function renderTextYaml(workId, sections) {
  let yaml = `# ${workId}（当涂郡斋刊递修本·善本底）：j 为经传大字，z 为章句小字。版面结构先行：顶格经/退格注。\nsections:\n`;
  for (const sec of sections) {
    yaml += `  - id: ${sec.id}\n    name: ${sec.name}\n    blocks:\n`;
    for (const b of sec.blocks) {
      yaml += `      - { type: ${b.type}, text: ${b.text} }\n`;
    }
  }
  return yaml;
}
```

---

## 5. CLI 入口与参数

```javascript
#!/usr/bin/env node
/**
 * collation · G5 单一出口：基础层+overlay+fixes → works/<id>/text.yaml
 * 
 * 用法: node collation/tools/grid-export.js <书名> <新作品id>
 *   例: node collation/tools/grid-export.js 大学章句 daxue-songben
 *       node collation/tools/grid-export.js 中庸章句 zhongyong-songben
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { loadBaseGrid } = require('../src/grid');

const args = process.argv.slice(2);
const [workId, newId] = args;
if (!workId || !newId) {
  console.error('用法: node collation/tools/grid-export.js <书名> <新作品id>');
  process.exit(1);
}

exportWork(workId, newId);
```

---

## 6. 输出文件

**主产物**：
- `works/<newId>/text.yaml`：songke 格式，sections[].blocks[]{type, text}

**二期扩展**（本次不做）：
- `works/<newId>/meta.yaml`：沿用 build-works.js:124-135 模板逻辑
- `works/<newId>/seals.yaml` / `ornaments.yaml`：从 base 作品复制
- `works/<newId>/善本点校本.md`：G5b 派生
- `works/<newId>/校勘记.md`：G4 输出

**最小切口决策**：
- ✅ 本次只产 text.yaml
- ⏸ meta.yaml 等沿用旧 build-works.js 产出（如有需要可手动跑旧脚本补产）
- ⏸ 验收后 G5 可扩 meta/expect 产出（二期）

---

## 7. 验收步骤

### 7.1 基线对照（fixes 恒空）

**大学章句**：
```bash
# 1. 跑 G5 新脚本
node collation/tools/grid-export.js 大学章句 daxue-songben-g5

# 2. 对比 section 数
grep -c "^  - id:" works/daxue-songben-g5/text.yaml  # 应=12
grep -c "^  - id:" works/daxue-songben/text.yaml     # 现=1

# 3. 对比字数
node -e "const fs=require('fs'); const yaml=require('yaml');
const t1=yaml.parse(fs.readFileSync('works/daxue-songben/text.yaml','utf8'));
const t2=yaml.parse(fs.readFileSync('works/daxue-songben-g5/text.yaml','utf8'));
const count=t=>t.sections.flatMap(s=>s.blocks).reduce((s,b)=>s+b.text.length,0);
console.log('旧:', count(t1), '新:', count(t2));"
# 应≈ 旧6225 vs 新6745（新含序）

# 4. 逐 section 检查
grep "^  - id:" works/daxue-songben-g5/text.yaml
# 应输出：xu, jing, zhuan1..zhuan10（共12个）
```

**中庸章句**：
```bash
# 1. 跑 G5 新脚本
node collation/tools/grid-export.js 中庸章句 zhongyong-songben-g5

# 2. 对比 section 数
grep -c "^  - id:" works/zhongyong-songben-g5/text.yaml  # 应=34
grep -c "^  - id:" works/zhongyong-songben/text.yaml     # 现=34

# 3. 检查首节
head -10 works/zhongyong-songben-g5/text.yaml
# 应输出：xu（序）, zhang1（首章）, zhang2..zhang33

# 4. 对比字数
# 应≈ 旧14452 vs 新14452（含序后略增）
```

### 7.2 逐块 diff（可选）

```bash
# 用 diff 工具对比 blocks
node -e "
const fs=require('fs'); const yaml=require('yaml');
const t1=yaml.parse(fs.readFileSync('works/daxue-songben/text.yaml','utf8'));
const t2=yaml.parse(fs.readFileSync('works/daxue-songben-g5/text.yaml','utf8'));
const blocks=t=>t.sections.flatMap(s=>s.blocks.map(b=>s.id+':'+b.type+':'+b.text.slice(0,20)));
const b1=blocks(t1), b2=blocks(t2);
console.log('旧 blocks:', b1.length, '新 blocks:', b2.length);
console.log('新前5:', b2.slice(0,5));
"
```

### 7.3 fixes 填入后重跑（二期）

```bash
# 1. 人工精校台导出裁决 JSON
# 2. 合入 fixes
node collation/tools/grid-review-merge.js 大学章句 --file=精校裁决-大学章句.json --write
# 3. 重跑 G5
node collation/tools/grid-export.js 大学章句 daxue-songben
# 4. 对比改字
git diff works/daxue-songben/text.yaml
```

---

## 8. 边界情况处理

### 8.1 大学 p4/p25 重叠区

**问题**：§5 短板，G2 重跑前残留

**处理**：
- `cellsInRange` 按坐标严格切片，重叠区格只取一次（from<=cell<=to）
- 如重叠区格有 fixes，fixMap 幂等覆盖（同坐标只保留最新 fix）
- 验收时重点检查 p4/p25 的 section（zhuan5/zhuan6）字数是否异常

### 8.2 缺页（大学 p37-40 题跋/刊记）

**问题**：非标准页，sections 是否覆盖到？

**处理**：
- 检查 overlay.sections 的 to 坐标：大学最后 section（zhuan10）的 to 应<=p36
- 如 p37-40 不在任何 section 范围内，`cellsInRange` 自然跳过（不报错）
- 验收时确认 zhuan10 结束位置："讀者不可以其近而忽之也"（应在 p36 或更早）

### 8.3 title 列处理

**问题**：text.yaml sections[].name 已含章名（如"傳之二章"），blocks 是否完全不收 title 列字？

**验证**：
```bash
# 检查现有 text.yaml 是否含 title 列文字
grep "右經一章\|右傳之" works/daxue-songben/text.yaml | head -5
# 如发现 title 列文字嵌入 z block（如"右傳之首章釋明明德"在 z text 内），
# 说明旧 build-works.js 未过滤 title 列
```

**处理**：
- G5 `deriveBlocks` 严格过滤 `role === 'title'`（不产生 block）
- section.name 已含章名（overlay.sections[i].name），无需 title 列文字
- 验收时确认新 text.yaml 无"右經一章"等 title 列文字嵌入 blocks

### 8.4 ○ 在 z 列保留

**问题**：○ 在 z 列如何呈现？

**验证**：
```bash
# 检查现有 text.yaml 的 z block 中 ○ 呈现
grep "○" works/daxue-songben/text.yaml | head -3
# 应见如"○大學者…"格式
```

**处理**：
- G5 `deriveBlocks`：z 列遇 ○ 保留（作段落分隔符）
- j 列遇 ○ 跳过（不进 text）
- 验收时确认 z block 中 ○ 保留、j block 中 ○ 缺失

---

## 9. 二期扩展点

### 9.1 fixes 填入后重跑

**现状**：fixes 恒空，产出=纯基础层+overlay 派生基线

**扩展**：
- 人工精校台（P5）产出裁决 JSON
- `grid-review-merge.js` 合入 fixes（kind:'sub' / kind:'insert'）
- G5 重跑：`fixMap` / `insertAfter` 索引生效，改字/补夺文体现在 text.yaml

### 9.2 meta.yaml / expect 产出

**现状**：最小切口只 text.yaml

**扩展**：
- 复用 `build-works.js:124-135` 逻辑
- 从 base 作品（如 daxue）复制 meta 模板，改 id/title/book/expect
- expect.chars/jChars/zChars 由 G5 统计产出

### 9.3 善本点校本.md

**扩展**：
- G5b 派生：基础层+overlay+fixes → 连续文本 + 句读
- 输入：`text.yaml` blocks → 拼接为连续文本
- 句读：`punctuate-llm.js`（P5b）作用于连续文本
- 输出：`works/<id>/善本点校本.md`

### 9.4 校勘记.md

**扩展**：
- G4 输出：`overlay.variants` 的"异"集合 + fixes → 校勘记条目
- 每条校勘记：格坐标 (page,col,row) + grid/oldOcr/modern + 裁决结果
- 输出：`works/<id>/校勘记.md`

---

## 10. 实施检查清单

### 10.1 代码实现

- [ ] 新建 `collation/tools/grid-export.js`
- [ ] 实现 `exportWork(workId, newId)` 主入口
- [ ] 实现 `cellsInRange(base, from, to)` 坐标切片
- [ ] 实现 `deriveBlocks(cells, labelMap, fixMap, insertAfter)` 块派生
- [ ] 复用 `countTokens(text)` 字数统计
- [ ] 复用 `renderTextYaml(workId, sections)` 文本渲染
- [ ] CLI 入口：`node collation/tools/grid-export.js <书名> <新作品id>`

### 10.2 验收测试

- [ ] 大学：12 sections / ~6745 字
- [ ] 中庸：34 sections / ~14452 字
- [ ] 逐 section 检查 id/name 正确
- [ ] 逐 block 检查 type/text 正确
- [ ] title 列不入 blocks
- [ ] ○ 在 j 跳过、在 z 保留
- [ ] fixes 恒空时产出=基线
- [ ] 与旧 text.yaml 逐块 diff（可选）

### 10.3 文档更新

- [ ] 更新 `docs/网格基流程重构方案.md`：G5 实施完成标记
- [ ] 更新 `docs/网格基重构-双书实施验收与量化评价.md`：验收数据
- [ ] README.md：新增 G5 使用说明

### 10.4 旧脚本下线（验收后）

- [ ] 下线 `tools/build-works.js`（保留 git 历史）
- [ ] 下线 `tools/build-songke.js` / `build-songke-transcribe.js`（如已合并到 G5）
- [ ] 更新 `docs/网格基流程重构方案.md`：路线 A/B 消失标记

---

## 11. 风险与缓解

### 11.1 风险

1. **cellsInRange 跨页切片错误**：边界落在列中间时可能吞整列或漏格
   - 缓解：严格三级比较 (page,col,row)，验收时逐 section 检查字数
2. **title 列误入 blocks**：overlay.labels 可能漏标 title
   - 缓解：验收时检查 text.yaml 是否含"右經一章"等 title 列文字
3. **fixes 索引冲突**：同坐标多个 fix 时 fixMap 覆盖顺序
   - 缓解：`grid-review-merge.js` 已保证幂等（同坐标覆盖旧条目）
4. **○ 处理不一致**：j/z 列 ○ 处理逻辑混淆
   - 缓解：验收时检查 z block 中 ○ 保留、j block 中 ○ 缺失

### 11.2 缓解

- **基线对照**：fixes 恒空时产出 vs 旧 text.yaml 逐块 diff
- **字数统计**：sections/blocks/chars 三维验收
- **逐块检查**：抽样检查 section id/name + block type/text
- **边界测试**：大学 p4/p25 重叠区、p37-40 缺页

---

## 12. 时间估算

| 任务 | 耗时 |
|------|------|
| 代码实现（grid-export.js） | 2-3 小时 |
| 验收测试（大学+中庸） | 1-2 小时 |
| 文档更新 | 0.5 小时 |
| 旧脚本下线 | 0.5 小时 |
| **总计** | **4-6 小时** |

---

## 13. 参考文件

- `collation/src/grid.js:58-75`：loadBaseGrid
- `collation/src/transcribe.js:10-27`：colsOfPage
- `collation/tools/build-works.js:68-79`：blocks 派生（旧）
- `collation/tools/build-works.js:82-107`：sections 派生（旧）
- `collation/tools/build-works.js:117-122`：text.yaml 写出
- `collation/tools/grid-review-merge.js:38-64`：fixes 写入逻辑
- `collation/data/大学章句/grid-transcribe.json`：基础层样例
- `collation/data/大学章句/grid-overlay.json`：overlay 样例
- `works/daxue-songben/text.yaml`：旧产出对照
- `docs/网格基流程重构方案.md`：G5 设计文档
