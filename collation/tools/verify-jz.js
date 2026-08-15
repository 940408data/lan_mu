#!/usr/bin/env node
/**
 * collation · M3 核验（tools/verify-jz.js）：用兰木已有经注结构（works/<id>/text.yaml）作
 * ground truth，量化"视觉判定经注"的准确率——判读该方法效果，供推广到其他无现成结构的古籍。
 *
 * 原理：视觉判定给每列 {text,type:j|z}。把 works 的经文字串 J、注文字串 Z 作基准，
 *   对该列文字做归属判定（连续子串优先、字级投票兜底），得"真实"经/注，与视觉判定比对。
 *
 * 用法: node collation/tools/verify-jz.js <workId> [--jz=jz.json]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const args = process.argv.slice(2);
const flags = {}, pos = [];
for (const a of args) { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) flags[m[1]] = m[2] ?? true; else pos.push(a); }
const workId = pos[0];
if (!workId) { console.error('用法: node collation/tools/verify-jz.js <workId>'); process.exit(1); }

// works 兰木经注结构（ground truth）
const textYaml = YAML.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'works', workId, 'text.yaml'), 'utf8'));
let J = '', Z = '';
for (const sec of textYaml.sections || []) for (const b of sec.blocks || []) {
  const t = (b.text || '').replace(/[，。！？；：、""''「」『』《》（）○\s]/g, '');
  if (b.type === 'j') J += t; else Z += t;
}
const jzPath = flags.jz || path.join(__dirname, '..', 'data', workId, 'jz.json');
const jz = JSON.parse(fs.readFileSync(jzPath, 'utf8'));

function canon(s) { return (s || '').replace(/[，。！？；：、""''「」『』《》（）○\s〔〕？?]/g, ''); }
/** 判一列真实归属：连续子串命中 J→j、Z→z；否则字级投票 */
function truthType(colText) {
  const t = canon(colText);
  if (!t) return null;
  if (t.length >= 4) {
    if (J.includes(t)) return 'j';
    if (Z.includes(t)) return 'z';
  }
  let jv = 0, zv = 0;
  for (const c of t) { if (J.includes(c)) jv++; if (Z.includes(c)) zv++; }
  if (jv === 0 && zv === 0) return null;
  return jv >= zv ? 'j' : 'z';
}

let total = 0, right = 0, unknown = 0;
const wrong = [];
for (const pg of jz.pages || []) {
  for (const col of pg.cols || []) {
    const truth = truthType(col.text);
    if (!truth) { unknown++; continue; }
    total++;
    if (col.type === truth) right++;
    else wrong.push({ page: pg.n, col: col.col, vis: col.type, truth, text: canon(col.text).slice(0, 14) });
  }
}
console.log(`视觉判定核验（基准 works/${workId} 兰木经注结构）：`);
console.log(`  判定列数 ${total}，正确 ${right}，错误 ${wrong.length}，无法判定 ${unknown}`);
console.log(`  准确率 ${total ? (right / total * 100).toFixed(1) : 0}%`);
if (wrong.length) {
  console.log(`  误判明细（前15）:`);
  wrong.slice(0, 15).forEach(w => console.log(`    p${w.page}列${w.col} 视判${w.vis} 实为${w.truth} | ${w.text}`));
}
