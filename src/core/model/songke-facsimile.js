/**
 * 宋版影刻直出版式模型 V2：WorkData(grid.yaml) → LayoutTree（kind: 'songke-facsimile'）。
 * 薄化直通：grid.pages[].cells[]（[col,row,char] 三元组，只含有字格）原样传渲染层，
 * 不做列阵化/半叶拆分/z 配对——版面由渲染层按坐标显式定位还原（精校台纪律）。
 * 空 cell 不存于快照，空格/空列由 layout(cols×rows) 隐含。
 */
function buildSongkeFacsimile(work) {
  const { meta, grid } = work;
  if (meta.layout !== 'songke-facsimile') throw new Error(`作品 ${work.id} 的版式不是 songke-facsimile: ${meta.layout}`);
  if (!grid || !Array.isArray(grid.pages) || !grid.pages.length) {
    throw new Error(`作品 ${work.id} 缺 grid.yaml 数据源（先跑 collation/tools/grid-to-work.js <书> ${work.id} --write）`);
  }

  const labelMap = new Map();
  for (const l of grid.labels || []) labelMap.set(`${l.page}:${l.col}`, l.role);

  let cells = 0, jChars = 0, zChars = 0, noRole = 0;
  const seenCols = new Set();
  for (const pg of grid.pages) {
    for (const [c, , ch] of pg.cells || []) {
      cells++;
      const role = labelMap.get(`${pg.n}:${c}`) || 'z';
      if (role === 'j' || role === 'title') jChars += String(ch).length;
      else zChars += String(ch).length;
      const ck = `${pg.n}:${c}`;
      if (!seenCols.has(ck)) { seenCols.add(ck); if (!labelMap.has(ck)) noRole++; }
    }
  }

  return {
    kind: 'songke-facsimile',
    meta,
    grid,
    faces: meta.faces,
    fallbackStacks: meta.fallbackStacks,
    seals: work.seals,
    stats: {
      pages: grid.pages.length,
      cols: seenCols.size,
      cells, jChars, zChars,
      fixes: (grid.fixes || []).length,
      sections: (grid.sections || []).length,
      noRole,
    },
  };
}

module.exports = { buildSongkeFacsimile };
