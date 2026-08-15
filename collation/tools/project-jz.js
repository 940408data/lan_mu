#!/usr/bin/env node
/**
 * collation · M3 备援：经注投影判定（tools/project-jz.js）
 * 适用：版面无经注空间区分的刻本（如中庸晋府本——经注同顶格同大字，顶格/退格规则失效）。
 * 原理：以既有 works 的经注结构为语料，对 grid.json 每列文字做归一化 LCS 覆盖率比对，
 *       列文字落入经文语料者多 → j，落入注文语料者多 → z；覆写 grid.json 的 type（保留实测 start）。
 * 注意：此法依赖既有结构（非独立视觉判定），校勘记/文档须注明；版面无区分可验时方为正当。
 *
 * 用法: node collation/tools/project-jz.js <书名> --works=zhongyong [--write]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { normChar } = require('../src/align');

const args = process.argv.slice(2);
const flags = {}, pos = [];
for (const a of args) { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) flags[m[1]] = m[2] ?? true; else pos.push(a); }
const workId = pos[0];
const worksId = flags.works;
if (!workId || !worksId) { console.error('用法: node collation/tools/project-jz.js <书名> --works=<既有作品id> [--write]'); process.exit(1); }

const gridPath = path.join(__dirname, '..', 'data', workId, 'grid.json');
const grid = JSON.parse(fs.readFileSync(gridPath, 'utf8'));
const textYaml = YAML.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'works', worksId, 'text.yaml'), 'utf8'));

// 经/注语料（归一化连串）
let jCorpus = '', zCorpus = '';
for (const sec of textYaml.sections || []) {
  for (const b of sec.blocks || []) {
    const t = [...(b.text || '')].map(normChar).join('');
    if (b.type === 'j') jCorpus += t; else zCorpus += t;
  }
}

/** LCS 长度（逐字 DP，输入已归一） */
function lcs(a, b) {
  if (!a || !b) return 0;
  const dp = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const t = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = t;
    }
  }
  return dp[b.length];
}

let j = 0, z = 0, tie = 0;
const rows = [];
for (const pg of grid.pages) {
  for (const c of pg.cols) {
    const t = [...(c.text || '')].map(normChar).join('');
    if (!t) continue;
    const sj = lcs(t, jCorpus) / t.length;
    const sz = lcs(t, zCorpus) / t.length;
    const type = sj === sz ? (c.type || 'z') : (sj > sz ? 'j' : 'z');   // 持平保视觉原判
    if (sj === sz) tie++;
    rows.push({ page: pg.n, col: c.col, len: t.length, sj: +sj.toFixed(2), sz: +sz.toFixed(2), from: c.type, to: type });
    if (flags.write) c.type = type;
    type === 'j' ? j++ : z++;
  }
}
if (flags.write) {
  grid.method = '投影判定（project-jz）：版面无经注空间区分，以 works/' + worksId + ' 结构语料 LCS 投影；start 仍为空格实测';
  fs.writeFileSync(gridPath, JSON.stringify(grid, null, 2));
}
const changed = rows.filter(r => r.from !== r.to).length;
console.log(`投影判定：${rows.length} 列 → 经 ${j} / 注 ${z}（改判 ${changed}，持平保原判 ${tie}）${flags.write ? '【已写入 grid.json】' : '【dry-run】'}`);
for (const r of rows.filter(r => r.sj < 0.6 && r.sz < 0.6).slice(0, 10)) {
  console.log(`  低覆盖 p${r.page}列${r.col} j=${r.sj} z=${r.sz}（可能为题跋/序文，语料外）`);
}
