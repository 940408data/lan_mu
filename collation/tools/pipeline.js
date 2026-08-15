#!/usr/bin/env node
/**
 * M2 之后的统一流水线入口。
 *
 * 用法：
 *   node collation/tools/pipeline.js <书名> --pages=2-40
 *
 * 前置：M2 已生成 shanben-v2.json；本命令从该新底本开始，依次执行
 * P1.5 清洗 → M3 经注网格（指定 --pages 时重跑）→ 经注分栏 → P3-P6 全链。
 * M2 pending-verify 不会被偷偷忽略，会进入质量报告并使状态保持 draft。
 */
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { loadM2Base } = require('../src/base');

const args = process.argv.slice(2);
const flags = {}, pos = [];
for (const a of args) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) flags[m[1]] = m[2] ?? true;
  else pos.push(a);
}
const workId = pos[0];
if (!workId) {
  console.error('用法: node collation/tools/pipeline.js <书名> --pages=2-40');
  process.exit(1);
}

const root = path.join(__dirname, '..');
const m2 = loadM2Base(workId);
console.log(`〔pipeline〕${workId} 从 M2 新底本开始：${m2.source || 'unknown'} sha256=${m2.sha256.slice(0, 12)} pending=${m2.pendingCount}`);

function run(script, scriptArgs) {
  const r = spawnSync(process.execPath, [path.join(__dirname, script), workId, ...scriptArgs], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
}

run('clean.js', ['--write']);

if (flags.pages) {
  run('judge-grid.js', [`--pages=${flags.pages}`, ...(flags.conc ? [`--conc=${flags.conc}`] : [])]);
} else if (flags.grid) {
  console.error('✗ --grid 需要 --pages=起止；不指定页范围不会偷偷复用旧 M3 结果');
  process.exit(1);
}

const gridFile = path.join(root, 'data', workId, 'grid.json');
if (flags.songke || flags.pages) {
  if (!require('fs').existsSync(gridFile)) {
    console.error('✗ M3 grid.json 不存在；请指定 --pages=起止');
    process.exit(1);
  }
  run('build-songke.js', []);
}

const collate = spawnSync(process.execPath, [path.join(root, 'run.js'), workId, '--step=all'], { stdio: 'inherit' });
process.exit(collate.status || 0);
