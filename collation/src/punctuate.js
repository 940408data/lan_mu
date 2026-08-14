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
  let resolved = 0;
  for (const seg of result.segments) {
    if (seg.orphan) {
      lines.push(`［按〕${seg.xiandai.raw}`);  // 现代本有、善本未对应，作按语存之
      continue;
    }
    const txt = segShanbenText(seg);
    if (!txt) continue;
    const punct = sentenceEnder(seg.xiandai.raw);
    // 附 resolved 校记（善本/现代本异文定论）
    const v = (result.verdicts || []).filter(x => {
      const segText = typeof x.seg === 'string' ? x.seg : (x.seg && x.seg.xiandai);
      return segText === seg.xiandai.raw && x.verdict === 'resolved';
    });
    let note = '';
    if (v.length) {
      note = v.map(x => `〔${x.shanben ? '善' : ''}${x.xiandai ? '今' : ''}异：采${x.adopt === 'shanben' ? '善本' : '现代本'}「${x.adopt === 'shanben' ? x.shanben : x.xiandai}」〕`).join('');
      resolved++;
    }
    lines.push(txt + punct + note);
  }
  return { text: lines.join('\n'), resolvedCount: resolved };
}

/** 现代本正文（按页拼接，保标点 ○ 脚注结构）——自用本用现代本为底 */
function buildXiandaiText(ed) {
  const out = [];
  for (const pg of ed.pages) {
    if (pg.isCover) continue;
    out.push(pg.lines.filter(l => l.trim()).join('\n'));
  }
  return out.join('\n\n');
}

module.exports = { buildShanbenPunctuated, buildXiandaiText, sentenceEnder, segShanbenText };
