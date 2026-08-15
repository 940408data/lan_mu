/**
 * collation · P5b 善本点校（src/punctuate.js）
 * 取对齐段，把善本连续无标点字串按现代本句读「点校」——每段善本字 + 该段现代本句末标点。
 *   - 经(j)/注(z) 大小学在 flat OCR 中已失，此处不细分（留 tsv/VLM 补，见 DESIGN §9）。
 *   - 校书官 resolved 异文以夹注形式附于相关句（export.js 调用）。
 */
'use strict';

function sentenceEnder(raw) {
  const m = raw.match(/([。！？；])/g);
  return m ? m[m.length - 1] : '';
}

/** 取一段善本的连续字串（detail 中 sb 非空者的 ch，按序） */
function segShanbenText(seg) {
  const det = seg.shanben.detail || [];
  return det.filter(d => d && d.sb).map(d => d.sb.ch).join('');
}

/** 善本点校本：逐段善本字 + 句末标点 → 连续点校文本（按段分行） */
function buildShanbenPunctuated(result) {
  const lines = [];
  const segments = [];
  let resolved = 0;
  let orphanCount = 0;
  for (const seg of result.segments) {
    if (seg.orphan) {
      // 现代本独有而善本未对应的文字不写入公开善本正文；异文/待办另入校勘记。
      orphanCount++;
      continue;
    }
    const txt = segShanbenText(seg);
    if (!txt) continue;
    const punct = sentenceEnder(seg.xiandai.raw);
    // 附 resolved / 人工裁定 校记（善本/现代本异文定论）
    const v = (result.verdicts || []).filter(x => {
      const segText = typeof x.seg === 'string' ? x.seg : (x.seg && x.seg.xiandai);
      return segText === seg.xiandai.raw && (x.verdict === 'resolved' || x.verdict === 'human');
    });
    if (v.length) resolved += v.length;
    // 正文与流程性校记分层；裁定只进入校勘记，不再以内联“采某本”污染正文。
    const text = txt + punct;
    lines.push(text);
    segments.push({ segId: seg.segId, page: seg.shanben.detail.find(d => d.sb)?.sb.page || null, text });
  }
  return { text: lines.join('\n'), segments, resolvedCount: resolved, orphanCount };
}

/** 现代本正文只允许来自 P1.5 清洗正文流。 */
function buildXiandaiText(ed) {
  if (!ed || typeof ed.bodyText !== 'string') throw new Error('现代本出具缺少 P1.5 清洗正文流');
  return ed.bodyText;
}

module.exports = { buildShanbenPunctuated, buildXiandaiText, sentenceEnder, segShanbenText };
