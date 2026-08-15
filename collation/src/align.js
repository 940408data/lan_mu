/**
 * collation · P3 对齐（src/align.js）
 * 善本（无标点断行）/ 现代本（有标点注夹脚注）→ 归一 → 句级对齐。
 *
 * 算法（句锚点 + 游标 + 编辑距离兜底）：
 *   1. 善本：跨页拼接去断行 → 逐字 token（带 {page,line} 溯源），异体归一得 norm 串。
 *   2. 现代本：按句末标点切句、剥离脚注/校记（另存 xiandaiNotes）、去 ○/空白/标点 → 每句 norm 串。
 *   3. 游标扫善本 norm 串，对每句现代本先 indexOf 精确命中；失配则编辑距离（Levenshtein，
 *      带 'sub' 替换）小窗模糊命中，去首尾 del 尾巴（属后句，勿误判为衍）；命中不了 → orphan。
 *
 * 归一只用于「对齐匹配」；raw 原字始终保留，diff.js 据此判异体/真异文。
 * 不用 opencc（避 cn→tw 一对多坑，见 memory classical-text-opencc-gotchas），改手定善本异体表。
 */
'use strict';
const { cleanWork, BODY_KINDS } = require('./cleanup');

// ── 善本异体归一表（古字/异体 → 通行形），用于对齐匹配；可扩充 ──
const VARIANT_MAP = {
  丗: '世', 旣: '既', 彞: '彝', 稟: '禀', 髙: '高', 頺: '頽', 頽: '頽',
  閒: '間', 埽: '掃', 内: '內', 曽: '曾', 僣: '僭', 𢗊: '志', 卽: '即',
  𣎆: '貌', 喦: '岩', 柰: '奈', 蛘: '蝣', 憖: '慭', 懽: '歡', 耑: '端',
  𠀋: '朝', 𠫤: '慮', 𢛳: '息', 𢺲: '就', 訁: '言', 㗉: '答', 髙: '高',
  託: '讬', 旂: '旗', 峕: '時', 𠮾: '哉', 龢: '和', 虗: '虛', 厯: '歷',
  顚: '顛', 鵶: '鴉', 訞: '妖', 捨: '舍', 註: '注', 詠: '咏',
  乆: '久', 巳: '已', 強: '强', 隂: '陰', 滛: '淫', 逺: '遠', 别: '別',
  况: '況', 僩: '僴', 刼: '劫', 眞: '真', 緡: '緜', 槩: '概', 沉: '沈',
  // M1 扩充（实测冒出的善本古异体；仅用于对齐归一，不改正文，正文存善本原字）
  顔: '顏', 徃: '往', 㑹: '會', 刪: '删', 舎: '舍', 宻: '密', 冝: '宜',
  黙: '默', 逹: '達', 㓜: '幼', 恠: '怪', 祿: '禄', 賛: '贊', 冨: '富',
  賔: '賓', 灾: '災', 胷: '胸', 冑: '胄', 頼: '賴', 乗: '乘', 鬪: '鬭',
  彔: '录', 敍: '敘', 綫: '線', 羣: '群', 裏: '裡',
  // M2 补：爲/為、頽/頹 等纯字形异体（归一仅用于对齐/互证比对，不占覆校名额；正文仍存善本原刻字形）
  爲: '為', 頹: '頽', 脉: '脈', 緑: '綠', 決: '决', 潜: '潛', 併: '並',
  卧: '臥', 覩: '睹', 獘: '弊', 飮: '飲', 卽: '即',
  // P4.5 回路补：母/毋（善本混用，p18 实印毋、p27 六处实印母）、己/已——归一仅为对齐，
  // 差异以异体登记在册（可见可查），不淹没、不改正文
  母: '毋', 己: '已',
};
function normChar(ch) {
  if (VARIANT_MAP[ch]) return VARIANT_MAP[ch];
  // astral/多码元未映射字（如 CJK-Ext-B 𣎆 等）→ 占位单码元，保 sbNorm 与 sbToks 1:1（否则错位致全段误判异体）
  if (ch.length > 1) return '〓';
  return ch;
}

