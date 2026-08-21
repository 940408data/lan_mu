#!/usr/bin/env node
/**
 * collation · 精校裁决合入（tools/grid-review-merge.js）
 * 把精校台导出的裁决 JSON（decisions + runs）合入 grid-overlay.json：
 *   - 单字裁决 → overlay.fixes（kind:'sub'，from=格字，to=所选字；evidence 记录两参校源与建议依据）
 *   - 夺文句裁决 → overlay.fixes（kind:'insert'，after 坐标 + 补入文本）
 *   - choice=keep-grid/defer → 不入 fixes（defer 可留在 decisions 留痕）
 * 幂等：同坐标 (page,col,row) 覆盖旧条目；基础层 sha 不匹配则拒绝。
 *
 * 用法:
 *   node collation/tools/grid-review-merge.js <书名> --file=精校裁决-大学章句.json [--write]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { publicPath } = require('../src/paths');

const args = process.argv.slice(2);
const flags = {}, pos = [];
for (const a of args) { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) flags[m[1]] = m[2] ?? true; else pos.push(a); }
const workId = pos[0];
const file = flags.file;
if (!workId || !file) { console.error('用法: node collation/tools/grid-review-merge.js <书名> --file=<精校裁决-书名.json> [--write]'); process.exit(1); }

const dec = JSON.parse(fs.readFileSync(path.resolve(String(file)), 'utf8'));
const ovPath = publicPath(workId, 'grid-overlay.json');
const ov = JSON.parse(fs.readFileSync(ovPath, 'utf8'));

if (dec.base && dec.base !== ov.base.sha256) {
  console.error(`✗ 基础层指纹不匹配：裁决基于 ${dec.base.slice(0, 12)}…，overlay 为 ${ov.base.sha256.slice(0, 12)}…（基础层已变更，请重跑 grid-overlay 后重新精校）`);
  process.exit(1);
}

ov.fixes = Array.isArray(ov.fixes) ? ov.fixes : [];
const cellFix = new Map(); // "p:c:r" -> index
ov.fixes.forEach((f, i) => { if (f.kind === 'sub') cellFix.set(`${f.page}:${f.col}:${f.row}`, i); });

let sub = 0, ins = 0, keep = 0, defer = 0, custom = 0;
for (const d of dec.decisions || []) {
  const k = `${d.page}:${d.col}:${d.row}`;
  if (d.choice === 'defer') { defer++; continue; }
  if (d.choice === 'keep-grid') { keep++; if (cellFix.has(k)) ov.fixes.splice(cellFix.get(k), 1); continue; }
  let to = d.choice === 'oldocr' ? d.oldOcr : d.choice === 'modern' ? d.modern : d.custom;
  if (to == null && (d.choice === 'oldocr' || d.choice === 'modern')) {
    to = ''; console.warn(`  ${k}：choice=${d.choice} 且目标字为 null → 置空（删除该字）`);
  }
  if (to === '' || [...to].length !== 1) { /* 空串=删除，单字=改字，其余跳过 */ }
  if (to !== '' && (!to || [...to].length !== 1)) { console.warn(`  跳过 ${k}：choice=${d.choice} 但目标字缺失`); continue; }
  const entry = {
    kind: 'sub', page: d.page, col: d.col, row: d.row,
    from: d.grid, to,
    evidence: `oldOcr=${d.oldOcr ?? '∅'}; modern=${d.modern ?? '∅'}; human=${d.choice}${d.note ? '; note=' + d.note : ''}`,
    decidedAt: dec.exportedAt,
  };
  if (cellFix.has(k)) ov.fixes[cellFix.get(k)] = entry;
  else { cellFix.set(k, ov.fixes.length); ov.fixes.push(entry); }
  d.choice === 'custom' ? custom++ : sub++;
}

for (const r of dec.runs || []) {
  if (r.choice !== 'insert' || !r.after) { continue; }
  ov.fixes.push({
    kind: 'insert', page: r.page, after: r.after, text: r.text,
    evidence: `src=${r.src}; human=insert${r.note ? '; note=' + r.note : ''}`,
    decidedAt: dec.exportedAt,
  });
  ins++;
}

/* 列纵偏移（colShifts）：幂等，同 (page,col) 覆盖；shift=0 则移除（归零即无偏移） */
let nShift = 0;
if (Array.isArray(dec.colShifts) && dec.colShifts.length) {
  const sm = new Map((Array.isArray(ov.colShifts) ? ov.colShifts : []).map(s => [`${s.page}:${s.col}`, s]));
  for (const s of dec.colShifts) {
    if (!s || s.shift == null) continue;
    const k = `${s.page}:${s.col}`;
    if (s.shift === 0) sm.delete(k); else { sm.set(k, { page: s.page, col: s.col, shift: s.shift }); nShift++; }
  }
  ov.colShifts = [...sm.values()];
}

/* 列内删字（colDels）：精校台导出为当前全量，直接替换（本格由下一格字占据） */
let nDel = 0;
if (Array.isArray(dec.colDels)) {
  ov.colDels = dec.colDels.filter(d => d && d.page != null && d.col != null && d.row != null).map(d => ({ page: d.page, col: d.col, row: d.row }));
  nDel = ov.colDels.length;
}

const brief = `裁决 ${ (dec.decisions || []).length } 条：改字 ${sub}（自定义 ${custom}）· 维持格字 ${keep} · 存疑 ${defer} · 补入夺文 ${ins} · 列偏移 ${nShift} · 删字 ${nDel}`;
if (flags.write) {
  fs.writeFileSync(ovPath, JSON.stringify(ov, null, 2));
  console.log(`✓ ${brief}\n✓ fixes 共 ${ov.fixes.length} 条已写入 ${ovPath}`);
} else {
  console.log(`（dry-run）${brief}\n（dry-run）将写入 fixes 共 ${ov.fixes.length} 条；加 --write 生效`);
}
