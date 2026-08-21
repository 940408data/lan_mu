#!/usr/bin/env node
/**
 * collation · 逐格直出作品数据 V2（tools/grid-to-work.js）
 * 以 grid-transcribe.json（基础层）+ grid-overlay.json（labels/sections/fixes）
 * 产出 works/<新作品id>/grid.yaml —— 影刻直出引擎（layout: songke-facsimile）的数据源。
 *
 * V2 无损原则（V1 教训：全空列被删、cells 压串、半叶拆分皆失真）：
 *   - cells 原样快照为 [col,row,char] 三元组，只含有字格；空格/空列由 layout(cols×rows) 隐含——
 *     渲染层按坐标显式定位，空位自然留白（p2 左半叶整白、p6 中缝空白全真保留）；
 *   - 不压定长串、不删空列、不做 z 列配对、不拆半叶——版面信息零损失；
 *   - sub 类 fixes：导出时应用（cell.char 已是裁决后字），证据链保留于 fixes 快照；
 *   - insert 类 fixes：不入版面（原刻本无此字），仅保留快照供校勘交互层提示「参校本多出」；
 *   - cell.start（頂格/退格推断）不入快照——顶格与否已由 row1 有无字表达，属冗余推断。
 *   - 句读朱点（可选）：punctuated.json 若存在，每段末字沿页内阅读流（col 升→row 升）
 *     映回格坐标入 marks——经注施朱的数据源；缺文件则 marks 为空，渲染层白文无点。
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

// 列纵偏移索引："p:c" -> shift（视觉识别整列错位的纠正，精校台 colShifts 裁决合入）
const shiftMap = new Map();
for (const s of (Array.isArray(ov.colShifts) ? ov.colShifts : [])) {
  if (s && s.shift) shiftMap.set(`${s.page}:${s.col}`, s.shift);
}

const N_ROWS = (tr.layout && tr.layout.rows) || 15;
const N_COLS = (tr.layout && tr.layout.cols) || 16;

// 逐页无损快照：cells 只含有字格（含 fix 覆盖），坐标 [col,row,char]
// 行坐标 = 原始 row + 列纵偏移（colShifts）− 同列已删格数（删除格上移，版面紧凑）
let nCells = 0, nFixed = 0, nNoRole = 0, nShiftCols = 0;
const blankPages = [];   // 含整空列的页（渲染应自然留白——版面真实信息）
const pages = [];
for (const pg of tr.pages || []) {
  const usedCols = new Set();
  const cells = [];
  const colDelCount = {};   // col -> 该列已删除的格数（后续字 row 需减去）
  for (const cell of pg.cells || []) {
    let ch = String(cell.char || '').trim();
    const fx = fixMap.get(`${pg.n}:${cell.col}:${cell.row}`);
    if (fx) { ch = String(fx.to || '').trim(); nFixed++; }   // sub 应用（裁决后字）
    if (!ch) {                                                 // 删除格：同列后续字上移
      colDelCount[cell.col] = (colDelCount[cell.col] || 0) + 1;
      continue;
    }
    const shift = shiftMap.get(`${pg.n}:${cell.col}`) || 0;   // 列纵偏移
    const adjRow = cell.row + shift - (colDelCount[cell.col] || 0);
    cells.push([cell.col, adjRow, ch]);
    usedCols.add(cell.col);
    nCells++;
  }
  // 版面报告：该页 1..N_COLS 中无字的列（半叶空白/中缝空白——全真保留的版面信息）
  const blanks = [];
  for (let c = 1; c <= N_COLS; c++) if (!usedCols.has(c)) blanks.push(c);
  if (blanks.length) blankPages.push(`p${pg.n}[${blanks.join(',')}]`);
  pages.push({ n: pg.n, cells });
}
nShiftCols = shiftMap.size;

// ── 句读朱点：punctuated.json 段末字 → 格坐标（P5b 点校产物，可选） ──
// 全书全局阅读流（page 升→col 升→row 升，rtl 下 col1 最右先读）。实测三类失配与对策：
//   1. 段跨页（序文长段跨 p2→p3）——全局流天然支持；
//   2. 异体字形偶差（丗/世、髙/高、污/汙、閒/間之类）——双方过常见异体归一表再比（等长替换，坐标不变）；
//   3. 段序与物理列序倒置（经注混排处，对齐层按「经→其注」逻辑序，刻本物理序为「经·夹注·下句经」）——
//      先自游标顺推（主序），失败再全域搜（回流段）；usedEnd 防两段同文复用同一末字；
//   4. 整段失配时以 raw 尾 8 字为锚（朱点只需段末字坐标）；裁决改字则回退「逆 fixes 流」。
// 仍败则 orphan 略过（大学 571 段命中 529，余散在 20 页各 1-6 个，不聚集、不致整页无点）。
const VARIANT_NORM = { 丗: '世', 髙: '高', 污: '汙', 閒: '間', 內: '内', 槩: '概', 緫: '總', 敎: '教', 驩: '歡', 慤: '愨', 寔: '實', 亾: '亡', 飢: '饑' };
const vnorm = (s) => [...s].map((c) => VARIANT_NORM[c] || c).join('');
const puFile = path.join(dataDir, 'punctuated.json');
let marks = [], nOrphan = 0;
if (fs.existsSync(puFile)) {
  const pu = JSON.parse(fs.readFileSync(puFile, 'utf8'));
  const flow = [];
  for (const pg of pages)
    for (const c of [...pg.cells].sort((a, b) => a[0] - b[0] || a[1] - b[1]))
      flow.push({ page: pg.n, col: c[0], row: c[1], ch: c[2] });
  const chars = vnorm(flow.map((c) => c.ch).join(''));
  const alt = vnorm(flow.map((c) => { const fx = fixMap.get(`${c.page}:${c.col}:${c.row}`); return fx ? (String(fx.from || '')[0] || c.ch) : c.ch; }).join(''));
  const PUNCT_RE = /[，。！？；：、「」『』（）《》〈〉【】“”‘’…—,.!?;:()\[\]\s]/g;
  const TAIL = 8;
  const usedEnd = new Set();
  const search = (hay, needle, from) => {
    let i = hay.indexOf(needle, from);
    while (i >= 0) { const e = i + needle.length - 1; if (!usedEnd.has(e)) return e; i = hay.indexOf(needle, i + 1); }
    return -1;
  };
  const locate = (raw, cur) => {
    for (const from of [cur, 0]) {                     // 顺推优先，回流段全域搜
      for (const hay of [chars, alt]) {
        let e = search(hay, raw, from); if (e >= 0) return e;
        e = search(hay, raw.slice(-TAIL), from); if (e >= 0) return e;   // 尾锚容错
      }
    }
    return -1;
  };
  let cur = 0;
  for (const s of (pu.segments || []).slice().sort((a, b) => a.segId - b.segId)) {
    const raw = vnorm(String(s.raw || '').replace(PUNCT_RE, ''));
    if (!raw) { nOrphan++; continue; }
    const end = locate(raw, cur);
    if (end < 0) { nOrphan++; continue; }
    usedEnd.add(end);
    marks.push({ page: flow[end].page, col: flow[end].col, row: flow[end].row });
    cur = Math.max(cur, end + 1);                      // 游标单调：回流段不回拉
  }
}

// labels 无标签列统计（渲染按 z 兜底）
const labelled = new Set((ov.labels || []).map((l) => `${l.page}:${l.col}`));
const allCols = new Set();
for (const pg of tr.pages || []) for (const cell of pg.cells || []) if (String(cell.char || '').trim()) allCols.add(`${pg.n}:${cell.col}`);
for (const k of allCols) if (!labelled.has(k)) nNoRole++;

const gridDoc = {
  work: workId,
  base: { file: 'grid-transcribe.json', sha256: trSha },
  exportedAt: new Date().toISOString(),
  layout: { cols: N_COLS, rows: N_ROWS },
  pages,
  labels: ov.labels || [],
  sections: ov.sections || [],
  fixes,
  colShifts: Array.isArray(ov.colShifts) ? ov.colShifts : [],   // 列纵偏移留痕（已应用入 pages 坐标）
  marks,                                          // 句读朱点格清单（punctuated.json 缺失则为空）
};

const brief = `${workId} → works/${newId}/grid.yaml：${pages.length} 葉 ${nCells} 有字格（${allCols.size} 有字列 / 版面 ${N_COLS}×${N_ROWS}）；sub 应用 ${nFixed} / insert 快照 ${fixes.filter(f => f.kind === 'insert').length}（不入版面）；列偏移 ${nShiftCols}；sections ${(ov.sections || []).length}；句读朱点 ${marks.length}`;
if (fs.existsSync(puFile) && nOrphan) console.warn(`  [句读] ${nOrphan} 段未能映回格坐标（已略，不阻塞）`);
if (blankPages.length) console.log(`  [版面] 含空列页（自然留白全真保留）：${blankPages.join(' ')}`);
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
