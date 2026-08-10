/**
 * 宋版善刻排版：經文大字單行、注文小字雙行，一字一格。
 * 宋刻成法，每列三式，不得混淆：
 *  - 純經列：一行大字，至多 bigPerCol 字；一列不得有兩列經
 *  - 純注列：注文雙行小字（右行先、左行次），每行至多 subPerCol 字；
 *    一列惟兩行注，不得四行注，亦不附經末之下
 *  - 空白列
 * 經文（j）遇章別行，每章另起一列；注文（z）遇注接寫，然必另起新列作雙行，
 * 以免短經長注、碎列參差，失宋版整餳之格。
 * 分卷：區塊所在 section 可帶 volume（版心卷次題名）。新卷必起於新葉，
 * 故卷界處補空列至葉界（一葉 = 兩半葉），卷內葉次更始，版心題本卷卷次。
 *  - 標點不入字格，附前一字右下作朱筆圈點（圈為句、點為讀）；括號類刪而不占位
 * 格制以 UNIT 為列高總量：大字每字 UNIT/bigPerCol，小字每字 UNIT/subPerCol。
 */
const UNIT = 400;
const DEFAULTS = { bigPerCol: 16, subPerCol: 25, colsPerHalf: 8 };

const MARK = { '。': 'j', '！': 'j', '？': 'j', '，': 'd', '、': 'd', '；': 'd', '：': 'd' };
const DROP = /[「」『』（）〈〉—·]/;

/** 文本 → 字格序列 [{c, m}]：標點併入前字為 m，括號類刪去 */
function tokens(s) {
  const out = [];
  for (const ch of s) {
    if (MARK[ch]) { if (out.length) out[out.length - 1].m = MARK[ch]; continue; }
    if (DROP.test(ch)) continue;
    out.push({ c: ch, m: null });
  }
  return out;
}

/**
 * 區塊序列 → 列（行）數組。每列 { big:[tokens], subs:[[右行],[左行]] }
 * 經列純經、注列純注，互不共列。
 */
function layout(blocks, conf) {
  const cols = [];
  let cur = null;
  const newCol = () => { cur = { big: [], subs: [[], []] }; cols.push(cur); };
  for (const b of blocks) {
    const t = b.tokens;
    if (!t.length) continue;
    let i = 0;
    if (b.type === 'j') {
      while (i < t.length) {
        newCol();
        const take = Math.min(conf.bigPerCol, t.length - i);
        cur.big = t.slice(i, i + take);
        i += take;
      }
    } else {
      while (i < t.length) {
        newCol();
        for (let k = 0; k < 2 && i < t.length; k++) {
          const take = Math.min(conf.subPerCol, t.length - i);
          cur.subs[k] = t.slice(i, i + take);
          i += take;
        }
      }
    }
  }
  return cols;
}

/**
 * @param {object} work  loadWork() 的返回（text.yaml 為 sections[].blocks[{type: j|z, text}]）
 * @returns {{columns: Array, blocks: Array, conf: object, stats: object}}
 */
function typesetSongke(work) {
  const { meta, sections } = work;
  const sk = meta.songke || {};
  const conf = { ...DEFAULTS, ...sk };
  const colsPerLeaf = conf.colsPerHalf * 2;
  const blocks = [];
  const volumes = []; // [{ title, startCol, startLeaf }] 分卷紀錄
  const emptyCol = () => ({ big: [], subs: [[], []] });
  let cols = [];
  for (const sec of sections) {
    if (sec.volume) {
      // 新卷必起於新葉：補空列至葉界
      if (cols.length) {
        while (cols.length % colsPerLeaf) cols.push(emptyCol());
      }
      volumes.push({ title: String(sec.volume), startCol: cols.length, startLeaf: cols.length / colsPerLeaf });
    }
    const secBlocks = [];
    for (const b of sec.blocks || []) {
      if (b.type !== 'j' && b.type !== 'z') {
        throw new Error(`作品 ${work.id} 區塊類型須為 j/z，得：${b.type}（${String(b.text).slice(0, 8)}…）`);
      }
      const block = { type: b.type, text: b.text, tokens: tokens(b.text) };
      blocks.push(block);
      secBlocks.push(block);
    }
    cols = cols.concat(layout(secBlocks, conf));
  }
  if (!blocks.length) throw new Error(`作品 ${work.id} 無文本區塊（text.yaml）`);
  const columns = cols;

  let jChars = 0;
  let zChars = 0;
  for (const b of blocks) {
    const n = b.tokens.length;
    if (b.type === 'j') jChars += n; else zChars += n;
  }
  const halves = Math.ceil(columns.length / conf.colsPerHalf);
  const stats = {
    chars: jChars + zChars,
    jChars,
    zChars,
    columns: columns.length,
    halves,
    leaves: Math.ceil(halves / 2),
  };
  return { columns, blocks, conf, volumes, stats };
}

module.exports = { typesetSongke, tokens, UNIT };
