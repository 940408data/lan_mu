#!/usr/bin/env node
/**
 * collation · M2 收尾：互证仲裁生成干净善本底本（tools/build-v2.js）
 * 两路 OCR（视觉重 OCR + 旧 OCR）编辑距离对齐后按规则仲裁：
 *   一致          → 采信（取旧 OCR 原字 = 善本原刻字形）
 *   视觉缺字(旧有视无) → 采旧（视觉关思考漏字是已知缺陷）
 *   视觉多字(视有旧无) → 舍（保守，防视觉幻觉）
 *   替换·异体(norm同)  → 采旧原字（善本古字形，**不归一、存原刻**）
 *   替换·真异(形义不同) → 若已有覆校结果(verify-report)则用善本实印字；否则暂采旧+列入待覆校
 *
 * 关键：**对齐用归一字（norm），输出用善本原刻字形（旧 OCR 原字）**——保善本古异体不丢。
 *
 * 用法: node collation/tools/build-v2.js <书名> [--in=recollate-1-40.json]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { VARIANT_MAP } = require('../src/align');
const { INPUT_DATA } = require('../src/io');

const args = process.argv.slice(2);
const flags = {}, pos = [];
for (const a of args) { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) flags[m[1]] = m[2] ?? true; else pos.push(a); }
const workId = pos[0];
if (!workId) { console.error('用法: node collation/tools/build-v2.js <书名> [--in=...]'); process.exit(1); }
const dataDir = path.join(__dirname, '..', 'data', workId);
const inFile = flags.in || fs.readdirSync(dataDir).filter(f => /^recollate-\d+-\d+\.json$/.test(f)).sort().pop();
const recollate = JSON.parse(fs.readFileSync(path.join(dataDir, inFile), 'utf8'));

// 覆校结果（若 verify-v2 已跑）：page:ai → 善本实印字。changed=true 用纠正字、false 用维持字（均为已决）
const verifyMap = {};
const vrPath = path.join(dataDir, 'verify-report.json');
if (fs.existsSync(vrPath)) {
  for (const r of JSON.parse(fs.readFileSync(vrPath, 'utf8'))) {
    if (r.char) verifyMap[`${r.page}:${r.ai}`] = r.char;
  }
}

const PUNCT = /[，。！？；：、""''「」『』《》（）○\s〔〕？?]/;
function normChar0(c) { return VARIANT_MAP[c] || (c.length > 1 ? '〓' : c); }
/** 归一为可比串，保留原字数组（orig）与归一串（norm） */
function canon(s) {
  const orig = [], nr = [];
  for (const ch of s) { if (PUNCT.test(ch)) continue; orig.push(ch); nr.push(normChar0(ch)); }
  return { orig, norm: nr.join('') };
}

/** 编辑距离 + 回溯，返回 ops：[{t:'='|'sub'|'del'|'ins', old, vis}]（old/vis 为归一串字符） */
function editOps(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    dp[i][j] = Math.min(dp[i-1][j-1] + (a[i-1]===b[j-1]?0:1), dp[i-1][j]+1, dp[i][j-1]+1);
  const ops = []; let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i-1] === b[j-1]) { ops.push({ t: '=', old: a[i-1], vis: b[j-1] }); i--; j--; }
    else if (dp[i][j] === dp[i-1][j-1] + 1) { ops.push({ t: 'sub', old: a[i-1], vis: b[j-1] }); i--; j--; }
    else if (dp[i][j] === dp[i-1][j] + 1) { ops.push({ t: 'del', old: a[i-1], vis: null }); i--; }
    else { ops.push({ t: 'ins', old: null, vis: b[j-1] }); j--; }
  }
  while (i > 0) { ops.push({ t: 'del', old: a[i-1], vis: null }); i--; }
  while (j > 0) { ops.push({ t: 'ins', old: null, vis: b[j-1] }); j--; }
  return ops.reverse();
}

const pages = [];
const pendingVerify = [];
let stat = { match: 0, variant: 0, ins: 0, del: 0, subVerify: 0, verified: 0 };
for (const p of recollate) {
  if (p.error || !p.visText) continue;
  const oldText = fs.readFileSync(path.join(INPUT_DATA, workId, '当涂郡本_ocr', `page_${String(p.page).padStart(4, '0')}.md`), 'utf8');
  const A = canon(oldText), B = canon(p.visText);
  const ops = editOps(A.norm, B.norm);
  let clean = '', ai = 0;
  for (const op of ops) {
    if (op.t === '=') { clean += A.orig[ai]; stat.match++; ai++; }
    else if (op.t === 'del') { clean += A.orig[ai]; stat.del++; ai++; }      // 视觉缺字→采旧原字
    else if (op.t === 'ins') { stat.ins++; }                                 // 视觉多字→舍
    else { // sub
      const key = `${p.page}:${ai}`;
      if (verifyMap[key]) { clean += verifyMap[key]; stat.verified++; }       // 覆校确认的善本实印字
      else if (normChar0(op.old) === normChar0(op.vis)) { clean += A.orig[ai]; stat.variant++; } // 异体→采旧原字(存善本古形)
      else { // 真异→暂采旧原字+待覆校
        clean += A.orig[ai]; stat.subVerify++;
        pendingVerify.push({ page: p.page, old: A.orig[ai], vis: op.vis, ai, ctx: A.norm.slice(Math.max(0, ai - 8), ai + 9) });
      }
      ai++;
    }
  }
  pages.push({ n: p.page, text: clean });
}
pages.sort((x, y) => x.n - y.n);
const out = { work: workId, source: inFile, stats: stat, pages };
fs.writeFileSync(path.join(dataDir, 'shanben-v2.json'), JSON.stringify(out, null, 2));
fs.writeFileSync(path.join(dataDir, 'pending-verify.json'), JSON.stringify(pendingVerify, null, 2));
console.log(`✓ 干净底本 shanben-v2.json：${pages.length} 页，${pages.reduce((s, p) => s + p.text.length, 0)} 字（存善本原刻字形）`);
console.log(`  仲裁：一致${stat.match} 异体存古${stat.variant} 视觉缺字采旧${stat.del} 视觉多字舍${stat.ins} 覆校实字${stat.verified} 待覆校${stat.subVerify}`);
if (pendingVerify.length) console.log(`  待覆校清单 pending-verify.json：${pendingVerify.length} 条（跑 verify-v2.js 后重跑本脚本应用）`);
