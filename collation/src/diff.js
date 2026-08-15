/**
 * collation · P4 对校（src/diff.js）
 * 取 align() 产出的对齐段，平坦化为异文清单 + 归类 + 上下文。
 *
 * 字级异文类型（variants，v 编号）:
 *   异体    — 归一后合、raw 形异（善本古字/异体），非真异文，登记善本用形
 *   ocr疑   — 归一后仍不合、且现代本统一而善本独异、字形相近 → 疑善本 OCR 误读
 *   真异文  — 归一后仍不合、两本各通（如「親/新」「矣」之有无）→ 校书官主战场
 *
 * 簇级异文（clusters，c 编号）——夺/衍不再逐字炸开，由 clusterize() 原生归并：
 *   夺簇   — 现代本有、善本无的连续短语（含 orphan 整段）
 *   衍簇   — 善本有、现代本无的连续短语
 *   换簇   — 两侧兼有、措辞相异（注文异文等多属此）
 *   → 交 P4.5 簇核验（src/cluster.js）后再定真伪，杜绝「一处错位 = 十行假异文」。
 */
'use strict';
const { align, normChar } = require('./align');
const { clusterize } = require('./cluster');

function ctx(sbNorm, pos, n = 6) {
  if (pos == null) return '';
  const a = Math.max(0, pos - n), b = Math.min(sbNorm.length, pos + n + 1);
  return sbNorm.slice(a, b);
}

function diff(workId) {
  const A = align(workId);
  const variants = [];
  let id = 0;
  for (const seg of A.segments) {
    if (seg.orphan) continue;  // 整段由簇级承接
    const det = seg.shanben.detail || [];
    for (let k = 0; k < det.length; k++) {
      const d = det[k];
      if (d.type === '同' || d.type === '夺' || d.type === '衍') continue;  // 夺/衍归簇级
      const sbCh = d.sb ? d.sb.ch : null;
      const xdCh = d.xd ? d.xd.ch : null;
      let type, note;
      if (d.type === '异体') {
        type = '异体';
        note = `善本「${sbCh}」现代本「${xdCh}」异体同字`;
      } else { // 疑异（fuzzy sub）
        const sameNorm = d.sb && d.xd && normChar(d.sb.ch) === normChar(d.xd.ch);
        if (sameNorm) { type = '异体'; note = `善本「${sbCh}」现代本「${xdCh}」异体同字`; }
        else if (isOcrLike(sbCh, xdCh)) { type = 'ocr疑'; note = `善本「${sbCh}」疑 OCR 误读，现代本作「${xdCh}」`; }
        else { type = '真异文'; note = `善本「${sbCh || '∅'}」现代本「${xdCh || '∅'}」`; }
      }
      variants.push(mkVar(++id, seg, type, sbCh, xdCh, note, A.sbNorm,
        d.sb ? d.sb.page + ':' + d.sb.line : seg.xiandai.page, k));
    }
  }
  const clusters = clusterize(A.segments);
  const summary = countBy(variants);
  summary.簇 = {};
  for (const c of clusters) summary.簇[c.kind] = (summary.簇[c.kind] || 0) + 1;
  return { ...A, variants, clusters, summary };
}

/** 字形相近判 OCR 误读（粗：笔画少改、部件同/近） */
function isOcrLike(a, b) {
  if (!a || !b) return false;
  if (a === b) return false;
  // 同部首/近形粗判：共享偏旁或一字含另一字
  const r = Math.abs(a.length - b.length) <= 0; // 单字
  return r && (a.includes(b) || b.includes(a) || shareRad(a, b));
}
function shareRad(a, b) {
  const rad = ['辶', '言', '心', '忄', '水', '氵', '木', '人', '亻', '日', '月', '糸', '衣', '見'];
  return rad.some(r => a.includes(r) && b.includes(r));
}

function mkVar(id, seg, type, sbCh, xdCh, note, sbNorm, pos, k) {
  return {
    id: `v${id}`,
    segId: seg.segId,
    type,
    shanben: sbCh,
    xiandai: xdCh,
    note,
    seg: { xiandai: seg.xiandai.raw, page: seg.xiandai.page },
    pos,
    ctx: ctx(sbNorm, typeof pos === 'string' ? null : (seg.shanben.span ? seg.shanben.span[0] + (k || 0) : null)),
  };
}
function countBy(vs) {
  const c = {};
  for (const v of vs) c[v.type] = (c[v.type] || 0) + 1;
  c.total = vs.length;
  return c;
}

module.exports = { diff };
