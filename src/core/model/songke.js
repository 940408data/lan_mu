/**
 * 宋版善刻版式模型：WorkData → LayoutTree（kind: 'songke'）。
 * 一版兩半葉，中縫版心；列陣按 colsPerHalf 切半，半葉兩兩配對成葉（右先左後，自右向左讀）。
 * 半葉數為奇時末葉左半留白（版末自然狀態）。
 */
const { typesetSongke } = require('../typeset-songke');

function buildSongke(work) {
  const { meta } = work;
  if (meta.layout !== 'songke') throw new Error(`作品 ${work.id} 的版式不是 songke: ${meta.layout}`);
  const { columns, blocks, conf, volumes, stats, variants } = typesetSongke(work);

  // 數據量校驗（meta.expect 為校錄基準，以宋槧二十五字版為準）
  if (meta.expect) {
    for (const k of Object.keys(meta.expect)) {
      if (stats[k] !== meta.expect[k]) {
        throw new Error(`數據校驗失敗 ${k}: 實得 ${stats[k]} ≠ 基準 ${meta.expect[k]}（請核對 text.yaml 校錄）`);
      }
    }
  }

  const halves = [];
  for (let i = 0; i < columns.length; i += conf.colsPerHalf) {
    halves.push(columns.slice(i, i + conf.colsPerHalf));
  }
  if (halves.length % 2) halves.push([]); // 奇數半葉：末葉左半留白
  const leaves = [];
  for (let L = 0; L < halves.length / 2; L++) {
    leaves.push({ right: halves[L * 2], left: halves[L * 2 + 1] });
  }

  return {
    kind: 'songke',
    meta,
    conf,
    blocks,
    columns,
    volumes,
    variants,
    leaves,
    faces: meta.faces,
    fallbackStacks: meta.fallbackStacks,
    seals: work.seals,
    stats,
  };
}

module.exports = { buildSongke };
