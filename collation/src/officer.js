/**
 * collation · P5 校书官裁决（src/officer.js）
 * 对 diff() 的「真异文」「ocr疑」及 P4.5 核验为真的夺/衍/换簇：四校书官各陈意见 → 加权聚合 → resolved / suspended。
 *
 * 裁决规则（参照陈垣校法四则与 ops_dianjiao 方案升级，从理不从众）：
 *   - 证据分级：確證1.0 / 旁證0.7 / 推測0.4 / 無證0.15；各官意见得分 = 证据系数 × 置信度。
 *   - 底本优先：shanben 候选得分 ×(1+β)，β=0.15——「底本可通则不改」写进目标函数。
 *   - 悬置三规则（满足其一即悬置，绝不自动改字）：
 *       ① 首选得票 P(1) < τ(0.55)；② 首选次选差距 < δ(0.18)；
 *       ③ 拟改动底本正文（弃善本从他本）而四官皆无確證/旁證——最要紧。
 *   - mock 兜底：按各官方法论倾向出确定性意见，标 engine:'mock'（回归基线）。
 *
 * 编号迁移：底本/对校变更后 v 编号会漂移——载入旧 verdicts.json 时按
 * (type, shanben, xiandai, seg) 内容键重映射到新编号，已裁条目不重跑。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { complete, engine, loadOfficerProfile } = require('./llm');
const { diff } = require('./diff');
const { privatePath, internalReadPath } = require('./paths');
const { loadVerifications } = require('./cluster');
const { loadM2Base } = require('./base');

const OFFICERS = ['liu-xiang', 'jie-xian', 'dai-zhen', 'ji-yun'];
const OFFICER_NAME = { 'liu-xiang': '刘向', 'jie-xian': '解缙', 'dai-zhen': '戴震', 'ji-yun': '纪昀' };

const GRADE_COEF = { '確證': 1.0, '旁證': 0.7, '推測': 0.4, '無證': 0.15 };
const GRADE_RANK = { '確證': 3, '旁證': 2, '推測': 1, '無證': 0 };
const BASE_BETA = 0.15;   // 底本优先偏置
const TAU = 0.55;         // 首选读法最低占比
const DELTA = 0.18;       // 首选与次选最小差距

/** mock：各官按倾向 + 异文类型出确定性意见 */
function mockOpinion(officer, v) {
  const sb = v.shanben || '∅', xd = v.xiandai || '∅';
  if (v.type === 'ocr疑') {
    return { officer, adopt: 'xiandai', candidate: xd, confidence: 0.5, grade: '推測',
      reason: `${sb}疑善本 OCR 误读，现代本作${xd}。${leanNote(officer)}，待视觉复核善本扫描定夺。`,
      线索: '待视觉复核' };
  }
  const leans = { 'liu-xiang': { adopt: 'shanben', conf: 0.6, grade: '推測', why: '重古本源流：善本之字非有显据不轻改，姑从善本' },
                  'jie-xian':  { adopt: 'suspend', conf: 0.3, grade: '無證', why: '须参群籍所引此句作何字，无旁证则存疑' },
                  'dai-zhen':  { adopt: 'suspend', conf: 0.3, grade: '無證', why: '须验义理通否、音韵训诂；两可则不强断' },
                  'ji-yun':    { adopt: 'suspend', conf: 0.3, grade: '無證', why: '诸说未齐，宜并陈存疑，俟旁证' } };
  const l = leans[officer];
  return { officer, adopt: l.adopt, candidate: l.adopt === 'shanben' ? sb : (l.adopt === 'xiandai' ? xd : null),
    confidence: l.conf, grade: l.grade, reason: `${l.why}。善本「${sb}」现代本「${xd}」。`, 线索: l.adopt === 'suspend' ? '待考群籍/音韵/训诂' : null };
}
function leanNote(officer) {
  const m = { 'liu-xiang': '（重古本）', 'jie-xian': '（重旁证）', 'dai-zhen': '（重考据）', 'ji-yun': '（折中）' };
  return m[officer] || '';
}