/** 已清洗善本正文流 → 逐字 token（带页、行、region 溯源）。 */
function shanbenTokens(ed) {
  const toks = [];
  for (const pg of ed.pages) {
    for (const region of pg.regions.filter(r => BODY_KINDS.has(r.kind))) {
      for (const ch of region.text) {
        if (/\s/.test(ch)) continue;
        toks.push({
          ch,
          norm: normChar(ch),
          page: pg.page,
          sourceHash: pg.sourceHash,
          line: region.source.lines[0] || 0,
          regionId: region.id,
        });
      }
    }
  }
  return toks;
}

/** 已清洗现代本正文流 → 句数组；脚注/校记取自清洗审计流。 */
function xiandaiSentences(ed) {
  const sents = [];
  const notes = ed.pages.flatMap(pg => pg.excluded
    .filter(r => r.kind === 'footnote' || r.kind === 'collation_note')
    .map(r => ({ page: pg.page, text: r.text, kind: r.kind, regionId: r.id })));
  for (const pg of ed.pages) {
    const bodyRegions = pg.regions.filter(r => BODY_KINDS.has(r.kind));
    if (!bodyRegions.length) continue;
    // 按句末标点切句；跨正文区域时保留所有参与该句的 regionId。
    let acc = '';
    let regionIds = new Set();
    for (const region of bodyRegions) {
      const parts = region.text.split(/([。！？；])/).filter(s => s.length > 0);
      for (const p of parts) {
        regionIds.add(region.id);
        if (/^[。！？；]$/.test(p)) {
          acc += p;
          if (acc.trim()) sents.push(makeSent(acc, pg.page, [...regionIds], pg.sourceHash));
          acc = '';
          regionIds = new Set();
        } else acc += p;
      }
    }
    if (acc.trim()) sents.push(makeSent(acc, pg.page, [...regionIds], pg.sourceHash));
  }
  return { sents, notes };
}
function makeSent(raw, page, regionIds = [], sourceHash = null) {
  const chars = [];
  for (const ch of raw.replace(/○/g, '')) {
    if (/[，。！？；：、""''「」『』《》（）\s]/.test(ch)) continue;
    chars.push({ ch, norm: normChar(ch) });
  }
  return { raw: raw.trim(), chars, page, regionIds, sourceHash, norm: chars.map(c => c.norm).join('') };
}

// ── 编辑距离（带 sub）对齐：s 善本窗 vs p 句norm ──
function editAlign(s, p) {
  const m = s.length, n = p.length;
  if (m === 0 || n === 0) return null;
  const dp = Array.from({ length: m + 1 }, () => new Int16Array(n + 1));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === p[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j - 1] + cost, dp[i - 1][j] + 1, dp[i][j - 1] + 1);
    }
  const matched = (m + n - dp[m][n]) / 2;  // 对齐数 ≈ (len - dist) 的近似
  const score = matched / Math.max(n, 1);
  if (score < 0.65) return null;
  // 回溯：'=' 'sub' 'del' 'ins'
  const ops = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    const cost = s[i - 1] === p[j - 1] ? 0 : 1;
    if (dp[i][j] === dp[i - 1][j - 1] + cost) {
      ops.push([cost === 0 ? '=' : 'sub', i - 1, j - 1]); i--; j--;
    } else if (dp[i][j] === dp[i - 1][j] + 1) { ops.push(['del', i - 1, null]); i--; }
    else { ops.push(['ins', null, j - 1]); j--; }
  }
  while (i > 0) { ops.push(['del', i - 1, null]); i--; }
  while (j > 0) { ops.push(['ins', null, j - 1]); j--; }
  ops.reverse();
  // 去首尾 del 尾巴（属前后句，勿误判为衍）：剥首/尾连续 del，ins 同理保留（句首句尾缺字可能是真夺）
  let lo = 0, hi = ops.length;
  while (lo < hi && ops[lo][0] === 'del') lo++;
  while (hi > lo && ops[hi - 1][0] === 'del') hi--;
  return { score, ops: ops.slice(lo, hi) };
}

