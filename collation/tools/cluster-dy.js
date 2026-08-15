#!/usr/bin/env node
/**
 * collation · tools/cluster-dy.js — 夺/衍句簇归并
 *
 * 字级 diff 把「注文措辞不同 / OCR 跳行」炸成几十条夺/衍单行，误导校勘记体量。
 * 本工具把同段内相邻（间隔 ≤2 个同字）的夺/衍归并为一个短语级句簇：
 *   纯善本侧字 → 衍簇；纯现代本侧字 → 夺簇；两侧兼有 → 换簇（短语级异文）。
 * 输出 data/<书>/clusters.json，供 verify-clusters.js 逐簇视觉核验。
 *
 * 用法: node collation/tools/cluster-dy.js <书> [--gap=2]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { diff } = require('../src/diff');

const workId = process.argv[2];
if (!workId) { console.error('用法: node collation/tools/cluster-dy.js <书>'); process.exit(1); }
const gapArg = (process.argv.find(a => a.startsWith('--gap=')) || '').split('=')[1];
const GAP = gapArg ? +gapArg : 2;

const d = diff(workId);
const clusters = [];
let cid = 0;

for (const seg of d.segments) {
  const det = seg.shanben.detail || [];
  // 段内夺/衍的下标
  const idx = [];
  for (let k = 0; k < det.length; k++) {
    if (det[k].type === '夺' || det[k].type === '衍') idx.push(k);
  }
  if (!idx.length) continue;
  // 按间隔归并
  let start = idx[0], prev = idx[0];
  const spans = [];
  for (let i = 1; i <= idx.length; i++) {
    if (i === idx.length || idx[i] - prev > GAP + 1) {
      spans.push([start, prev]);
      if (i < idx.length) start = idx[i];
    }
    if (i < idx.length) prev = idx[i];
  }
  for (const [i, j] of spans) {
    const run = det.slice(i, j + 1);
    const sbPhrase = run.filter(x => x.sb).map(x => x.sb.ch).join('');
    const xdPhrase = run.filter(x => x.xd).map(x => x.xd.ch).join('');
    const sbPages = [...new Set(run.filter(x => x.sb).map(x => x.sb.page))].sort((a, b) => a - b);
    const kind = sbPhrase && xdPhrase ? '换' : (sbPhrase ? '衍' : '夺');
    // 前后锚（各侧同字上下文）+ 邻近善本页（纯夺簇借此定位善本查验页）
    const CTX = 10;
    const before = det.slice(Math.max(0, i - CTX), i), after = det.slice(j + 1, j + 1 + CTX);
    const aroundPages = [...before, ...after].filter(x => x.sb).map(x => x.sb.page);
    clusters.push({
      id: `c${++cid}`,
      segId: seg.segId,
      kind,                       // 夺=善本无现代有 / 衍=善本多 / 换=两侧措辞异
      shanben: sbPhrase || null,
      xiandai: xdPhrase || null,
      sbPages,                    // 善本页（簇内善本字所在页）
      sbPagesAround: [...new Set(aroundPages)].sort((a, b) => a - b),
      xdPage: seg.xiandai.page,   // 现代本页（儒藏本_pdf page 号）
      anchor: {
        sbBefore: before.filter(x => x.sb).map(x => x.sb.ch).join(''),
        sbAfter: after.filter(x => x.sb).map(x => x.sb.ch).join(''),
        xdBefore: before.filter(x => x.xd).map(x => x.xd.ch).join(''),
        xdAfter: after.filter(x => x.xd).map(x => x.xd.ch).join(''),
      },
      segXiandai: seg.xiandai.raw,
      chars: sbPhrase.length + xdPhrase.length,
    });
  }
}

const dir = path.join(__dirname, '..', 'data', workId);
fs.writeFileSync(path.join(dir, 'clusters.json'), JSON.stringify(clusters, null, 2));

const byKind = {};
for (const c of clusters) byKind[c.kind] = (byKind[c.kind] || 0) + 1;
const covered = clusters.reduce((s, c) => s + Math.max(c.shanben?.length || 0, c.xiandai?.length || 0), 0);
console.log(`${workId} 句簇 ${clusters.length} 个`, byKind, `覆盖约 ${covered} 字`);
for (const c of clusters) {
  console.log(` ${c.id} ${c.kind} 善「${(c.shanben || '∅').slice(0, 20)}」今「${(c.xiandai || '∅').slice(0, 20)}」 善p${c.sbPages.join('/')} 今p${c.xdPage}`);
}