/** 单官真实 LLM 审议。ctx.shanbenTitle 可传底本描述（editions.yaml 派生），未传用双书默认 */
async function officerOpinion(officer, v, ctx) {
  const system = loadOfficerProfile(officer);
  const sbTitle = (ctx && ctx.shanbenTitle) || '当涂郡斋刊递修本，南宋';
  const user = `审议异文（以你 ${OFFICER_NAME[officer]} 之方法）：
- 善本（${sbTitle}）：「${v.shanben || '∅'}」
- 现代本（儒藏精华编）：「${v.xiandai || '∅'}」
- 异文类型：${v.type}${v.cluster ? '（短语级，双侧所引为连续文字）' : ''}
- 所在句（现代本）：${v.seg.xiandai}
- 上下文：${v.ctx}
- 校记线索（现代本已剥离的校记）：${(ctx.notes || []).filter(n => (n.text || '').includes(v.shanben || '')).map(n => n.text).join('；') || '无'}

按 officers/README.md 的 JSON 结构输出：{ officer, adopt:'shanben|xiandai|neither|suspend', candidate, reason, confidence:0-1, grade, 线索? }。
**grade 必填**：確證（版本实物/书影/明文记载之硬据）｜旁證（群籍他本所引，须指出处）｜推測（义理/文例推断）｜無證（提不出据）。
reason 须可追溯；凡欲弃善本从他本者，须確證或旁證，推測不足改字。`;
  return complete({
    system, user,
    fallback: () => mockOpinion(officer, v),
  });
}

/** 加权聚合：证据分级 × 置信 + 底本优先 β + 悬置三规则 */
function aggregate(opinions, v) {
  const valid = opinions.filter(o => o && o.adopt);
  const scores = {};
  for (const o of valid) {
    if (o.adopt === 'suspend') continue;
    const g = GRADE_COEF[o.grade] ?? 0.4;
    scores[o.adopt] = (scores[o.adopt] || 0) + g * (o.confidence || 0);
  }
  if (scores.shanben) scores.shanben = +(scores.shanben * (1 + BASE_BETA)).toFixed(4);
  const total = Object.values(scores).reduce((a, b) => a + b, 0) || 1;
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const p1 = ranked.length ? ranked[0][1] / total : 0;
  const p2 = ranked.length > 1 ? ranked[1][1] / total : 0;
  const top = ranked.length ? ranked[0][0] : 'neither';
  const bestGrade = Math.max(0, ...valid.map(o => GRADE_RANK[o.grade] ?? 0));
  const wouldAmend = top !== 'shanben' && top !== 'neither';
  const reasons = [];
  if (p1 < TAU) reasons.push(`首选得票 ${p1.toFixed(2)} < τ${TAU}`);
  if (ranked.length > 1 && p1 - p2 < DELTA) reasons.push(`首选次选差 ${(p1 - p2).toFixed(2)} < δ${DELTA}`);
  if (wouldAmend && bestGrade <= GRADE_RANK['推測']) reasons.push('拟弃善本从他本而四官皆无確證/旁證');
  if (!ranked.length || top === 'neither') reasons.push('诸官未形成候选（皆悬或主两存）');
  const resolved = reasons.length === 0;
  return {
    diffId: v.id, type: v.type, shanben: v.shanben, xiandai: v.xiandai, pos: v.pos,
    opinions: valid.map(o => ({ officer: o.officer, name: OFFICER_NAME[o.officer] || o.officer, adopt: o.adopt, candidate: o.candidate, reason: o.reason, confidence: o.confidence, grade: o.grade || '推測', 线索: o.线索 })),
    verdict: resolved ? 'resolved' : 'suspended',
    adopt: resolved ? top : null,
    tentative: resolved ? null : (top !== 'neither' ? top : 'neither'),
    suspendReasons: resolved ? [] : reasons,
    scores,
    seg: v.seg, ctx: v.ctx,
  };
}

/** 簇级条目 → 裁决目标形态（与字级 Variant 同构） */
function clusterTarget(c) {
  return {
    id: c.id, type: c.kind, cluster: true,
    shanben: c.shanben, xiandai: c.xiandai,
    pos: (c.sbPages[0] ? c.sbPages[0] + ':' + '' : '') || ('今p' + c.xdPage),
    seg: { xiandai: c.segXiandai, page: c.xdPage },
    ctx: `善[${c.anchor.sbBefore}【${c.shanben || '∅'}】${c.anchor.sbAfter}] 今[${c.anchor.xdBefore}【${c.xiandai || '∅'}】${c.anchor.xdAfter}]`,
  };
}

