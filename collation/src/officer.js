/**
 * collation · P5 校书官裁决（src/officer.js）
 * 对 diff() 的「真异文」「ocr疑」逐条：四校书官各陈意见 → 陈列 → 出结论 resolved / 悬置 suspended。
 *
 * 裁决规则（从理不从众）：
 *   - 四官意见并陈，不强求一致。
 *   - ≥3 官同 adopt（非 suspend）且平均置信 ≥0.6 → resolved，采该 adopt。
 *   - 否则 → suspended，给暂拟倾向（最多 adopt 方，无则 neither）+ 待查线索。
 *   - mock 兜底：按各官方法论倾向 + 异文类型出确定性意见，标 _engine:'mock'。
 */
'use strict';
const { complete, engine, loadOfficerProfile } = require('./llm');
const { diff } = require('./diff');

const OFFICERS = ['liu-xiang', 'jie-xian', 'dai-zhen', 'ji-yun'];
const OFFICER_NAME = { 'liu-xiang': '刘向', 'jie-xian': '解缙', 'dai-zhen': '戴震', 'ji-yun': '纪昀' };

/** mock：各官按倾向 + 异文类型出确定性意见 */
function mockOpinion(officer, v) {
  const sb = v.shanben || '∅', xd = v.xiandai || '∅';
  if (v.type === '异体') {
    return { officer, adopt: 'shanben', candidate: sb, confidence: 0.85,
      reason: `${sb}与${xd}异体同字。${leanNote(officer,'古本之形当存')}善本用${sb}，存其旧不改。` };
  }
  if (v.type === 'ocr疑') {
    return { officer, adopt: 'xiandai', candidate: xd, confidence: 0.5,
      reason: `${sb}疑善本 OCR 误读，现代本作${xd}。${leanNote(officer,'姑从现代本')}，待视觉复核善本扫描定夺。`,
      线索: '待视觉复核(P2.5)' };
  }
  // 真异文：各官倾向不同
  const leans = { 'liu-xiang': { adopt: 'shanben', conf: 0.6, why: '重古本源流：善本之字非有显据不轻改，姑从善本' },
                  'jie-xian':  { adopt: 'suspend', conf: 0.3, why: '须参群籍所引此句作何字，无旁证则存疑' },
                  'dai-zhen':  { adopt: 'suspend', conf: 0.3, why: '须验义理通否、音韵训诂；两可则不强断' },
                  'ji-yun':    { adopt: 'suspend', conf: 0.3, why: '诸说未齐，宜并陈存疑，俟旁证' } };
  const l = leans[officer];
  return { officer, adopt: l.adopt, candidate: l.adopt === 'shanben' ? sb : (l.adopt === 'xiandai' ? xd : null),
    confidence: l.conf, reason: `${l.why}。善本「${sb}」现代本「${xd}」。`, 线索: l.adopt === 'suspend' ? '待考群籍/音韵/训诂' : null };
}
function leanNote(officer, base) {
  const m = { 'liu-xiang': '（重古本）', 'jie-xian': '（重旁证）', 'dai-zhen': '（重考据）', 'ji-yun': '（折中）' };
  return base + (m[officer] || '');
}

/** 单官真实 LLM 审议 */
async function officerOpinion(officer, v, ctx) {
  const system = loadOfficerProfile(officer);
  const user = `审议异文（以你 ${OFFICER_NAME[officer]} 之方法）：
- 善本（当涂郡斋刊递修本，南宋）：「${v.shanben || '∅'}」
- 现代本（儒藏精华编）：「${v.xiandai || '∅'}」
- 异文类型：${v.type}
- 所在句（现代本）：${v.seg.xiandai}
- 上下文：${v.ctx}
- 校记线索（现代本已剥离的校记）：${(ctx.notes || []).filter(n => (n.text || '').includes(v.shanben || '')).map(n => n.text).join('；') || '无'}

按 officers/README.md 的 JSON 结构输出：{ officer, adopt:'shanben|xiandai|neither|suspend', candidate, reason, confidence:0-1, 线索? }。reason 须可追溯。`;
  return complete({
    system, user,
    fallback: () => mockOpinion(officer, v),
  });
}

/** 聚合：resolved / suspended */
function aggregate(opinions, v) {
  const valid = opinions.filter(o => o && o.adopt);
  const counts = {};
  for (const o of valid) counts[o.adopt] = (counts[o.adopt] || 0) + 1;
  let best = null, bestN = 0;
  for (const [a, n] of Object.entries(counts)) {
    if (a === 'suspend') continue;
    if (n > bestN) { best = a; bestN = n; }
  }
  const avgConf = valid.length ? valid.reduce((s, o) => s + (o.confidence || 0), 0) / valid.length : 0;
  const resolved = best && bestN >= 3 && avgConf >= 0.6;
  const suspend = !resolved;
  // 暂拟倾向
  let tentative = null;
  if (suspend) tentative = best || (counts.suspend >= 2 ? 'neither' : 'neither');
  return {
    diffId: v.id, type: v.type, shanben: v.shanben, xiandai: v.xiandai, pos: v.pos,
    opinions: valid.map(o => ({ officer: o.officer, name: OFFICER_NAME[o.officer], adopt: o.adopt, candidate: o.candidate, reason: o.reason, confidence: o.confidence, 线索: o.线索 })),
    verdict: resolved ? 'resolved' : 'suspended',
    adopt: resolved ? best : null,
    tentative: suspend ? tentative : null,
    seg: v.seg, ctx: v.ctx,
  };
}

/** 校书官裁决主入口（对 diff 的真异文 + ocr疑） */
async function adjudicate(workId, opts = {}) {
  const D = diff(workId);
  const targets = D.variants.filter(v => v.type === '真异文' || v.type === 'ocr疑');
  const verdicts = [];
  let i = 0;
  for (const v of targets) {
    i++;
    if (opts.onProgress) opts.onProgress(i, targets.length, v);
    const ops = await Promise.all(OFFICERS.map(off => officerOpinion(off, v, { notes: D.notes })));  // 4官并行
    verdicts.push(aggregate(ops, v));
  }
  const summary = {
    total: verdicts.length,
    resolved: verdicts.filter(v => v.verdict === 'resolved').length,
    suspended: verdicts.filter(v => v.verdict === 'suspended').length,
    byType: { 真异文: targets.filter(v => v.type === '真异文').length, ocr疑: targets.filter(v => v.type === 'ocr疑').length },
    engine,
  };
  return { ...D, verdicts, verdictSummary: summary };
}

module.exports = { adjudicate, aggregate, mockOpinion, OFFICERS, OFFICER_NAME };
