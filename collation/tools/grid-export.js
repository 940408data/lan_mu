#!/usr/bin/env node
/**
 * collation · G5 单一出口：基础层 + overlay + fixes → works/<id>/text.yaml
 *
 * 消费 grid-transcribe.json（基础层逐格）+ grid-overlay.json（labels/sections/fixes），
 * 派生 songke 格式 text.yaml（sections[].blocks[]{type:j|z, text}）：
 *   - sections 边界用 overlay.sections 格坐标（替旧 build-works 文本 match，更精确）
 *   - j/z 用 overlay.labels（含 title 覆盖，替 colsOfPage 的 start 推断）
 *   - fixes：kind:'sub' 改字 / kind:'insert' 补夺文（唯一改字通道，grid-review-merge 写入）
 *
 * 不动旧 build-works.js（保留对照，验收后下线）；本次只产 text.yaml，
 * meta/seals/ornaments、善本点校本.md、校勘记.md 二期。
 *
 * 用法: node collation/tools/grid-export.js <书名> <新作品id>
 *   例: node collation/tools/grid-export.js 大学章句 daxue-songben-g5
 *       node collation/tools/grid-export.js 中庸章句 zhongyong-songben-g5
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { loadBaseGrid } = require('../src/grid');

// ── 坐标三级比较：(page, col, row) ──
function cmpCoord(a, b) {
  if (a.page !== b.page) return a.page - b.page;
  if (a.col !== b.col) return a.col - b.col;
  return a.row - b.row;
}

// ── 取 section 闭区间 [from, to] 的格 ──
// base.pages[].cells 已 sort(col,row)、带 page 字段（loadBaseGrid 产出）。
// 跨页跨列精确到格，section 边界落在列中间不吞整列。
function cellsInRange(base, from, to) {
  const out = [];
  for (const pg of base.pages) {
    if (pg.n < from.page || pg.n > to.page) continue;
    for (const c of pg.cells) {
      if (cmpCoord(c, from) >= 0 && cmpCoord(c, to) <= 0) out.push(c);
    }
  }
  return out;
}

// ── 连续同 role 合并为 blocks；title 过滤；○ j 跳 z 留；fixes 应用 ──
function deriveBlocks(cells, labelMap, fixMap, insertAfter) {
  const blocks = [];
  let cur = null;
  const flush = () => { if (cur) { blocks.push(cur); cur = null; } };
  for (const c of cells) {
    const role = labelMap.get(`${c.page}:${c.col}`);
    // title 列不入 blocks（section.name 已含章名）
    if (role === 'title') continue;

    // fixes：sub 覆盖 char
    const ch = fixMap.get(`${c.page}:${c.col}:${c.row}`) ?? c.char;

    // ○ 与空字：j 列跳过（不进 text）；z 列保留 ○ 作段落分隔
    const skipChar = !ch || ch === '○';
    if (skipChar && role === 'j') {
      // 被跳过格的 insert fix 仍须应用（补夺文不应因 ○ 丢失）——挂到当前块末尾
      const ins = insertAfter.get(`${c.page}:${c.col}:${c.row}`);
      if (ins && cur) cur.text += ins;
      continue;
    }

    // 连续同 role 合并
    if (cur && cur.type === role) cur.text += ch;
    else { flush(); cur = { type: role, text: ch }; }

    // fixes：insert 在该格后追加（补夺文）
    const ins = insertAfter.get(`${c.page}:${c.col}:${c.row}`);
    if (ins) cur.text += ins;
  }
  flush();
  return blocks;
}

// ── 字数统计（与 build-works.js:112 一致；待抽共享 songke-pipeline.js） ──
const NON_TOKENS = new Set([...'。！？？，、；：「」『』（）〈〉—·']);
const countTokens = text => [...text].filter(ch => !NON_TOKENS.has(ch)).length;

// ── text.yaml 内联拼接（复用 build-works.js:118-122 格式，非 yaml.stringify） ──
function renderTextYaml(workId, sections) {
  let yaml = `# ${workId}（当涂郡斋刊递修本·善本底）：j 为经传大字，z 为章句小字。版面结构先行：顶格经/退格注。\nsections:\n`;
  for (const sec of sections) {
    yaml += `  - id: ${sec.id}\n    name: ${sec.name}\n    blocks:\n`;
    for (const b of sec.blocks) yaml += `      - { type: ${b.type}, text: ${b.text} }\n`;
  }
  return yaml;
}

// ── 主入口 ──
function exportWork(workId, newId) {
  const dataDir = path.join(__dirname, '..', 'data', workId);
  const trFile = path.join(dataDir, 'grid-transcribe.json');
  const ovFile = path.join(dataDir, 'grid-overlay.json');
  if (!fs.existsSync(trFile)) { console.error(`✗ 无基础层 ${trFile}（先跑 grid-transcribe）`); process.exit(1); }
  if (!fs.existsSync(ovFile)) { console.error(`✗ 无 overlay ${ovFile}（先跑 grid-overlay）`); process.exit(1); }

  const tr = JSON.parse(fs.readFileSync(trFile, 'utf8'));
  const ov = JSON.parse(fs.readFileSync(ovFile, 'utf8'));
  const base = loadBaseGrid(tr);

  // fixes 索引（幂等消费：同坐标覆盖，与 grid-review-merge 写入对齐）
  const fixMap = new Map();       // "p:c:r" -> to (sub)
  const insertAfter = new Map();  // "p:c:r" -> text (insert)
  for (const f of ov.fixes || []) {
    if (f.kind === 'sub') fixMap.set(`${f.page}:${f.col}:${f.row}`, f.to);
    else if (f.kind === 'insert' && f.after) insertAfter.set(`${f.page}:${f.after.col}:${f.after.row}`, f.text);
  }
  // label 索引
  const labelMap = new Map(); // "p:c" -> role
  for (const l of ov.labels || []) labelMap.set(`${l.page}:${l.col}`, l.role);

  // 逐 section 派生 blocks
  const sections = [];
  for (const sec of ov.sections || []) {
    const cells = cellsInRange(base, sec.from, sec.to);
    const blocks = deriveBlocks(cells, labelMap, fixMap, insertAfter);
    sections.push({ id: sec.id, name: sec.name, blocks });
  }

  // 写出
  const outDir = path.join(__dirname, '..', '..', 'works', newId);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'text.yaml'), renderTextYaml(workId, sections));

  // 统计
  const allBlocks = sections.flatMap(s => s.blocks);
  const jChars = allBlocks.filter(b => b.type === 'j').reduce((s, b) => s + countTokens(b.text), 0);
  const zChars = allBlocks.filter(b => b.type === 'z').reduce((s, b) => s + countTokens(b.text), 0);
  console.log(`✓ works/${newId}/text.yaml：${sections.length} sections，${allBlocks.length} blocks（经字 ${jChars} / 注字 ${zChars}）`);
  const fx = ov.fixes || [];
  if (fx.length === 0) console.log('  fixes 恒空 → 纯基础层 + overlay 派生基线');
  else console.log(`  fixes 应用：sub ${fixMap.size} / insert ${insertAfter.size}`);
}

const [workId, newId] = process.argv.slice(2);
if (!workId || !newId) { console.error('用法: node collation/tools/grid-export.js <书名> <新作品id>'); process.exit(1); }
exportWork(workId, newId);
