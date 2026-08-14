#!/usr/bin/env node
/**
 * collation · 主入口（collation/run.js）
 * 用法:
 *   node collation/run.js <书名> [--step=all|align|diff|officer|export]
 *   无 API key 走 mock 基线，仍产出完整双本 + 校勘记 + flags。
 *
 * 阶段：
 *   align   P3 对齐         diff    P4 对校
 *   officer P5 校书官裁决    export  P6 双本 + P7 flags
 *   all     全链（默认）：diff→officer→reconfirm→export
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { align } = require('./src/align');
const { diff } = require('./src/diff');
const { adjudicate } = require('./src/officer');
const { reconfirm } = require('./src/reconfirm');
const { exportAll, outDir } = require('./src/export');
const { engine } = require('./src/llm');

const args = process.argv.slice(2);
const flags = {}, pos = [];
for (const a of args) { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) flags[m[1]] = m[2] ?? true; else pos.push(a); }
const workId = pos[0];
const step = flags.step || 'all';
if (!workId) { console.error('用法: node collation/run.js <书名> [--step=...]'); process.exit(1); }

(async () => {
  console.log(`〔collation〕作品=${workId} step=${step} engine=${engine}`);
  const t0 = Date.now();

  if (step === 'align') {
    const r = align(workId);
    const d = outDir(workId);
    fs.writeFileSync(path.join(d, 'aligned.json'), JSON.stringify(r.segments.map(s => ({
      segId: s.segId, score: s.score, orphan: !!s.orphan, xiandai: s.xiandai.raw, page: s.xiandai.page,
      shanben: (s.shanben.detail || []).filter(x => x.sb).map(x => x.sb.ch).join(''),
    })), null, 2));
    console.log(`✓ 对齐 ${r.segments.length} 段（orphan ${r.segments.filter(s => s.orphan).length}），善本 ${r.sbNorm.length} 字，句 ${r.sents.length}，校记 ${r.notes.length}`);
    return;
  }

  if (step === 'diff') {
    const r = diff(workId);
    const d = outDir(workId);
    fs.writeFileSync(path.join(d, 'diffs.json'), JSON.stringify(r.variants.map(v => ({
      id: v.id, type: v.type, shanben: v.shanben, xiandai: v.xiandai, pos: v.pos, note: v.note, seg: v.seg.xiandai, ctx: v.ctx,
    })), null, 2));
    console.log(`✓ 异文 ${r.variants.length} 条`, r.summary);
    return;
  }

  // officer / all：先全量裁决
  let result;
  if (step === 'export') {
    // 载入既有 verdicts.json
    const d = outDir(workId);
    const vpath = path.join(d, 'verdicts.json');
    if (!fs.existsSync(vpath)) { console.error('✗ 无 verdicts.json，先跑 --step=officer 或 all'); process.exit(1); }
    const verdicts = JSON.parse(fs.readFileSync(vpath, 'utf8'));
    const D = diff(workId);
    result = { ...D, verdicts, verdictSummary: { total: verdicts.length, resolved: verdicts.filter(v => v.verdict === 'resolved').length, suspended: verdicts.filter(v => v.verdict === 'suspended').length, engine } };
  } else {
    result = await adjudicate(workId, {
      onProgress: (i, n, v) => console.error(`  校书官 ${i}/${n}：${v.id} ${v.type} 善「${v.shanben || '∅'}」/今「${v.xiandai || '∅'}」`),
    });
    console.log(`✓ 异文 ${result.variants.length} 条 ${JSON.stringify(result.summary)}`);
    console.log(`✓ 校书官裁决：resolved ${result.verdictSummary.resolved}，suspended ${result.verdictSummary.suspended}（engine=${engine}）`);
  }

  if (step === 'officer') return;

  // 视觉复核 ocr疑
  reconfirm(result.variants, workId).then(() => {});

  // 出具
  const r = exportAll(result, workId);
  console.log(`✓ 出具：${r.dir}/output/{善本点校本,现代本,校勘记}.md + flags.yaml (${r.flagsCount} 待办)`);
  console.log(`  善本点校本 resolved 夹注 ${r.shanbenResolved} 条 | 悬置 ${r.suspended} 条`);
  console.log(`〔${((Date.now() - t0) / 1000).toFixed(1)}s〕完成`);
})().catch(e => { console.error('✗', e); process.exit(1); });
