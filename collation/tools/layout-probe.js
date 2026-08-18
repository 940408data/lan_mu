#!/usr/bin/env node
/**
 * collation · M0 版面结构抽样（tools/layout-probe.js）——每书必做、结论落盘
 * 抽样若干页善本 → layoutProbe（视觉，开思考）→ 汇总裁定网格（众数）→ data/<书>/layout.json。
 * layout.json 供 judge-grid 读参（--cols/--rows 可覆盖）、供复审追溯。
 *
 * 用法: node collation/tools/layout-probe.js <书名> [--pages=8,30,50] [--conc=3]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { renderPage, layoutProbe } = require('../src/vision');
const { loadConfig, INPUT_DATA, pagePdfPath } = require('../src/io');

const args = process.argv.slice(2);
const flags = {}, pos = [];
for (const a of args) { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) flags[m[1]] = m[2] ?? true; else pos.push(a); }
const workId = pos[0];
if (!workId) { console.error('用法: node collation/tools/layout-probe.js <书名> [--pages=8,30,50]'); process.exit(1); }

const { editions, works } = loadConfig();
const work = works[workId];
if (!work) { console.error('未登记作品: ' + workId); process.exit(1); }
// 平铺优先统计总页数；分卷书退卷目录合计
const flatDir = path.join(INPUT_DATA, workId, editions[work.shanben].pdfDir);
const totalPages = fs.existsSync(flatDir)
  ? fs.readdirSync(flatDir).filter(f => /\.pdf$/i.test(f)).length
  : require('../src/io').listVolumePages(workId, editions[work.shanben].pdfDir.replace(/ocr$/, 'pdf')).length;
// 默认抽样：正文前/中/后三页（跳过封面与题跋）
const sample = flags.pages
  ? flags.pages.split(',').map(Number)
  : [Math.max(2, Math.round(totalPages * 0.15)), Math.round(totalPages * 0.5), Math.round(totalPages * 0.85)];

(async () => {
  console.log(`M0 版面抽样：${workId} 共 ${totalPages} 页，抽样 ${sample.join('/')}`);
  const probes = [];
  for (const pg of sample) {
    const pdf = pagePdfPath(workId, editions[work.shanben].pdfDir, pg);
    try {
      const { b64 } = renderPage(pdf, 1, 150);
      const r = await layoutProbe(b64);
      const obj = r.obj || {};
      console.log(` page_${pg}（${r.engine} conf=${(r.conf || 0).toFixed(2)}）:`, JSON.stringify(obj));
      if (obj && obj.cols) probes.push({ page: pg, ...obj, engine: r.engine, conf: r.conf });
    } catch (e) { console.log(` page_${pg} 失败:`, e.message); }
  }
  if (!probes.length) { console.error('✗ 抽样全失败，未落盘'); process.exit(1); }
  // 众数裁定
  const mode = arr => { const c = {}; arr.forEach(x => c[x] = (c[x] || 0) + 1); return +Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]; };
  const layout = {
    work: workId,
    edition: editions[work.shanben].title,
    cols: mode(probes.map(p => p.cols)),
    rows: mode(probes.map(p => p.rows)),
    charPerCell: mode(probes.map(p => p.charPerCell || 1)),
    hasDoubleSmall: probes.some(p => p.hasDoubleSmall),
    jingStart: probes[0].jingStart || '顶格',
    zhuStart: probes[0].zhuStart || '退一格',
    rules: probes.map(p => p.note).filter(Boolean).join('；'),
    sampledPages: sample,
    probes,
    probedAt: new Date().toISOString(),
  };
  const out = path.join(__dirname, '..', 'data', workId, 'layout.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(layout, null, 2));
  console.log(`✓ layout.json：${layout.cols}列×${layout.rows}行，经${layout.jingStart}/注${layout.zhuStart}（抽样 ${probes.length}/${sample.length} 页一致采众数）`);
})().catch(e => { console.error('✗', e); process.exit(1); });
