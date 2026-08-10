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
 *  - 標點不入字格，附前一字右下作朱筆點（統一一式，角度輕重因字而變，仿手批氣韻）；括號類刪而不占位
 *  - 注文三版：疏朗（雙行二十字）、雅正（二十二字）、宋槧（二十五字），
 *    各排一套列陣，前端可遞轉；meta.expect 以宋槧（宋版舊觀）為校錄基準
 * 格制以 UNIT 為列高總量：大字每字 UNIT/bigPerCol，小字每字 UNIT/subPerCol。
 */
const UNIT = 400;
const DEFAULTS = { bigPerCol: 16, subPerCol: 25, colsPerHalf: 8 };

/* 注文三版：sub 為雙行每行字數 */
const SUB_VARIANTS = [
  { key: 'shulang', name: '疏朗', sub: 20 },
  { key: 'yazheng', name: '雅正', sub: 22 },
  { key: 'songqian', name: '宋槧', sub: 25 },
];

const MARK = { '。': 1, '！': 1, '？': 1, '，': 1, '、': 1, '；': 1, '：': 1 };
const DROP = /[「」『』（）〈〉—·]/;

/* mulberry32：種子定序偽隨緣，朱點氣韻所由出 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
  const secList = []; // [{ volume?, blocks }] 卷界與區塊，供三版各自重排
  for (const sec of sections) {
    const secBlocks = [];
    for (const b of sec.blocks || []) {
      if (b.type !== 'j' && b.type !== 'z') {
        throw new Error(`作品 ${work.id} 區塊類型須為 j/z，得：${b.type}（${String(b.text).slice(0, 8)}…）`);
      }
      const block = { type: b.type, text: b.text, tokens: tokens(b.text) };
      blocks.push(block);
      secBlocks.push(block);
    }
    secList.push({ volume: sec.volume, blocks: secBlocks });
  }
  if (!blocks.length) throw new Error(`作品 ${work.id} 無文本區塊（text.yaml）`);

  /* 朱點變化碼：以 seed 定序，切版、重構皆不移 */
  const rnd = mulberry32(meta.seed || 7);
  for (const b of blocks) for (const t of b.tokens) if (t.m) t.v = (rnd() * 16) | 0;

  let jChars = 0;
  let zChars = 0;
  for (const b of blocks) {
    const n = b.tokens.length;
    if (b.type === 'j') jChars += n; else zChars += n;
  }

  /* 每版各排一套列陣：列數既異，卷界補列與版心葉次亦須分算 */
  const buildVariant = ({ key, name, sub }) => {
    const vconf = { ...conf, subPerCol: sub };
    const volumes = []; // [{ title, startCol, startLeaf }] 分卷紀錄
    const emptyCol = () => ({ big: [], subs: [[], []] });
    let cols = [];
    for (const sec of secList) {
      if (sec.volume) {
        // 新卷必起於新葉：補空列至葉界
        if (cols.length) {
          while (cols.length % colsPerLeaf) cols.push(emptyCol());
        }
        volumes.push({ title: String(sec.volume), startCol: cols.length, startLeaf: cols.length / colsPerLeaf });
      }
      cols = cols.concat(layout(sec.blocks, vconf));
    }
    const halves = Math.ceil(cols.length / conf.colsPerHalf);
    return {
      key,
      name,
      sub,
      columns: cols,
      volumes,
      stats: {
        chars: jChars + zChars,
        jChars,
        zChars,
        columns: cols.length,
        halves,
        leaves: Math.ceil(halves / 2),
      },
    };
  };
  const variants = SUB_VARIANTS.map(buildVariant);
  const base = variants.find((v) => v.sub === conf.subPerCol) || variants[variants.length - 1];
  return { blocks, conf, variants, columns: base.columns, volumes: base.volumes, stats: base.stats };
}

module.exports = { typesetSongke, tokens, UNIT, SUB_VARIANTS };