/** 旧裁决按内容键迁移到新编号（编号随对校漂移，内容不变） */
function contentKey(x) {
  const segText = typeof x.seg === 'string' ? x.seg : (x.seg && x.seg.xiandai) || '';
  return [x.type, x.shanben || '', x.xiandai || '', segText].join('|');
}
function migrateVerdicts(old, targets) {
  const pool = new Map();
  for (const t of targets) {
    const k = contentKey(t);
    if (!pool.has(k)) pool.set(k, []);
    pool.get(k).push(t.id);
  }
  const out = [], dropped = [];
  for (const v of old) {
    if (String(v.diffId).startsWith('c')) { out.push(v); continue; }  // 簇裁决 id 稳定
    const q = pool.get(contentKey(v));
    if (q && q.length) { v.diffId = q.shift(); out.push(v); }
    else dropped.push(v.diffId);
  }
  if (dropped.length) console.error(`  ⚠ ${dropped.length} 条旧裁决无对应异文（底本/对校已变），弃置：${dropped.slice(0, 8).join(',')}…`);
  return out;
}

/** 校书官裁决主入口（真异文 + ocr疑 + 核验为真的夺/衍/换簇）。增量保存 + 断点续传 + 条间并行。 */
async function adjudicate(workId, opts = {}) {
  const m2 = loadM2Base(workId);
  const D = diff(workId);
  const charTargets = D.variants.filter(v => v.type === '真异文' || v.type === 'ocr疑');
  // P4.5 核验为真的簇入裁；未核验/核验为噪声者不入
  const verifs = loadVerifications(workId);
  const vmap = {}; verifs.forEach(x => vmap[x.id] = x);
  const clusterTargets = (D.clusters || []).filter(c => vmap[c.id] && vmap[c.id].verdict === '真异文').map(clusterTarget);
  const targets = [...charTargets, ...clusterTargets];

  const conc = opts.conc || 3;
  const oldPath = internalReadPath(workId, 'verdicts.json');
  const outPath = privatePath(workId, 'verdicts.json');
  let verdicts = fs.existsSync(oldPath) ? JSON.parse(fs.readFileSync(oldPath, 'utf8')) : [];
  // M2 换底本后，旧裁决即使内容键相同也不能继续沿用；无指纹的历史裁决同样作废。
  verdicts = verdicts.filter(v => v.baseSha256 === m2.sha256);
  verdicts = migrateVerdicts(verdicts, targets);
  // 即使没有新目标需要请求，也要落盘迁移后的集合；否则被丢弃的旧条目
  // 会残留在 verdicts.json，并在后续 export 中再次混入过期裁决。
  fs.writeFileSync(outPath, JSON.stringify(verdicts, null, 2));
  const doneIds = new Set(verdicts.map(v => v.diffId));
  const todo = targets.filter(v => !doneIds.has(v.id));
  let idx = 0, done = 0;
  async function worker() {
    while (idx < todo.length) {
      const v = todo[idx++];
      try {
        const ops = await Promise.all(OFFICERS.map(off => officerOpinion(off, v, { notes: D.notes })));
        verdicts.push({ ...aggregate(ops, v), baseSha256: m2.sha256 });
      } catch (e) {
        verdicts.push({ diffId: v.id, type: v.type, shanben: v.shanben, xiandai: v.xiandai, seg: v.seg, verdict: 'error', note: String(e.message || e), opinions: [], baseSha256: m2.sha256 });
      }
      done++;
      fs.writeFileSync(outPath, JSON.stringify(verdicts, null, 2));  // 增量保存，可断点续传
      if (opts.onProgress) opts.onProgress(done, todo.length, v);
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  const summary = {
    total: verdicts.length,
    resolved: verdicts.filter(v => v.verdict === 'resolved').length,
    suspended: verdicts.filter(v => v.verdict === 'suspended').length,
    byType: {
      真异文: charTargets.filter(v => v.type === '真异文').length,
      ocr疑: charTargets.filter(v => v.type === 'ocr疑').length,
      簇: clusterTargets.length,
    },
    engine,
  };
  return { ...D, verdicts, verdictSummary: summary };
}

module.exports = { adjudicate, aggregate, mockOpinion, migrateVerdicts, officerOpinion, OFFICERS, OFFICER_NAME, GRADE_COEF };
