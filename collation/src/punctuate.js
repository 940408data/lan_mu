/**
 * collation · P5b 善本点校（src/punctuate.js）
 * 取对齐段，把善本连续无标点字串按现代本句读「点校」——每段善本字 + 该段现代本句末标点。
 *   - 经(j)/注(z) 大小学在 flat OCR 中已失，此处不细分（留 tsv/VLM 补，见 DESIGN §9）。
 *   - 校书官 resolved 异文以夹注形式附于相关句（export.js 调用）。
 */
'use strict';

const crypto = require('crypto');

const PUNCTUATION = new Set('，。！？；：、「」『』（）《》〈〉【】“”‘’…—,.!?;:()[]'.split(''));

function sentenceEnder(raw) {
  const m = raw.match(/([。！？；])/g);
  return m ? m[m.length - 1] : '';
}

/** 取一段善本的连续字串（detail 中 sb 非空者的 ch，按序） */
function segShanbenText(seg) {
  const det = seg.shanben.detail || [];
  return det.filter(d => d && d.sb).map(d => d.sb.ch).join('');
}

/** 去掉句读而不做 Unicode 归一；古异体字必须原样保留。 */
function rawPunctuationText(text) {
  return [...String(text || '')].filter(ch => !PUNCTUATION.has(ch) && !/\s/.test(ch)).join('');
}

function punctuationSourceHash(segments) {
  const payload = (segments || []).map(s => ({ segId: s.segId, raw: s.raw != null ? s.raw : rawPunctuationText(s.text) }));
  return crypto.createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
}

function validatePunctuationMarks(raw, marks, options = {}) {
  if (!Array.isArray(marks)) return { ok: false, reason: 'marks 不是数组' };
  const chars = [...String(raw || '')];
  const positions = new Set();
  for (const m of marks) {
    if (!m || !Number.isInteger(m.at) || m.at < 0 || m.at > chars.length) return { ok: false, reason: 'at 越界' };
    if (typeof m.char !== 'string' || [...m.char].length !== 1 || !PUNCTUATION.has(m.char)) return { ok: false, reason: '标点不在白名单' };
    if (options.strict && '。！？'.includes(m.char) && m.at !== chars.length) return { ok: false, reason: '自动应用禁止在段中插入句末标点' };
    const k = `${m.at}:${m.char}`;
    if (positions.has(k)) return { ok: false, reason: '重复标点操作' };
    positions.add(k);
  }
  return { ok: true };
}

/** 按字符位置应用标点操作；输入 raw 不得包含标点。 */
function applyPunctuationMarks(raw, marks, options = {}) {
  const chars = [...String(raw || '')];
  const check = validatePunctuationMarks(raw, marks, options);
  if (!check.ok) throw new Error(check.reason);
  const byAt = new Map();
  for (const m of marks) {
    if (!byAt.has(m.at)) byAt.set(m.at, []);
    byAt.get(m.at).push(m.char);
  }
  let out = '';
  for (let i = 0; i <= chars.length; i++) {
    if (byAt.has(i)) out += byAt.get(i).join('');
    if (i < chars.length) out += chars[i];
  }
  return out;
}

/** 善本点校本：逐段善本字 + 句末标点 → 连续点校文本（按段分行） */
function buildShanbenPunctuated(result, options = {}) {
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
    const baseline = txt + punct;
    const decision = options.decisions && options.decisions[String(seg.segId)];
    let text = baseline;
    if (decision && Array.isArray(decision.marks)) {
      const checked = validatePunctuationMarks(txt, decision.marks, { strict: true });
      if (!checked.ok) throw new Error(`seg ${seg.segId} 标点建议无效：${checked.reason}`);
      const marks = [...decision.marks];
      // 保留基础阶段从现代本投影的段末标点；模型未给段末标点时不得把句号吞掉。
      const end = [...baseline].pop();
      if (end && PUNCTUATION.has(end) && !marks.some(m => m.at === [...txt].length)) marks.push({ at: [...txt].length, char: end });
      text = applyPunctuationMarks(txt, marks, { strict: true });
    }
    lines.push(text);
    segments.push({ segId: seg.segId, page: seg.shanben.detail.find(d => d.sb)?.sb.page || null, raw: txt, baseline, text });
  }
  return { text: lines.join('\n'), segments, resolvedCount: resolved, orphanCount, sourceHash: punctuationSourceHash(segments) };
}

/** 现代本正文只允许来自 P1.5 清洗正文流。 */
function buildXiandaiText(ed) {
  if (!ed || typeof ed.bodyText !== 'string') throw new Error('现代本出具缺少 P1.5 清洗正文流');
  return ed.bodyText;
}

module.exports = {
  buildShanbenPunctuated,
  buildXiandaiText,
  sentenceEnder,
  segShanbenText,
  rawPunctuationText,
  punctuationSourceHash,
  validatePunctuationMarks,
  applyPunctuationMarks,
  PUNCTUATION,
};
