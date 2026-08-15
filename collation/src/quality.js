/** P1.5/P3 质量闸：把清洗与对齐的残余风险量化为可审阅报告。 */
'use strict';

function segShanben(seg) {
  return (seg.shanben.detail || []).filter(d => d.sb).map(d => d.sb.ch).join('');
}

function shanbenRefs(seg) {
  const seen = new Set();
  return (seg.shanben?.detail || []).filter(d => d.sb).map(d => ({
    page: d.sb.page,
    line: d.sb.line,
    regionId: d.sb.regionId || null,
    sourceHash: d.sb.sourceHash || null,
  })).filter(ref => {
    const key = `${ref.page}:${ref.line}:${ref.regionId || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function xiandaiRefs(seg) {
  return {
    pages: seg.xiandai?.page == null ? [] : [seg.xiandai.page],
    regionIds: seg.xiandai?.regionIds || [],
    sourceHash: seg.xiandai?.sourceHash || null,
  };
}

function suffixPrefixOverlap(a, b, min = 6, max = 80) {
  const n = Math.min(a.length, b.length, max);
  for (let len = n; len >= min; len--) if (a.slice(-len) === b.slice(0, len)) return len;
  return 0;
}

function evaluateAlignment(result) {
  const segments = result.segments || [];
  const exact = segments.filter(s => s.score === 1).length;
  const fuzzy = segments.filter(s => s.score > 0 && s.score < 1).length;
  const orphan = segments.filter(s => s.orphan).length;
  const lowScore = segments.filter(s => !s.orphan && s.score < 0.8).length;
  const overlaps = [];
  const orphanItems = [];
  const lowScoreItems = [];
  for (let i = 1; i < segments.length; i++) {
    const prev = segShanben(segments[i - 1]);
    const curr = segShanben(segments[i]);
    const length = suffixPrefixOverlap(prev, curr);
    if (length) overlaps.push({
      prevSegId: segments[i - 1].segId,
      segId: segments[i].segId,
      length,
      prev: { shanben: shanbenRefs(segments[i - 1]), xiandai: xiandaiRefs(segments[i - 1]) },
      current: { shanben: shanbenRefs(segments[i]), xiandai: xiandaiRefs(segments[i]) },
    });
  }
  for (const seg of segments) {
    if (seg.orphan) orphanItems.push({ segId: seg.segId, xiandai: xiandaiRefs(seg) });
    else if (seg.score < 0.8) lowScoreItems.push({ segId: seg.segId, score: seg.score, shanben: shanbenRefs(seg), xiandai: xiandaiRefs(seg) });
  }
  const blockers = [];
  if (orphan) blockers.push(`${orphan} 个现代本句段未在善本对应`);
  if (lowScore) blockers.push(`${lowScore} 个对齐段得分低于 0.8`);
  if (overlaps.length) blockers.push(`${overlaps.length} 处相邻善本文字重叠，疑 OCR 跨页重复或错位`);
  return {
    segments: segments.length,
    exact,
    fuzzy,
    orphan,
    lowScore,
    orphanItems,
    lowScoreItems,
    adjacentOverlaps: overlaps,
    pass: blockers.length === 0,
    blockers,
  };
}

function buildQualityReport(result) {
  const cleaning = {
    shanben: { stats: result.cleaned.shanben.stats, quality: result.cleaned.shanben.quality },
    xiandai: { stats: result.cleaned.xiandai.stats, quality: result.cleaned.xiandai.quality },
  };
  const alignment = evaluateAlignment(result);
  const m2 = result.cleaned.shanben.m2;
  const baseBlockers = [];
  if (!m2) baseBlockers.push('缺少 M2 shanben-v2 新底本');
  else if (m2.pendingCount) baseBlockers.push(`M2 尚有 ${m2.pendingCount} 处待覆校，暂不可发布`);
  const blockers = [
    ...baseBlockers,
    ...cleaning.shanben.quality.blockers,
    ...cleaning.xiandai.quality.blockers,
    ...alignment.blockers,
  ];
  return {
    schemaVersion: 1,
    work: result.work.id,
    status: blockers.length ? 'draft' : 'reviewed',
    cleaning,
    base: m2 ? {
      source: m2.source,
      sha256: m2.sha256,
      pendingVerify: m2.pendingCount,
      verified: m2.pendingCount === 0,
    } : null,
    alignment,
    reviewQueue: [
      ...alignment.orphanItems.map(x => ({ kind: 'orphan', ...x })),
      ...alignment.lowScoreItems.map(x => ({ kind: 'low-score', ...x })),
      ...alignment.adjacentOverlaps.map(x => ({ kind: 'adjacent-overlap', ...x })),
    ],
    blockers,
  };
}

module.exports = { suffixPrefixOverlap, evaluateAlignment, buildQualityReport };
