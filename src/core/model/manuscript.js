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
  // 坐标直出（优先）：有 grid.yaml 时按 (页/列/行) 全真还原，与 songke-facsimile 同一纪律；
  // 无 grid.yaml 才落回行流布重排（旧 text.yaml 通路）。
  if (work.grid && Array.isArray(work.grid.pages) && work.grid.pages.length) {
    return buildFromGrid(work, meta, mc);
  }
  return buildFromText(work, meta, mc);
}

/** 坐标直出：grid.pages[].cells[]=[col,row,char]。
 *  半叶式（cols=rowsPerHalf，旧）：每页一个半叶，两两配对成叶（右先左后）；
 *  跨页式（cols=2×rowsPerHalf，史记五帝本纪 16 列）：每页即一整叶，
 *  右半叶=列 1..H、左半叶=列 H+1..cols（卷首叶右半空白全真保留）。 */
function buildFromGrid(work, meta, mc) {
  const grid = work.grid;
  const COLS = (grid.layout && grid.layout.cols) || 8;
  const ROWS = (grid.layout && grid.layout.rows) || 20;
  const H = mc.rowsPerHalf || 8;
  const spread = COLS === H * 2;
  let totalChars = 0, totalCols = 0, ri = 0;
  const mkHalf = (pg, c0, c1) => {
    const cols = [];
    for (let c = c0; c <= c1; c++) {
      const chars = new Array(ROWS).fill('');
      for (const cell of pg.cells || []) {
        if (cell[0] === c) {
          const r = cell[1];
          if (r >= 1 && r <= ROWS) chars[r - 1] = cell[2];
        }
      }
      const real = chars.filter(Boolean).length;
      if (!real) { cols.push({ chars, marks: [], doudu: [], drop: 0 }); continue; } // 空列占位（保列序）
      totalChars += real;
      totalCols++;
      cols.push({ chars, marks: glyphMarks(meta.seed, ri + 1, ROWS), doudu: douduOf(meta.seed, ri, chars), drop: 0 });
      ri++;
    }
    return cols;
  };
  const halves = [];
  const leaves = [];
  for (const pg of grid.pages) {
    if (spread) leaves.push({ right: mkHalf(pg, 1, H), left: mkHalf(pg, H + 1, COLS) });
    else halves.push(mkHalf(pg, 1, COLS));
  }
  if (!spread) {
    if (!halves.length) throw new Error(`作品 ${work.id} 无坐标页（grid.yaml）`);
    if (halves.length % 2) halves.push([]); // 奇数半葉：末葉左半留白
    for (let L = 0; L < halves.length / 2; L++) leaves.push({ right: halves[L * 2] || [], left: halves[L * 2 + 1] || [] });
  }
  if (!leaves.length) throw new Error(`作品 ${work.id} 无坐标页（grid.yaml）`);
  const stats = { chars: totalChars, rows: totalCols, leaves: leaves.length };
  return {
    kind: 'manuscript', meta, conf: mc, leaves,
    seals: work.seals || [], paper: work.paperDecor || {}, book: work.book || null,
    faces: meta.faces, fallbackStacks: meta.fallbackStacks, stats,
  };
}

/** 行流布重排（旧通路）：title 独立成行，j 块按 per 切行。 */
function buildFromText(work, meta, mc) {
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
