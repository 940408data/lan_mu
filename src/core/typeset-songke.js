/**
 * 宋版善刻排版：經文大字單行、注文小字雙行，一字一格。
 * 宋刻成法，每列三式：
 *  - 純經列：一行大字，至多 bigPerCol 字；一列不得有兩列經
 *  - 注列：注文雙行小字（右行先、左行次），每行至多 subPerCol 字；
 *    雙行並進均齊——右行左行字數完全相同或僅差一字（右行得多一字）
 *  - 空白列
 * 經文（j）遇章別行，每章另起一列；注文（z）隨經而下，不必另起新列：
 * 注起始位置與純注列網格對齊——大字占 n 個，注從 ceil(n×bigH/smallH) 行開始，
 * 本列每行餘容不足 minNoteFit 字則新起列。
 * 分卷：區塊所在 section 可帶 volume（版心卷次題名）。新卷必起於新葉，
 * 故卷界處補空列至葉界（一葉 = 兩半葉），卷內葉次更始，版心題本卷卷次。
 *  - 標點不入字格，附前一字右下作朱筆點（統一一式，角度輕重因字而變，仿手批氣韻）；括號類刪而不占位
 *  - 注文三版：疏朗（雙行二十字）、雅正（二十二字）、宋槧（二十五字），
 *    各排一套列陣，前端可遞轉；meta.expect 以宋槧（宋版舊觀）為校錄基準
 * 格制以 UNIT 為列高總量：大字每字 UNIT/bigPerCol，小字每字 UNIT/subPerCol。
 */
const UNIT = 400;
const DEFAULTS = { bigPerCol: 16, subPerCol: 25, colsPerHalf: 8, minNoteFit: 2 };

/* 注文三版：sub 為雙行每行字數 */
const SUB_VARIANTS = [
  { key: 'shulang', name: '疏朗', sub: 20 },
  { key: 'yazheng', name: '雅正', sub: 22 },
  { key: 'songqian', name: '宋槧', sub: 25 },
];

const MARK = { '。': 1, '！': 1, '？': 1, '，': 1, '、': 1, '；': 1, '：': 1 };
const DROP = /[「」『』（）〈〉《》—·【】\[\]\u201c\u201d\u2018\u2019]/;

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
 * 區塊序列 → 列（行）數組。每列 { big:[tokens], subs:[[右行],[左行]], g }
 * g 為注起始行號（0-based），即注從第 g 行小字位置開始（純注列 g=0，合欄列 g>0）。
 * 注起始位置與純注列網格對齊：大字占 n 個，注從 ceil(n×bigH/smallH) 行開始。
 * 注列雙行均齊：注盡於一列者右 ⌈L/2⌉ 左 ⌊L/2⌋，跨列者滿列 C/C、末列均分，
 * 故任一注列兩行字數相同或僅差一字。
 */
function layout(blocks, conf) {
  const cols = [];
  const newCol = (g = 0) => { const c = { big: [], subs: [[], []], g }; cols.push(c); return c; };
  const bigH = UNIT / conf.bigPerCol;
  const smallH = UNIT / conf.subPerCol;
  let prevType = null;
  for (const b of blocks) {
    const t = b.tokens;
    if (!t.length) continue;
    if (b.type === 'j') {
      let i = 0;
      while (i < t.length) {
        const c = newCol();
        const take = Math.min(conf.bigPerCol, t.length - i);
        c.big = t.slice(i, i + take);
        i += take;
      }
    } else {
      /* 定錨：前塊為經且末列餘容足，則注隨經下；否則新起列 */
      let col = null;
      let cap = conf.subPerCol;
      if (prevType === 'j' && cols.length) {
        const last = cols[cols.length - 1];
        /* 注起始行號：大字所占高度按小字網格向上取整 */
        const g = Math.ceil(last.big.length * bigH / smallH);
        const c = conf.subPerCol - g;
        if (c >= conf.minNoteFit) { col = last; col.g = g; cap = c; }
      }
      let i = 0;
      while (i < t.length) {
        if (!col) { col = newCol(); cap = conf.subPerCol; }
        const rest = t.length - i;
        if (rest <= 2 * cap) {
          /* 注盡於本列：雙行均分 */
          const r = Math.ceil(rest / 2);
          col.subs[0] = t.slice(i, i + r);
          col.subs[1] = t.slice(i + r, i + rest);
          i += rest;
        } else {
          /* 本列滿填，餘字轉入新列 */
          col.subs[0] = t.slice(i, i + cap);
          col.subs[1] = t.slice(i + cap, i + 2 * cap);
          i += 2 * cap;
        }
        col = null;
      }
    }
    prevType = b.type;
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
    const emptyCol = () => ({ big: [], subs: [[], []], g: 0 });
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
