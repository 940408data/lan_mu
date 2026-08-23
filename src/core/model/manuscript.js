/**
 * 明人写本版式模型：WorkData → LayoutTree（kind: 'manuscript'）。
 * 依传姜立纲抄本《史记》书影：无界格、半叶八行、行二十字、大字单行；
 * 行流布切行（charsPerRow），半叶两两配对成叶（右先左后）；
 * openBlank 时卷首叶右半留白（开卷自然状态）。
 * 逐字笔墨标记复用 calligraphy.glyphMarks（seed 确定，三端一致）；
 * 朱笔句读：停顿字后必点，余以种子按文气补点（约每 2–4 字一点）。
 */
const { glyphMarks, mulberry32 } = require('../calligraphy');

/* 句读停顿字（其后必点朱） */
const PAUSE = new Set('也矣乎哉耶耳焉者');

/** 逐行朱笔句读标记：返回与行等长的 0/1 数组 */
function douduOf(seed, rowIdx, chars) {
  const rng = mulberry32(((seed ^ Math.imul(rowIdx + 7, 40503)) >>> 0));
  const marks = new Array(chars.length).fill(0);
  let gap = 0;
  for (let i = 0; i < chars.length; i++) {
    gap++;
    const pause = PAUSE.has(chars[i]);
    if (pause || (gap >= 4 && rng() < 0.6)) {
      marks[i] = 1;
      gap = 0;
    }
  }
  return marks;
}

function buildManuscript(work) {
  const { meta } = work;
  if (meta.layout !== 'manuscript') throw new Error(`作品 ${work.id} 的版式不是 manuscript: ${meta.layout}`);
  const mc = meta.manuscript || {};
  const per = mc.charsPerRow || 20;
  const rph = mc.rowsPerHalf || 8;
  const drop = mc.titleDrop == null ? 2 : mc.titleDrop;

  // 行流布：title 独立成行（低 drop 字），j 块按 per 切行
  const rows = [];
  for (const sec of work.sections) {
    for (const b of sec.blocks || []) {
      const text = String(b.text || '').replace(/\s+/g, '');
      if (!text) continue;
      if (b.type === 'title') { rows.push({ chars: [...text], title: true }); continue; }
      for (let i = 0; i < text.length; i += per) {
        rows.push({ chars: [...text.slice(i, i + per)], title: false });
      }
    }
  }
  if (!rows.length) throw new Error(`作品 ${work.id} 无正文行`);

  // 笔墨 + 句读
  rows.forEach((r, ri) => {
    r.marks = glyphMarks(meta.seed, ri + 1, r.chars.length);
    r.doudu = douduOf(meta.seed, ri, r.chars);
    r.drop = r.title ? drop : 0;
  });

  // 半叶 / 叶
  const halves = [];
  for (let i = 0; i < rows.length; i += rph) halves.push(rows.slice(i, i + rph));
  if (mc.openBlank) halves.unshift([]);
  if (halves.length % 2) halves.push([]); // 奇数半叶：末叶左半留白
  const leaves = [];
  for (let L = 0; L < halves.length / 2; L++) {
    leaves.push({ right: halves[L * 2], left: halves[L * 2 + 1] });
  }

  const stats = {
    chars: rows.reduce((s, r) => s + r.chars.length, 0),
    rows: rows.length,
    leaves: leaves.length,
  };

  // 數據量校驗（meta.expect 為校錄基準）
  if (meta.expect) {
    for (const k of Object.keys(meta.expect)) {
      if (stats[k] !== meta.expect[k]) {
        throw new Error(`數據校驗失敗 ${k}: 實得 ${stats[k]} ≠ 基準 ${meta.expect[k]}（請核對 text.yaml 校錄）`);
      }
    }
  }

  return {
    kind: 'manuscript',
    meta,
    conf: mc,
    leaves,
    seals: work.seals || [],
    paper: work.paperDecor || {},
    book: work.book || null,
    faces: meta.faces,
    fallbackStacks: meta.fallbackStacks,
    stats,
  };
}

module.exports = { buildManuscript };
