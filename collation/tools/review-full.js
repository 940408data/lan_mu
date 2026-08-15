#!/usr/bin/env node
/**
 * P5-b 全篇审查入口。
 *
 * 用法：
 *   node collation/tools/review-full.js 大学章句 [--llm] [--write] [--conc=2]
 * 默认只做确定性扫描；--llm 才调用真实模型。任何结果都只写审查报告，
 * 不会直接修改 M2、对齐或公开正文。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { align } = require('../src/align');
const { buildQualityReport } = require('../src/quality');
const { engine } = require('../src/llm');
const { privatePath, publicPath } = require('../src/paths');
const { buildReview, llmReview, mergeReview } = require('../src/full-review');

const args = process.argv.slice(2);
const flags = {}, pos = [];
for (const a of args) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) flags[m[1]] = m[2] ?? true;
  else pos.push(a);
}
const workId = pos[0];
if (!workId) {
  console.error('用法: node collation/tools/review-full.js <书名> [--llm] [--write] [--conc=2]');
  process.exit(1);
}

(async () => {
  const result = align(workId);
  let report = buildReview(result);
  console.log(`〔P5-b〕${workId} 确定性扫描：${report.deterministic.findings.length} 条问题，content=${report.scores.content}，status=${report.scores.status}`);

  if (flags.llm) {
    if (engine === 'mock' && !flags['allow-mock']) {
      throw new Error('当前没有真实 LLM 引擎；禁止把 mock 审查当正式结果。需要 --allow-mock 才能仅做测试。');
    }
    const model = await llmReview(result, {
      conc: Math.max(1, parseInt(flags.conc || '2', 10)),
      maxChars: Math.max(600, parseInt(flags['max-chars'] || '1800', 10)),
      onProgress: (i, n, x) => console.log(`  LLM 审查 ${i}/${n}：发现 ${x.findings.length} 条（${x.engine}）`),
    });
    if (model.fallbackCount && !flags['allow-fallback']) {
      throw new Error(`LLM 全篇审查有 ${model.fallbackCount}/${model.chunks} 个分块调用失败；未写入正式模型结论。若只需记录兜底结果，请显式加 --allow-fallback。`);
    }
    report = mergeReview(report, model);
    console.log(`✓ LLM 全篇审查：${model.chunks} 块，${model.findings.length} 条建议，model=${model.modelScore ?? 'n/a'}，fallback=${model.fallbackCount}`);
  }

  const reportPath = privatePath(workId, 'full-review.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  // 公开质量报告只保留摘要与数量，不写入模型详细理由或私有审查上下文。
  if (flags.write || flags.public) {
    const quality = buildQualityReport(result);
    quality.fullReview = {
      schemaVersion: report.schemaVersion,
      status: report.scores.status,
      contentScore: report.scores.content,
      modelScore: report.scores.model,
      modelConcernScore: report.scores.modelConcern,
      findingCount: report.findings.length,
      blockerCount: report.findings.filter(f => f.severity === 'blocker').length,
      highCount: report.findings.filter(f => f.severity === 'high').length,
      source: report.source,
    };
    fs.writeFileSync(publicPath(workId, 'quality-report.json'), JSON.stringify(quality, null, 2));
    console.log(`✓ 公开质量摘要：${publicPath(workId, 'quality-report.json')}`);
  }
  console.log(`✓ 私有全篇审查：${reportPath}`);
  for (const f of report.findings.filter(x => x.severity === 'blocker' || x.severity === 'high').slice(0, 20)) {
    console.log(`  [${f.severity}] ${f.id || f.kind} seg=${(f.segIds || []).join(',')} ${f.overlap ? `重叠「${f.overlap}」` : f.proposal || f.action || ''}`);
  }
  if (flags.strict && report.scores.status !== 'reviewed') process.exitCode = 2;
})().catch(e => { console.error('✗', e.message || e); process.exit(1); });
