#!/usr/bin/env node
/**
 * collation · 主入口（collation/run.js）
 * 用法:
 *   node collation/run.js <书名> [--step=all|align|diff|verify|officer|export|apply] [--decisions=<路径>]
 *   无 API key 走 mock 基线，仍产出完整双本 + 校勘记 + flags。
 *
 * 阶段（全链 all = align→diff→verify→officer→export）：
 *   align   P3 对齐          diff    P4 对校（字级 + 簇级原生归并）
 *   verify  P4.5 簇双侧视觉核验      officer P5 校书官裁决（真异文+ocr疑+核验为真的簇）
 *   export  P6 双本 + 校勘记 + 精校台 + P7 flags
 *   apply   P7 回灌：--decisions=decisions.json → 人工裁定写入 verdicts → 重出定本
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { align } = require('./src/align');
const { diff } = require('./src/diff');
const { adjudicate } = require('./src/officer');
const { reconfirm } = require('./src/reconfirm');
const { exportAll } = require('./src/export');
const { verifyClusters, migrateVerifications } = require('./src/cluster');
const { engine } = require('./src/llm');
const { privateWorkDir, privatePath, internalReadPath } = require('./src/paths');
const { loadM2Base } = require('./src/base');

const args = process.argv.slice(2);
const flags = {}, pos = [];
for (const a of args) { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) flags[m[1]] = m[2] ?? true; else pos.push(a); }
const workId = pos[0];
const step = flags.step || 'all';
if (!workId) { console.error('用法: node collation/run.js <书名> [--step=...]'); process.exit(1); }

function writeAligned(workId) {
  const r = align(workId);
  const d = privateWorkDir(workId);
  fs.writeFileSync(path.join(d, 'aligned.json'), JSON.stringify(r.segments.map(s => ({
    segId: s.segId, score: s.score, orphan: !!s.orphan, xiandai: s.xiandai.raw, page: s.xiandai.page,
    shanben: (s.shanben.detail || []).filter(x => x.sb).map(x => x.sb.ch).join(''),
  })), null, 2));
  console.log(`✓ 对齐 ${r.segments.length} 段（orphan ${r.segments.filter(s => s.orphan).length}），善本 ${r.sbNorm.length} 字，句 ${r.sents.length}，校记 ${r.notes.length}`);
}

function writeDiff(workId) {
  const r = diff(workId);
  const d = privateWorkDir(workId);
  fs.writeFileSync(path.join(d, 'diffs.json'), JSON.stringify(r.variants.map(v => ({
    id: v.id, type: v.type, shanben: v.shanben, xiandai: v.xiandai, pos: v.pos, note: v.note, seg: v.seg.xiandai, ctx: v.ctx,
  })), null, 2));
  fs.writeFileSync(path.join(d, 'clusters.json'), JSON.stringify(r.clusters, null, 2));
  const mig = migrateVerifications(workId, r.clusters);  // 编号漂移：旧核验结论按内容键迁移
  if (mig.kept || mig.dropped) console.log(`  簇核验迁移：留 ${mig.kept} / 弃 ${mig.dropped}（待 verify 重核）`);
  console.log(`✓ 字级异文 ${r.variants.length} 条（异体 ${r.summary.异体 || 0} / 真异文 ${r.summary.真异文 || 0} / ocr疑 ${r.summary.ocr疑 || 0}）+ 簇 ${r.clusters.length} 个`, r.summary.簇);
}

function readCurrentVerdicts(workId) {
  const m2 = loadM2Base(workId);
  const vpath = internalReadPath(workId, 'verdicts.json');
  if (!fs.existsSync(vpath)) { console.error('✗ 无当前 M2 对应 verdicts.json，先跑 --step=officer 或 all'); process.exit(1); }
  const verdicts = JSON.parse(fs.readFileSync(vpath, 'utf8'));
  const stale = verdicts.filter(v => v.baseSha256 !== m2.sha256);
  if (stale.length) {
    console.error(`✗ verdicts.json 有 ${stale.length} 条不是当前 M2（${m2.sha256.slice(0, 12)}）生成；请重跑 --step=officer 或 all`);
    process.exit(1);
  }
  return { verdicts, m2 };
}

async function runVerify(workId) {
  const r = await verifyClusters(workId, {
    conc: +(flags.conc || 3),
    only: flags.only,
    onProgress: (i, n, x) => { if (x) console.error(`  簇核验 ${i}/${n}：${x.c.id} ${x.c.kind} → ${x.r.verdict}（${x.r.engine}）`); },
  });
  console.log(`✓ 簇核验 ${r.total} 个`, r.stat);
}

(async () => {
  console.log(`〔collation〕作品=${workId} step=${step} engine=${engine}`);
  const t0 = Date.now();

  if (step === 'align') { writeAligned(workId); return; }
  if (step === 'diff') { writeDiff(workId); return; }
  if (step === 'verify') { await runVerify(workId); return; }

  if (step === 'apply') {
    // P7 回灌：精校台 decisions.json → verdicts.json（verdict:'human'）→ 重出定本
    const decPath = flags.decisions;
    if (!decPath || !fs.existsSync(decPath)) { console.error('✗ --decisions=<decisions.json 路径> 必填'); process.exit(1); }
    const payload = JSON.parse(fs.readFileSync(decPath, 'utf8'));
    if (payload.work && payload.work !== workId) console.error(`  ⚠ decisions 属「${payload.work}」，当前作品「${workId}」，仍继续`);
    const decisions = payload.decisions || {};
    const { verdicts, m2 } = readCurrentVerdicts(workId);
    let hit = 0;
    for (const v of verdicts) {
      const dec = decisions[v.diffId];
      if (!dec || !dec.choice) continue;
      v.verdict = 'human';
      v.adopt = dec.choice;                    // shanben | xiandai | neither
      v.humanNote = dec.note || '';
      v.decidedBy = 'human';                   // 机器四官意见原文保留于 opinions，可推翻可追溯
      hit++;
    }
    fs.writeFileSync(privatePath(workId, 'verdicts.json'), JSON.stringify(verdicts, null, 2));
    console.log(`✓ 回灌人工裁定 ${hit} 条（decisions 共 ${Object.keys(decisions).length} 条）`);
    const D = diff(workId);
    const result = { ...D, verdicts, verdictSummary: { total: verdicts.length, resolved: verdicts.filter(v => v.verdict === 'resolved').length, suspended: verdicts.filter(v => v.verdict === 'suspended').length, human: hit, engine } };
    const r = exportAll(result, workId);
    console.log(`✓ 重出定本：${r.dir}/output/{善本点校本,现代本,校勘记}.md${r.reviewInfo || ''}`);
    return;
  }

  if (step === 'all') {
    writeAligned(workId);
    writeDiff(workId);
    await runVerify(workId);
  }

  // officer / all / export
  let result;
  if (step === 'export') {
    const { verdicts } = readCurrentVerdicts(workId);
    const D = diff(workId);
    result = { ...D, verdicts, verdictSummary: { total: verdicts.length, resolved: verdicts.filter(v => v.verdict === 'resolved').length, suspended: verdicts.filter(v => v.verdict === 'suspended').length, human: verdicts.filter(v => v.verdict === 'human').length, engine } };
  } else {
    result = await adjudicate(workId, {
      conc: +(flags.conc || 3),
      onProgress: (i, n, v) => console.error(`  校书官 ${i}/${n}：${v.id} ${v.type} 善「${(v.shanben || '∅').slice(0, 10)}」/今「${(v.xiandai || '∅').slice(0, 10)}」`),
    });
    console.log(`✓ 字级异文 ${result.variants.length} 条 + 簇 ${result.clusters.length} 个 ${JSON.stringify(result.summary.簇 || {})}`);
    console.log(`✓ 校书官裁决：resolved ${result.verdictSummary.resolved}，suspended ${result.verdictSummary.suspended}（engine=${engine}，簇入裁 ${result.verdictSummary.byType.簇 || 0}）`);
  }

  if (step === 'officer') return;

  // 视觉复核（仅兜底 ocr疑；干净底本经 verify-v2 后真疑难已覆校，真异文归校书官，不再重复视觉复核）
  reconfirm(result.variants, workId, { types: ['ocr疑'], limit: 20 }).catch(() => {});

  const r = exportAll(result, workId);
  console.log(`✓ 公开出具：${r.dir}/output/{善本点校本,校勘记}.md`);
  console.log(`✓ 私有出具：${r.privateDir}/output/{现代本,精校台}.md/html + flags.yaml (${r.flagsCount} 待办)${r.reviewInfo || ''}`);
  console.log(`  善本点校本定论夹注 ${r.shanbenResolved} 条 | 悬置 ${r.suspended} 条`);
  console.log(`〔${((Date.now() - t0) / 1000).toFixed(1)}s〕完成`);
})().catch(e => { console.error('✗', e); process.exit(1); });
