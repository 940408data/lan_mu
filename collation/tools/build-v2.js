#!/usr/bin/env node
/**
 * collation · M2 收尾：互证仲裁生成干净善本底本（tools/build-v2.js）
 * 读 recollate-*.json（视觉 OCR + 旧 OCR + 差异点），两路编辑距离对齐后按规则仲裁：
 *   一致        → 采信（取旧 OCR 字，即善本原刻字形）
 *   视觉缺字(旧有视无) → 采旧（视觉关思考漏字是已知缺陷，善本实有此字）
 *   视觉多字(视有旧无) → 采旧（保守，防视觉幻觉；标疑）
 *   替换·异体(norm同)  → 采旧（善本古字形）
 *   替换·真异(形义不同) → 暂采旧 + 列入待覆校清单（待 verifyChar 视觉仲裁）
 * 产出: data/<书>/shanben-v2.json（{pages:[{n,text}], stats}）+ pending-verify.json
 *
 * 用法: node collation/tools/build-v2.js <书名> [--in=recollate-1-40.json]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { VARIANT_MAP } = require('../src/align');

const args = process.argv.slice(2);
const flags = {}, pos = [];
for (const a of args) { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) flags[m[1]] = m[2] ?? true; else pos.push(a); }
const workId = pos[0];
if (!workId) { console.error('用法: node collation/tools/build-v2.js <书名> [--in=...]'); process.exit(1); }
const dataDir = path.join(__dirname, '..', 'data', workId);
const inFile = flags.in || fs.readdirSync(dataDir).filter(f => /^recollate-\d+-\d+\.json$/.test(f)).sort().pop();
const recollate = JSON.parse(fs.readFileSync(path.join(dataDir, inFile), 'utf8'));

function norm(c) { return VARIANT_MAP[c] || c; }
function canon(s) { return [...s.replace(/[，。！？；：、""''「」『』《》（）○\s〔〕？?]/g, '')].map(c => normChar0(c)).join(''); }
function normChar0(c) { return VARIANT_MAP[c] || (c.length > 1 ? '〓' : c); }

/** 编辑距离 + 回溯，返回 ops：[{t:'='|'sub'|'del'|'ins', old, vis}] */
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
    else if (dp[i][j] === dp[i-1][j] + 1) { ops.push({ t: 'del', old: a[i-1], vis: null }); i--; }  // 旧有视无
    else { ops.push({ t: 'ins', old: null, vis: b[j-1] }); j--; }                                    // 视有旧无
  }
  while (i > 0) { ops.push({ t: 'del', old: a[i-1], vis: null }); i--; }
  while (j > 0) { ops.push({ t: 'ins', old: null, vis: b[j-1] }); j--; }
  return ops.reverse();
}

const pages = [];
const pendingVerify = [];
let stat = { match: 0, variant: 0, ins: 0, del: 0, subVerify: 0 };
for (const p of recollate) {
  if (p.error || !p.visText) continue;
  const oldText = fs.readFileSync(path.join(require('../src/io').INPUT_DATA, workId, '当涂郡本_ocr', `page_${String(p.page).padStart(4,'0')}.md`), 'utf8');
  const a = canon(oldText), b = canon(p.visText);
  const ops = editOps(a, b);
  let clean = '';
  for (const op of ops) {
    if (op.t === '=') { clean += op.old; stat.match++; }
    else if (op.t === 'del') { clean += op.old; stat.del++; }              // 视觉缺字→采旧
    else if (op.t === 'ins') { stat.ins++; }                                // 视觉多字→采旧(舍)
    else { // sub
      if (norm(op.old) === norm(op.vis)) { clean += op.old; stat.variant++; } // 异体→采旧(善本古字形)
      else { clean += op.old; stat.subVerify++; pendingVerify.push({ page: p.page, old: op.old, vis: op.vis }); } // 真异→暂采旧+待覆校
    }
  }
  pages.push({ n: p.page, text: clean });
}
pages.sort((x, y) => x.n - y.n);
const out = { work: workId, source: inFile, stats: stat, pages };
fs.writeFileSync(path.join(dataDir, 'shanben-v2.json'), JSON.stringify(out, null, 2));
fs.writeFileSync(path.join(dataDir, 'pending-verify.json'), JSON.stringify(pendingVerify, null, 2));
console.log(`✓ 干净底本 shanben-v2.json：${pages.length} 页，${pages.reduce((s,p)=>s+p.text.length,0)} 字`);
console.log(`  仲裁：一致${stat.match} 异体归一${stat.variant} 视觉缺字采旧${stat.del} 视觉多字舍${stat.ins} 真替换待覆校${stat.subVerify}`);
console.log(`  待覆校清单 pending-verify.json：${pendingVerify.length} 条`);
pendingVerify.slice(0, 20).forEach(v => console.log(`    p${v.page} 旧「${v.old}」视「${v.vis}」`));
