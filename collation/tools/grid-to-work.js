#!/usr/bin/env node
/**
 * collation · 逐格直出作品数据（tools/grid-to-work.js）
 * 以 grid-transcribe.json（基础层）+ grid-overlay.json（labels/sections/fixes）
 * 产出 works/<新作品id>/grid.yaml —— 影刻直出引擎（layout: songke-facsimile）的数据源。
 *
 * 与 G5（grid-export.js → text.yaml）的关系：G5 压平为连续文本供 songke 重排；
 * 本工具保留全真列阵（页/列/行/空格/证据链），供影刻直出零重排渲染。两通道并存。
 *
 * fixes 应用规则（影刻=原刻原貌）：
 *   - sub 类：导出时应用（chars 已是裁决后字），证据链保留于 fixes 快照；
 *   - insert 类：不入版面（原刻本无此字），仅保留快照供校勘交互层提示「参校本多出」。
 *
 * 用法: node collation/tools/grid-to-work.js <书名> <新作品id> [--write]
 *   例: node collation/tools/grid-to-work.js 大学章句 daxue-facsimile --write
 */
'use strict';
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { publicWorkDir } = require('../src/paths');

const args = process.argv.slice(2);
const flags = {}, pos = [];
for (const a of args) { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) flags[m[1]] = m[2] ?? true; else pos.push(a); }
const [workId, newId] = pos;
if (!workId || !newId) { console.error('用法: node collation/tools/grid-to-work.js <书名> <新作品id> [--write]'); process.exit(1); }

const dataDir = publicWorkDir(workId);
const trFile = path.join(dataDir, 'grid-transcribe.json');
const ovFile = path.join(dataDir, 'grid-overlay.json');
if (!fs.existsSync(trFile)) { console.error(`✗ 无基础层 ${trFile}（先跑 grid-transcribe）`); process.exit(1); }
if (!fs.existsSync(ovFile)) { console.error(`✗ 无 overlay ${ovFile}（先跑 grid-overlay）`); process.exit(1); }

const tr = JSON.parse(fs.readFileSync(trFile, 'utf8'));
const ov = JSON.parse(fs.readFileSync(ovFile, 'utf8'));

// 基础层指纹：overlay.base.sha256 必须仍指向当前 grid-transcribe（防 overlay 过期）
const crypto = require('crypto');
const trSha = crypto.createHash('sha256').update(fs.readFileSync(trFile)).digest('hex');
if (ov.base && ov.base.sha256 !== trSha) {
  console.error(`✗ overlay 指纹过期：overlay 基于 ${ov.base.sha256.slice(0, 12)}…，当前基础层 ${trSha.slice(0, 12)}…（请重跑 grid-overlay）`);
  process.exit(1);
}

// fixes 索引：sub 应用入字；insert 仅快照
const fixMap = new Map();       // "p:c:r" -> fix（sub 应用后仍留痕，供校勘层）
const fixes = Array.isArray(ov.fixes) ? ov.fixes : [];
for (const f of fixes) {
  if (f.kind === 'sub') fixMap.set(`${f.page}:${f.col}:${f.row}`, f);
}

// labels 索引："p:c" -> role
const labelMap = new Map();
for (const l of ov.labels || []) labelMap.set(`${l.page}:${l.col}`, l.role);

const N_ROWS = (tr.layout && tr.layout.rows) || 15;
const N_COLS = (tr.layout && tr.layout.cols) || 16;
const BLANK = '　'; // 空位占位（敬空/阙字/余白全真保留）

// 逐页组织：列 × 定长行串（保留空格；基础层零重排直出）
let nCols = 0, nCells = 0, nFixed = 0, nNoRole = 0;
const pages = [];
for (const pg of tr.pages || []) {
  const cellMap = new Map(); // "c:r" -> char
  let startMap = new Map();  // col -> start（頂格/退格）
  for (const cell of pg.cells || []) {
    cellMap.set(`${cell.col}:${cell.row}`, (cell.char || '').trim());
    if (cell.start) startMap.set(cell.col, cell.start);
  }
  const cols = [];
  for (let c = 1; c <= N_COLS; c++) {
    let chars = '';
    for (let r = 1; r <= N_ROWS; r++) {
      let ch = cellMap.get(`${c}:${r}`) || '';
      const fx = fixMap.get(`${pg.n}:${c}:${r}`);
      if (fx) { ch = fx.to; nFixed++; }       // sub 应用（裁决后字）
      chars += ch ? [...ch][0] : BLANK;
    }
    // 全空列不出（原刻该页无此列——末页/半叶常见）
    if (!chars.replace(/\u3000/g, '')) continue;
    const role = labelMap.get(`${pg.n}:${c}`) || null;
    if (!role) nNoRole++;
    const col = { c, chars };
    if (role) col.role = role;
    if (startMap.has(c)) col.start = startMap.get(c);
    cols.push(col);
    nCols++;
    nCells += chars.replace(/\u3000/g, '').length;
  }
  pages.push({ n: pg.n, cols });
}

const gridDoc = {
  work: workId,
  base: { file: 'grid-transcribe.json', sha256: trSha },
  exportedAt: new Date().toISOString(),
  layout: { cols: N_COLS, rows: N_ROWS },
  pages,
  sections: ov.sections || [],
  fixes,
};

const brief = `${workId} → works/${newId}/grid.yaml：${pages.length} 葉 ${nCols} 列 ${nCells} 字；sub 应用 ${nFixed} / insert 快照 ${fixes.filter(f => f.kind === 'insert').length}（不入版面）；sections ${(ov.sections || []).length}`;
if (nNoRole) console.warn(`  [警告] ${nNoRole} 列无 role 标签（渲染按 z 兜底）`);

if (flags.write) {
  const outDir = path.join(__dirname, '..', '..', 'works', newId);
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'grid.yaml');
  fs.writeFileSync(outFile, YAML.stringify(gridDoc, { lineWidth: 0 }));
  console.log(`✓ ${brief}\n✓ 写入 ${outFile}（${Math.round(fs.statSync(outFile).size / 1024)} KB）`);
  console.log('  下一步：手工补 works/' + newId + '/meta.yaml（layout: songke-facsimile）→ npm run validate -- --work=' + newId);
} else {
  console.log(`（dry-run）${brief}\n（dry-run）加 --write 写入 works/${newId}/grid.yaml`);
}
