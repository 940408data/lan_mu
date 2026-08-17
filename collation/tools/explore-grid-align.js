#!/usr/bin/env node
/**
 * 网格基探索（tools/explore-grid-align.js）
 * 验证：视觉逐格 grid-transcribe.json 作唯一基础层，旧OCR/现代点校本作参校层逐格对齐的可行性。
 *
 * 模式：
 *   --mode=oldocr   shanben-v2.json 每页文字流 ↔ 同页逐格串（页级编辑对齐，页码一一对应）
 *   --mode=modern   儒藏本_ocr 全书流 ↔ 逐格全书串（长 n-gram 锚点分段 + 编辑对齐；页码不对应）
 *
 * 用法（在 worktree 或主仓均可跑，input_data 用 --input-root 指主仓）：
 *   node collation/tools/explore-grid-align.js 大学章句 --mode=oldocr
 *   node collation/tools/explore-grid-align.js 大学章句 --mode=modern --input-root=d:/note/lan_mu/input_data
 *
 * 只读探索：不改 grid-transcribe 规范与数据，结论记入方案文档。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { normChar } = require('../src/align');

const args = process.argv.slice(2);
const flags = {}, pos = [];
for (const a of args) { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) flags[m[1]] = m[2] ?? true; else pos.push(a); }
const workId = pos[0];
const mode = flags.mode;
if (!workId || !mode) {
  console.error('用法: node collation/tools/explore-grid-align.js <书名> --mode=oldocr|modern [--input-root=DIR] [--max-show=N]');
  process.exit(1);
}
const dataDir = path.join(__dirname, '..', 'data', workId);
const MAXSHOW = parseInt(String(flags['max-show'] || '40'), 10);

// ── 视觉逐格基础层 ──
const tr = JSON.parse(fs.readFileSync(path.join(dataDir, 'grid-transcribe.json'), 'utf8'));
// 每页格序列：col 升序（col1=最右先读），列内 row 升序；跳过空格
function pageCells(pg) {
  return (pg.cells || [])
    .slice().sort((a, b) => a.col - b.col || a.row - b.row)
    .filter(c => (c.char || '').trim().length > 0)
    .map(c => ({ page: pg.n, col: c.col, row: c.row, char: [...c.char.trim()][0], start: c.start || null }));
}
const pages = tr.pages.map(pageCells);
const totalPages = pages.length;
const totalCells = pages.reduce((s, p) => s + p.length, 0);
// 全书格串 + 位置索引
const flatCells = pages.flat();
const gridStr = flatCells.map(c => canon1(c.char)).join('');

// ── 归一化：去标点/空白/符号 + 异体归一（不改字，仅供对齐比较） ──
const STRIP = /[，。！？；：、""''「」『』《》〈〉（）〔〕○①②③④⑤⑥⑦⑧⑨⑩·—…\s？！]/g;
function canon1(ch) { return normChar(ch); }
function canon(s) { return [...s.replace(STRIP, '')].map(normChar).join(''); }

// ── 编辑对齐（a=参校流，b=格串）→ ops ──
function editOps(a, b, aOff, bOff) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    dp[i][j] = Math.min(dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), dp[i - 1][j] + 1, dp[i][j - 1] + 1);
  const ops = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      ops.push({ t: a[i - 1] === b[j - 1] ? '=' : 'sub', a: a[i - 1], b: b[j - 1], ai: aOff + i - 1, bi: bOff + j - 1 }); i--; j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      ops.push({ t: 'ins', a: a[i - 1], b: null, ai: aOff + i - 1, bi: bOff + j }); i--;
    } else {
      ops.push({ t: 'del', a: null, b: b[j - 1], ai: aOff + i, bi: bOff + j - 1 }); j--;
    }
  }
  return ops.reverse();
}

function cellAt(bi) { return flatCells[bi]; }
function ctx(s, i, w = 8) { return s.slice(Math.max(0, i - w), i) + '⟦' + (s[i] || '·') + '⟧' + s.slice(i + 1, i + 1 + w); }

// ════════ 模式一：旧OCR → 逐格（页级） ════════
if (mode === 'oldocr') {
  const v2 = JSON.parse(fs.readFileSync(path.join(dataDir, 'shanben-v2.json'), 'utf8'));
  const v2Map = new Map(v2.pages.map(p => [p.n, p.text]));
  let sum = { '=': 0, sub: 0, ins: 0, del: 0 }, subRows = [], insRows = [], delRows = [];
  for (const cells of pages) {
    if (!cells.length) continue;
    const n = cells[0].page;
    const old = v2Map.get(n);
    if (!old) { console.log(`p${n}: shanben-v2 无此页，跳过`); continue; }
    const a = canon(old), b = cells.map(c => c.char).map(canon1).join('');
    const ops = editOps(a, b, 0, 0);
    for (const op of ops) {
      sum[op.t]++;
      if (op.t === 'sub') subRows.push({ n, ...op, cell: cellOf(cells, op.bi, b) });
      if (op.t === 'ins') insRows.push({ n, ...op });
      if (op.t === 'del') delRows.push({ n, ...op, cell: cellOf(cells, op.bi, b) });
    }
  }
  function cellOf(cells, bi, b) { // bi 是整页格串索引（本页从0起）
    return bi >= 0 && bi < cells.length ? cells[bi] : null;
  }
  const total = sum['='] + sum.sub + sum.ins + sum.del;
  console.log(`\n═══ ${workId} 旧OCR(shanben-v2) → 逐格 · ${totalPages} 页 ${totalCells} 格 ═══`);
  console.log(`对齐字符 ${total}：一致 ${sum['=']}（${pct(sum['='], total)}）替换 ${sum.sub}（${pct(sum.sub, total)}）旧多 ${sum.ins}（${pct(sum.ins, total)}）格多 ${sum.del}（${pct(sum.del, total)}）`);
  console.log(`\n── 替换样本（旧字 vs 格字，前 ${Math.min(MAXSHOW, subRows.length)} 条）──`);
  subRows.slice(0, MAXSHOW).forEach(r => console.log(`  p${r.n} c${r.cell ? r.cell.col + '-' + r.cell.row : '?'} 旧【${r.a}】→ 格【${r.b}】`));
  console.log(`\n── 旧多（旧OCR有、逐格无）样本 前 ${Math.min(MAXSHOW, insRows.length)} 条 ──`);
  insRows.slice(0, MAXSHOW).forEach(r => console.log(`  p${r.n} 旧多【${r.a}】`));
  console.log(`\n── 格多（逐格有、旧OCR无）样本 前 ${Math.min(MAXSHOW, delRows.length)} 条 ──`);
  delRows.slice(0, MAXSHOW).forEach(r => console.log(`  p${r.n} c${r.cell ? r.cell.col + '-' + r.cell.row : '?'} 格【${r.b}】`));
}

// ════════ 模式二：现代点校本（儒藏本_ocr）→ 逐格（全书流 + 锚点分段） ════════
if (mode === 'modern') {
  const root = flags['input-root'] || path.join(__dirname, '..', '..', '..', 'input_data');
  const dir = path.join(root, workId, '儒藏本_ocr');
  const files = fs.readdirSync(dir).filter(f => /^page_\d+\.md$/.test(f)).sort();
  const rawPages = files.map(f => {
    const n = parseInt(f.match(/(\d+)/)[1], 10);
    return { n, text: fs.readFileSync(path.join(dir, f), 'utf8') };
  });
  // 全书流（含页边界记录，便于难点定位）
  const modernRaw = rawPages.map(p => p.text).join('\n');
  const pageStarts = []; // 现代本原始页 → 全书流偏移
  let acc = 0;
  for (const p of rawPages) { pageStarts.push({ n: p.n, rawStart: acc }); acc += p.text.length; }
  const modern = canon(modernRaw);

  // 锚点：从格串滑窗取 n-gram（归一后），在 modern 中唯一命中者，间隔 ≥150
  const W = 14, MIN_GAP = 150;
  const anchors = [];
  let lastB = -Infinity;
  for (let bi = 0; bi + W <= gridStr.length; bi += 7) {
    const key = gridStr.slice(bi, bi + W);
    const first = modern.indexOf(key);
    if (first >= 0 && modern.indexOf(key, first + 1) < 0 && bi - lastB >= MIN_GAP) {
      anchors.push({ bi, ai: first, key });
      lastB = bi;
    }
  }
  // 覆盖度检查：锚把格串切成 [prevBi, bi) 段
  const segs = [];
  let prevBi = 0, prevAi = 0;
  for (const a of anchors) { segs.push({ b0: prevBi, b1: a.bi, a0: prevAi, a1: a.ai }); prevBi = a.bi; prevAi = a.ai; }
  segs.push({ b0: prevBi, b1: gridStr.length, a0: prevAi, a1: modern.length });
  // 过大段再对半切（防 DP 爆内存）
  function split() {
    const out = [];
    for (const s of segs) {
      let b0 = s.b0, a0 = s.a0;
      while (s.b1 - b0 > 2500) {
        const mid = b0 + Math.floor((s.b1 - b0) / 2);
        const key = gridStr.slice(mid, mid + W);
        const hit = modern.indexOf(key, a0);
        if (hit >= 0 && hit < s.a1) { out.push({ b0, b1: mid, a0, a1: hit }); b0 = mid; a0 = hit; }
        else { out.push({ b0, b1: s.b1, a0, a1: s.a1 }); b0 = s.b1; break; }
      }
      if (b0 < s.b1) out.push({ b0, b1: s.b1, a0, a1: s.a1 });
    }
    return out;
  }
  const finalSegs = split();
  const unanchored = finalSegs.filter(s => s.b1 - s.b0 > 2000).length;

  let sum = { '=': 0, sub: 0, ins: 0, del: 0 };
  const subRows = [], insRows = [], delRows = [];
  for (const s of finalSegs) {
    const a = modern.slice(s.a0, s.a1), b = gridStr.slice(s.b0, s.b1);
    if (!a.length && !b.length) continue;
    const ops = editOps(a, b, s.a0, s.b0);
    for (const op of ops) {
      sum[op.t]++;
      if (sum[subRows.length < 500 ? 'sub' : 'sub'] && op.t === 'sub') subRows.push(op);
      if (op.t === 'ins') insRows.push(op);
      if (op.t === 'del') delRows.push(op);
    }
  }
  console.log(`\n═══ ${workId} 儒藏本_ocr → 逐格 · 格 ${totalCells}（${tr.pages[0]?.n}–${tr.pages[tr.pages.length - 1]?.n} 页）/ 现代 ${files.length} 页 ${modern.length} 字 ═══`);
  console.log(`锚点 ${anchors.length} 个；分段 ${finalSegs.length} 段；超长无锚段 ${unanchored} 个`);
  const total = sum['='] + sum.sub + sum.ins + sum.del;
  console.log(`对齐字符 ${total}：一致 ${sum['=']}（${pct(sum['='], total)}）替换 ${sum.sub}（${pct(sum.sub, total)}）现代多 ${sum.ins}（${pct(sum.ins, total)}）格多 ${sum.del}（${pct(sum.del, total)}）`);
  const mctx = canon(modernRaw); // 含标点原文的归一串不一致，这里直接用 modern 展示上下文即可
  console.log(`\n── 替换样本 前 ${Math.min(MAXSHOW, subRows.length)} 条（现代 vs 格）──`);
  subRows.slice(0, MAXSHOW).forEach(r => {
    const c = cellAt(r.bi);
    console.log(`  ${c ? `p${c.page} c${c.col}-${c.row}` : '?'} 现代【${r.a}】vs 格【${r.b}】 | ${ctx(modern, r.ai)}`);
  });
  console.log(`\n── 现代多（ins：现代本多出、格无）样本 前 ${Math.min(MAXSHOW, insRows.length)} 条 ──`);
  insRows.slice(0, MAXSHOW).forEach(r => console.log(`  现代【${r.a}】 @${ctx(modern, r.ai, 6)}`));
  console.log(`\n── 格多（del：格有、现代本无）样本 前 ${Math.min(MAXSHOW, delRows.length)} 条 ──`);
  delRows.slice(0, MAXSHOW).forEach(r => {
    const c = cellAt(r.bi);
    console.log(`  ${c ? `p${c.page} c${c.col}-${c.row}` : '?'} 格【${r.b}】`);
  });
}

function pct(x, total) { return total ? (x / total * 100).toFixed(1) + '%' : '0%'; }
