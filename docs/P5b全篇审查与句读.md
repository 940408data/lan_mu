# P5-b 全篇审查与句读

P5-b 不是让模型直接重写古籍正文，而是先做全篇质量审查，再提出可追溯的句读建议。

## 流程

```text
b1 确定性结构扫描 → b2 LLM 全篇审查 → b3 LLM 句读建议 → 校验/人工确认 → P6 出具
```

### b1 确定性扫描

扫描 orphan、低分对齐、相邻重叠、同一页/行/region 重复消费、M2 pending 和来源 hash。
重复或底本溯源冲突是阻断级问题，不能用模型语感直接修正文。

### b2 全篇模型审查

按 1,200–2,000 字分块并保留邻块重叠。模型只读取清洗后的善本字串与来源元数据，
不发送现代本连续正文、裁决 JSON 或精校台内容。输出 finding、严重等级、置信度和修复建议，
不输出 patch。

```bash
node collation/tools/review-full.js 大学章句 --llm --write
node collation/tools/review-full.js 中庸章句 --llm --write
```

结果写入 `input_data/<书名>/_derived/collation/full-review.json`；公开
`quality-report.json` 只保留分数和数量摘要。

### b3 句读建议

模型只返回“在原字第 N 位插入何标点”的操作。字符骨架、标点白名单、括号配对和重复标点检查
全部通过后，才可标记为 approved；模型不可以补字、删字、改异体或调整校勘判断。

```bash
node collation/tools/punctuate-llm.js 大学章句 --apply
node collation/run.js 大学章句 --step=export
```

`--apply` 只写入私有 `punctuation-llm.json`，P6 出具时按当前 M2 hash 验证后应用。
底本或上游文本变化会使旧建议自动失效。

## 评分与发布闸

质量报告拆为完整性、对齐、底本溯源和句读四项。存在未解决的重复、M2 pending 或 hash 冲突时，
状态不得超过 `blocked/draft`。模型的语义分数只能作为审查线索，不能抵消结构性阻断。

例如《大学》`seg14/15` 的“聖而不得君師之位以行”重复，因两段来自同一 `p4-r001`，
被标为 blocker；必须回到书影和对齐环节处理，不能直接让模型删掉其中一段。

## 产物

- `full-review.json`：全篇问题、严重度、评分和来源。
- `punctuation-llm.json`：标点操作、输入 hash、模型、置信度和应用状态。
- `quality-report.json`：面向审阅的摘要，不含现代本连续文本。

