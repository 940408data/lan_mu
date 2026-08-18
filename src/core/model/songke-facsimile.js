/**
 * 宋版影刻直出版式模型：WorkData(grid.yaml) → LayoutTree（kind: 'songke-facsimile'）。
 * 与 songke（重排引擎）相对：零重排，按逐格原刻列阵直出；页=葉，页码即原刻葉次；
 * 注文双行取原刻真实切分（相邻两转写列配对），不做算法均齐。
 */
function buildSongkeFacsimile(work) {
  const { meta, grid } = work;
  if (meta.layout !== 'songke-facsimile') throw new Error(`作品 ${work.id} 的版式不是 songke-facsimile: ${meta.layout}`);
  if (!grid || !Array.isArray(grid.pages) || !grid.pages.length) {
    throw new Error(`作品 ${work.id} 缺 grid.yaml 数据源（先跑 collation/tools/grid-to-work.js <书> ${work.id} --write）`);
  }

  let cols = 0, cells = 0, jChars = 0, zChars = 0, noRole = 0;
  for (const pg of grid.pages) {
    for (const c of pg.cols || []) {
      cols++;
      const n = String(c.chars || '').replace(/　/g, '').length;
      cells += n;
      if (c.role === 'j' || c.role === 'title') jChars += n;
      else { zChars += n; if (!c.role) noRole++; }
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
      pages: grid.pages.length, cols, cells, jChars, zChars,
      fixes: (grid.fixes || []).length,
      sections: (grid.sections || []).length,
      noRole,
    },
  };
}

module.exports = { buildSongkeFacsimile };