/** 对齐主入口 */
function align(workId) {
  const cleaned = cleanWork(workId);
  const { work, shanben, xiandai } = cleaned;
  const sbToks = shanbenTokens(shanben);
  const sbNorm = sbToks.map(t => t.norm).join('');
  const { sents, notes } = xiandaiSentences(xiandai);

  const segments = [];
  let cursor = 0;
  let segId = 0;
  for (const s of sents) {
    if (!s.norm) continue;
    // 0) 强锚吸附：遇朱子章句章节标记（右傳之X章/右經一章/右第X章），把 cursor 吸附到善本对应锚点，清跨章累积错位
    const am = s.norm.match(/右傳之|右經一章|右第[一二三四五六七八九十百]+章/);
    if (am) {
      const anchorPos = sbNorm.indexOf(am[0], cursor);
      if (anchorPos >= 0 && anchorPos - cursor < 500) cursor = anchorPos;
    }
    // 1) 精确命中（容小回溯跨句粘连；夺/衍失同步需此容忍）
    const from = Math.max(0, cursor - 32);
    const hit = sbNorm.indexOf(s.norm, from);
    if (hit >= 0 && hit <= cursor + s.norm.length + 12) {
      segments.push(mkExactSeg(++segId, s, sbToks, hit, s.norm.length));
      cursor = hit + s.norm.length;
      continue;
    }
    // 2) 模糊命中：编辑距离，窗口 = 句长 + slack
    const slack = Math.max(8, Math.floor(s.norm.length * 0.15));
    const win = s.norm.length + slack;
    const r = editAlign(sbNorm.slice(cursor, cursor + win), s.norm);
    if (r) {
      segments.push(mkFuzzySeg(++segId, s, sbToks, cursor, r));
      // 游标推进到本次善本用到最末位置 +1（sub/= 消耗；尾 del 已剥不计）
      let last = -1;
      for (const [op, sbi] of r.ops) if (sbi != null && op !== 'del') last = Math.max(last, sbi);
      if (last >= 0) cursor = cursor + last + 1;
      // 全是 ins（善本一字未配）→ 不推进，免死循环
    } else {
      // 3) orphan
      segments.push(mkOrphanSeg(++segId, s));
    }
  }
  return {
    work,
    cleaned: { shanben, xiandai },
    sbToks,
    sbNorm,
    sents,
    notes,
    segments,
  };
}

function mkExactSeg(segId, sent, sbToks, hit, len) {
  const detail = [];
  for (let k = 0; k < sent.chars.length; k++) {
    const t = sbToks[hit + k];
    detail.push({ sb: t ? { ch: t.ch, page: t.page, line: t.line, regionId: t.regionId, sourceHash: t.sourceHash } : null, xd: sent.chars[k], type: (t && t.ch === sent.chars[k].ch) ? '同' : '异体' });
  }
  return { segId, xiandai: { raw: sent.raw, page: sent.page, regionIds: sent.regionIds, sourceHash: sent.sourceHash, chars: sent.chars }, shanben: { span: [hit, hit + len], detail, ops: null }, score: 1 };
}
function mkFuzzySeg(segId, sent, sbToks, base, r) {
  const detail = [];
  for (const [op, sbi, xdi] of r.ops) {
    const t = sbi != null ? sbToks[base + sbi] : null;
    if (op === '=') detail.push({ sb: t ? { ch: t.ch, page: t.page, line: t.line, regionId: t.regionId, sourceHash: t.sourceHash } : null, xd: sent.chars[xdi], type: t && t.ch === sent.chars[xdi].ch ? '同' : '异体' });
    else if (op === 'sub') detail.push({ sb: t ? { ch: t.ch, page: t.page, line: t.line, regionId: t.regionId, sourceHash: t.sourceHash } : null, xd: sent.chars[xdi], type: '疑异' });
    else if (op === 'del') detail.push({ sb: t ? { ch: t.ch, page: t.page, line: t.line, regionId: t.regionId, sourceHash: t.sourceHash } : null, xd: null, type: '衍' });
    else if (op === 'ins') detail.push({ sb: null, xd: sent.chars[xdi], type: '夺' });
  }
  return { segId, xiandai: { raw: sent.raw, page: sent.page, regionIds: sent.regionIds, sourceHash: sent.sourceHash, chars: sent.chars }, shanben: { span: [base, base + 0], detail, ops: r.ops }, score: r.score };
}
function mkOrphanSeg(segId, sent) {
  return { segId, xiandai: { raw: sent.raw, page: sent.page, regionIds: sent.regionIds, sourceHash: sent.sourceHash, chars: sent.chars }, shanben: { span: null, detail: [], ops: null }, score: 0, orphan: true };
}

module.exports = { align, normChar, shanbenTokens, xiandaiSentences, VARIANT_MAP };
