#!/usr/bin/env node
/**
 * collation · G2/G3 网格 overlay 工具（tools/grid-overlay.js）
 * 以视觉逐格 grid-transcribe.json 为基础层，旁挂参校层（旧OCR + 儒藏本）与标签层，
 * 产出 collation/data/<书>/grid-overlay.json。不改基础层规范与数据；fixes 恒空（G4 另行裁决）。
 *
 * 用法:
 *   node collation/tools/grid-overlay.js <书名> [--input-root=DIR] [--write] [--modern=false]
 * 例:
 *   node collation/tools/grid-overlay.js 大学章句 --input-root=d:/note/lan_mu/input_data --write
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { buildOverlay } = require('../src/grid');
const { publicWorkDir } = require('../src/paths');

const args = process.argv.slice(2);
const flags = {}, pos = [];
for (const a of args) { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) flags[m[1]] = m[2] ?? true; else pos.push(a); }
const workId = pos[0];
if (!workId) { console.error('用法: node collation/tools/grid-overlay.js <书名> [--input-root=DIR] [--write]'); process.exit(1); }

const opts = { inputRoot: flags['input-root'] ? String(flags['input-root']) : undefined };
if (flags.modern === 'false') opts.modern = false;

const { overlay, report } = buildOverlay(workId, opts);

console.log(`═══ ${workId} · grid-overlay ═══`);
console.log(`基础层: ${overlay.stats.pages} 页 ${overlay.stats.cells} 格（${overlay.base.file} ${overlay.base.sha256.slice(0, 12)}…）`);
console.log(`G2a 旧OCR: 一致 ${overlay.stats.oldOcr.agree} 替换 ${overlay.stats.oldOcr.sub} 旧多 ${overlay.stats.oldOcr.missing} 格多 ${overlay.stats.oldOcr.extra} → 一致率 ${(report.oldOcrAgree * 100).toFixed(1)}%`);
if (overlay.stats.modern) {
  const m = overlay.stats.modern;
  console.log(`G2b 儒藏本: 一致 ${m.agree} 替换 ${m.sub} 现代多 ${m.missing} 格多 ${m.extra} → 一致率 ${(report.modernAgree * 100).toFixed(1)}%`);
  console.log(`    锚点: 硬 ${m.anchors.hard} / 软 ${m.anchors.soft} / 保留 ${m.anchors.kept}，分段 ${m.anchors.segs}，超长无锚段 ${m.unanchoredSegs}；预清洗: ${JSON.stringify(report.preclean)}`);
}
console.log(`G3 标签: 列 ${overlay.stats.labels.cols}（title ${overlay.stats.labels.titles}）；sections ${overlay.stats.sections} 个 [${report.sections.join(' | ')}]`);
if (report.jzCheck) {
  console.log(`j/z 对照 grid.json: ${report.jzCheck.match}/${report.jzCheck.total} = ${(report.jzCheck.ratio * 100).toFixed(2)}%`);
  for (const d of report.jzCheck.diffs.slice(0, 10)) console.log(`    差异 p${d.page}c${d.col} grid=${d.gridJson} overlay=${d.overlay} 「${d.text}」`);
}

if (flags.write) {
  const file = path.join(publicWorkDir(workId), 'grid-overlay.json');
  fs.writeFileSync(file, JSON.stringify(overlay, null, 2));
  console.log(`\n✓ 写入 ${file}`);
} else {
  console.log('\n（dry-run，加 --write 写入 collation/data/<书名>/grid-overlay.json）');
}
