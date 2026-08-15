#!/usr/bin/env node
/** P1.5 清洗命令：默认只打印摘要；--write 写善本公开产物、现代本私有产物与公开统计。 */
'use strict';

const fs = require('fs');
const path = require('path');
const { cleanWork, publicSummary } = require('../src/cleanup');
const { INPUT_DATA } = require('../src/io');

const args = process.argv.slice(2);
const flags = {}, pos = [];
for (const a of args) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) flags[m[1]] = m[2] ?? true;
  else pos.push(a);
}
const workId = pos[0];
if (!workId) {
  console.error('用法: node collation/tools/clean.js <书名> [--write]');
  process.exit(1);
}

const cleaned = cleanWork(workId);
const summary = publicSummary(cleaned);

if (flags.write) {
  const publicDir = path.join(__dirname, '..', 'data', workId, 'clean');
  const privateDir = path.join(INPUT_DATA, workId, '_derived', 'clean');
  fs.mkdirSync(publicDir, { recursive: true });
  fs.mkdirSync(privateDir, { recursive: true });
  fs.writeFileSync(path.join(publicDir, 'shanben-clean.json'), JSON.stringify(cleaned.shanben, null, 2));
  fs.writeFileSync(path.join(publicDir, 'cleanup-report.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(privateDir, 'xiandai-clean.json'), JSON.stringify(cleaned.xiandai, null, 2));
  console.log(`✓ 善本清洗：${path.join(publicDir, 'shanben-clean.json')}`);
  console.log(`✓ 现代本清洗（私有）：${path.join(privateDir, 'xiandai-clean.json')}`);
  console.log(`✓ 公开统计：${path.join(publicDir, 'cleanup-report.json')}`);
}

console.log(JSON.stringify(summary, null, 2));
if (!cleaned.shanben.quality.publishable || !cleaned.xiandai.quality.publishable) process.exitCode = 2;
