#!/usr/bin/env node
/**
 * 将另一工作树的视觉覆校意见安全合并到当前工作树。
 *
 * 只允许合并与 source pending-verify 逐项匹配的记录；不复制 shanben-v2
 * 或任何下游产物。用于网络/执行器中断后，把已完成的模型覆校意见迁移到
 * 同一 recollate 输入上，再由当前分支的 build-v2 重新生成 M2。
 *
 * 用法：
 *   node collation/tools/merge-verify-report.js <书名> \
 *     --report=/path/verify-report.json \
 *     --pending=/path/pending-verify.json
 */
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const flags = {}, pos = [];
for (const a of args) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) flags[m[1]] = m[2] ?? true;
  else pos.push(a);
}
const workId = pos[0];
if (!workId || !flags.report || !flags.pending) {
  console.error('用法：node collation/tools/merge-verify-report.js <书名> --report=FILE --pending=FILE');
  process.exit(1);
}
const dataDir = path.join(__dirname, '..', 'data', workId);
const targetReport = path.join(dataDir, 'verify-report.json');
const sourceReport = JSON.parse(fs.readFileSync(path.resolve(String(flags.report)), 'utf8'));
const sourcePending = JSON.parse(fs.readFileSync(path.resolve(String(flags.pending)), 'utf8'));
const current = fs.existsSync(targetReport) ? JSON.parse(fs.readFileSync(targetReport, 'utf8')) : [];
if (!Array.isArray(sourceReport) || !Array.isArray(sourcePending) || !Array.isArray(current)) {
  throw new Error('report/pending 必须是 JSON 数组');
}
const key = x => `${x.page}:${x.ai}`;
const sourceMap = new Map(sourcePending.map(x => [key(x), x]));
const imported = [];
for (const row of sourceReport) {
  const p = sourceMap.get(key(row));
  if (!p || p.old !== row.old || p.vis !== row.vis || p.ctx !== row.ctx) {
    throw new Error(`来源记录未通过 pending 一致性校验：${key(row)}`);
  }
  // 空 char 是旧报告的 JSON 解析缺陷；备注明确说“确为旧字”时，
  // 只把它规范为维持旧字，不把模型意见升级成改字。
  const normalized = { ...row };
  if (!normalized.char && normalized.note && /确为|确系|实为/.test(normalized.note)) {
    normalized.char = normalized.old;
    normalized.changed = false;
    normalized.verdict = 'confirmed-old';
    normalized.note = `${normalized.note}（来源报告空 char，按备注维持旧字）`;
  }
  if (typeof normalized.char !== 'string' || [...normalized.char].length !== 1) {
    throw new Error(`来源记录实字不是单字：${key(row)} char=${JSON.stringify(normalized.char)}`);
  }
  normalized.source = 'validated-report-import';
  imported.push(normalized);
}

const merged = new Map(current.map(x => [key(x), x]));
for (const row of imported) merged.set(key(row), row);
const out = [...merged.values()].sort((a, b) => Number(a.page) - Number(b.page) || Number(a.ai) - Number(b.ai));
fs.writeFileSync(targetReport, JSON.stringify(out, null, 2));
console.log(`✓ 合并 ${imported.length} 条视觉覆校意见；累计报告 ${out.length} 条`);
console.log('  仅更新 verify-report.json；shanben-v2 与 pending 将由当前分支 build-v2 重建');
