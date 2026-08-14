#!/usr/bin/env node
/**
 * 合并校书官 live 裁决（来自 Claude Code Agent 实跑）入 verdicts.json。
 * 用法:
 *   1) 把四官对 N 条异文的意见写 collation/tools/live-opinions.json（形如 {v62:[4意见],...}）
 *   2) node collation/tools/merge-live.js <书名>
 *   3) node collation/run.js <书名> --step=export   （用合并后 verdicts 出具双本）
 *
 * 聚合复用 src/officer.js 的 aggregate()；live 裁决标 _live:true, engine:'agent'。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { aggregate, OFFICER_NAME } = require('../src/officer');

const workId = process.argv[2];
const opinionsArg = process.argv[3] || 'live-opinions.json';
if (!workId) { console.error('用法: node collation/tools/merge-live.js <书名> [opinions文件]'); process.exit(1); }
const dir = path.join(__dirname, '..', 'data', workId);
const diffs = JSON.parse(fs.readFileSync(path.join(dir, 'diffs.json'), 'utf8'));
const verdicts = JSON.parse(fs.readFileSync(path.join(dir, 'verdicts.json'), 'utf8'));
const livePath = path.isAbsolute(opinionsArg) ? opinionsArg
  : (opinionsArg.includes('/') ? path.resolve(opinionsArg) : path.join(__dirname, opinionsArg));
const live = JSON.parse(fs.readFileSync(livePath, 'utf8'));
console.log(`读 opinions: ${livePath}`);

const vById = {}; diffs.forEach(v => vById[v.id] = v);
let replaced = 0;
for (const [vid, opinions] of Object.entries(live)) {
  const v = vById[vid];
  if (!v) { console.warn(`⚠ ${vid} 不在 diffs.json，跳过`); continue; }
  // opinions: 各官原始输出（含 adopt/candidate/reason/confidence/线索）
  const agg = aggregate(opinions, v);
  agg._live = true;
  agg.engine = 'agent';
  // 替换 verdicts 中同 id 条目
  const idx = verdicts.findIndex(x => x.diffId === vid);
  if (idx >= 0) { verdicts[idx] = agg; replaced++; }
  else verdicts.push(agg);
}
fs.writeFileSync(path.join(dir, 'verdicts.json'), JSON.stringify(verdicts, null, 2));
console.log(`✓ 合并 ${replaced} 条 live 裁决入 verdicts.json（共 ${verdicts.length} 条）`);
const res = verdicts.filter(v => v._live && v.verdict === 'resolved').length;
const susp = verdicts.filter(v => v._live && v.verdict === 'suspended').length;
console.log(`  live: resolved ${res}，suspended ${susp}`);
