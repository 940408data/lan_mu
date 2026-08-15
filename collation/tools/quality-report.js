#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { align } = require('../src/align');
const { buildQualityReport } = require('../src/quality');
const { publicWorkDir } = require('../src/paths');

const args = process.argv.slice(2);
const flags = {}, pos = [];
for (const a of args) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) flags[m[1]] = m[2] ?? true;
  else pos.push(a);
}
const workId = pos[0];
if (!workId) {
  console.error('用法: node collation/tools/quality-report.js <书名> [--write]');
  process.exit(1);
}

const report = buildQualityReport(align(workId));
if (flags.write) {
  const file = path.join(publicWorkDir(workId), 'quality-report.json');
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`✓ 质量报告：${file}`);
}
console.log(JSON.stringify(report, null, 2));
if (report.status === 'draft') process.exitCode = 2;
