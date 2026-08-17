#!/usr/bin/env node
/**
 * collation · G4 校书官层建议（tools/grid-officer.js）
 * 对 grid-overlay 的格级异文（格字 vs 旧OCR/今本）逐一请四校书官审议：
 *   - 输入：modern.sub 与 oldOcr.sub 按坐标合并（同一格两源意见都给书官）
 *   - 复用 src/officer.js 的 officerOpinion（单官 LLM 审议 + mock 兜底）与
 *     aggregate（证据分级加权 + 底本优先 β + 悬置三规则，绝不自动改字）
 *   - 增量断点：私有 input_data/<书>/_derived/collation/grid-officer.json，
 *     按 baseSha256（=基础层指纹）+ 条目 id 去重，可反复续跑
 *   - 产出供精校台内嵌：每条含四官意见与聚合结论（resolved/suspended + 暂拟）
 *
 * extra/missing 类不请四官（衍/夺候选以书影为据，规则建议已明示），不耗配额。
 *
 * 用法:
 *   node collation/tools/grid-officer.js <书名> [--conc=3] [--limit=N]
 * 真实引擎需 env：DASHSCOPE_API_KEY 或 ANTHROPIC_API_KEY；无 key 走 mock（标 engine:'mock'）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { officerOpinion, aggregate, OFFICERS, OFFICER_NAME } = require('../src/officer');
const { engine } = require('../src/llm');
const { privatePath } = require('../src/paths');

const args = process.argv.slice(2);
const flags = {}, pos = [];
for (const a of args) { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) flags[m[1]] = m[2] ?? true; else pos.push(a); }
const workId = pos[0];
if (!workId) { console.error('用法: node collation/tools/grid-officer.js <书名> [--conc=3] [--limit=N]'); process.exit(1); }
const dataDir = path.join(__dirname, '..', 'data', workId);
const ov = JSON.parse(fs.readFileSync(path.join(dataDir, 'grid-overlay.json'), 'utf8'));

// ── 目标构造：按坐标合并两参校源意见 ──
const byCell = new Map(); // "p:c:r" -> target
function ensure(s) {
  const k = `${s.page}:${s.col}:${s.row}`;
  if (!byCell.has(k)) byCell.set(k, { id: 'g' + k.replace(/:/g, '-'), page: s.page, col: s.col, row: s.row, grid: s.grid, old: null, modern: null, ctxSb: s.ctxSb || '', ctxOld: '', ctxXd: '' });
  return byCell.get(k);
}
for (const s of ov.variants.oldOcr.sub || []) { const t = ensure(s); t.old = s.old; t.ctxOld = s.ctxOld || ''; }
for (const s of ov.variants.modern.sub || []) { const t = ensure(s); t.modern = s.modern; t.ctxXd = s.ctxXd || ''; t.ctxSb = t.ctxSb || s.ctxSb || ''; }

const targets = [...byCell.values()].map(t => {
  // 与现代本相异 = 真异文候选；仅旧OCR相异（今本无意见=与格一致）= ocr疑读
  const isTrue = t.modern != null && t.modern !== t.grid;
  return {
    ...t,
    type: isTrue ? '真异文' : 'ocr疑',
    shanben: t.grid,
    xiandai: t.modern != null ? t.modern : t.old,
    pos: `${t.page}:${t.col}:${t.row}`,
    seg: { xiandai: (t.ctxXd || t.ctxOld || '').slice(0, 40) },
    ctx: `善[${t.ctxSb}] 今[${t.ctxXd || t.ctxOld}]` + (t.old && t.old !== t.grid ? ` 旧OCR[${t.ctxOld}]` : ''),
  };
});

// ── 增量载入（基础层指纹锁） ──
const outPath = privatePath(workId, 'grid-officer.json');
let verdicts = [];
if (fs.existsSync(outPath)) {
  const old = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  if (old.baseSha256 === ov.base.sha256) verdicts = old.verdicts || [];
  else console.log('⚠ 基础层已变更，旧校书官意见作废重跑');
}
const doneIds = new Set(verdicts.map(v => v.diffId));
let todo = targets.filter(t => !doneIds.has(t.id));
if (flags.limit) todo = todo.slice(0, parseInt(String(flags.limit), 10));
console.log(`G4 校书官：目标 ${targets.length} 条（真异文 ${targets.filter(t => t.type === '真异文').length} / ocr疑 ${targets.filter(t => t.type === 'ocr疑').length}），已裁 ${verdicts.length}，本次待裁 ${todo.length}，engine=${engine}`);

const conc = Math.max(1, parseInt(String(flags.conc || '3'), 10));
let idx = 0, done = 0;
(async () => {
  async function worker() {
    while (idx < todo.length) {
      const t = todo[idx++];
      try {
        const ops = await Promise.all(OFFICERS.map(off => officerOpinion(off, t, { notes: [] })));
        verdicts.push({ ...aggregate(ops, t), page: t.page, col: t.col, row: t.row, baseSha256: ov.base.sha256, human: null });
      } catch (e) {
        verdicts.push({ diffId: t.id, type: t.type, shanben: t.shanben, xiandai: t.xiandai, pos: t.pos, page: t.page, col: t.col, row: t.row, verdict: 'error', note: String(e.message || e), opinions: [], baseSha256: ov.base.sha256 });
      }
      done++;
      fs.writeFileSync(outPath, JSON.stringify({ work: workId, baseSha256: ov.base.sha256, engine, verdicts }, null, 2)); // 增量保存
      if (done % 5 === 0 || done === todo.length) console.log(`  ${done}/${todo.length}（${t.id} ${t.type} ${t.shanben}/${t.xiandai}）`);
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));

  const resolved = verdicts.filter(v => v.verdict === 'resolved').length;
  const suspended = verdicts.filter(v => v.verdict === 'suspended').length;
  const err = verdicts.filter(v => v.verdict === 'error').length;
  const adoptShanben = verdicts.filter(v => v.verdict === 'resolved' && v.adopt === 'shanben').length;
  const adoptOther = verdicts.filter(v => v.verdict === 'resolved' && v.adopt !== 'shanben').length;
  console.log(`\n✓ ${outPath}`);
  console.log(`  共 ${verdicts.length} 条：resolved ${resolved}（从善本 ${adoptShanben} / 从他本 ${adoptOther}）· suspended ${suspended} · error ${err} · engine=${engine}`);
  console.log('  悬置不自动改字；resolved 也仅作精校台预填建议，最终以人工裁决为准（fixes 通道）。');
})().catch(e => { console.error('✗', e.message); process.exit(1); });
