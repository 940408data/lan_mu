/**
 * collation · P4 对校（src/diff.js）
 * 取 align() 产出的对齐段，平坦化为异文清单 + 归类 + 上下文。
 *
 * 异文类型:
 *   异体    — 归一后合、raw 形异（善本古字/异体），非真异文，登记善本用形
 *   ocr疑   — 归一后仍不合、且现代本统一而善本独异、字形相近 → 疑善本 OCR 误读
 *   真异文  — 归一后仍不合、两本各通（如「親/新」「矣」之有无）→ 校书官主战场
 *   夺     — 现代本有、善本无（detail '善本缺' / orphan 段）
 *   衍     — 善本有、现代本无（detail '善本多'）
 *   倒     — 顺序颠倒（暂以相邻 sub 简判，粗粒度）
 */
'use strict';
const { align, normChar } = require('./align');

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
    const det = seg.shanben.detail || [];
    // orphan 段 → 整段作「夺」（现代本有善本无）
    if (seg.orphan) {
      variants.push(mkVar(++id, seg, '夺',
        null, seg.xiandai.raw,
        `现代本有、善本未对应（页 ${seg.xiandai.page}）`,
        A.sbNorm, seg.shanben.span ? seg.shanben.span[0] : null));
      continue;
    }
    for (let k = 0; k < det.length; k++) {
      const d = det[k];
      if (d.type === '同') continue;
      const sbCh = d.sb ? d.sb.ch : null;
      const xdCh = d.xd ? d.xd.ch : null;
      let type, note;
      if (d.type === '异体') {
        type = '异体';
        note = `善本「${sbCh}」现代本「${xdCh}」异体同字`;
      } else if (d.type === '衍') {
        type = '衍';
        note = `善本多「${sbCh}」（${d.sb.page}:${d.sb.line}）`;
      } else if (d.type === '夺') {
        type = '夺';
        note = `善本缺「${xdCh}」（现代本 ${seg.xiandai.page}）`;
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
  const summary = countBy(variants);
  return { ...A, variants, summary };
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
