/** 逐格转写（路线 B）→ 列级聚合，路线 B 各工具共用的单一事实源。 */
'use strict';

/**
 * 逐格→列聚合：按 col 分组、row 升序，列 text=char 连接，start 取首字标记或按 row 推，
 * type=顶格→j / 退格→z。
 * @param {{cells: Array<{col:number,row:number,char?:string,start?:string}>}} page
 * @returns {Array<{col:number,start:string,type:'j'|'z',text:string}>}
 */
function colsOfPage(page) {
  const byCol = {};
  for (const c of page.cells || []) (byCol[c.col] ||= []).push(c);
  const cols = [];
  for (const col of Object.keys(byCol).map(Number).sort((a, b) => a - b)) {
    const cells = byCol[col].sort((a, b) => a.row - b.row);
    const text = cells.map(c => c.char || '').filter(s => s).join('');
    if (!text) continue;
    let start = cells.find(c => c.start)?.start;
    if (!start) {
      const r = cells[0]?.row;
      start = r === 1 ? '顶格' : (r === 2 ? '退一格' : '退两格');
    }
    const type = (start === '顶格' || start === '頂格') ? 'j' : 'z';
    cols.push({ col, start, type, text });
  }
  return cols;
}

/**
 * grid-transcribe.json → grid.json 形状（pages[].cols[].{col,type,text,start} + base 指纹），
 * 使 M6 进引擎（build-works.js）可无差别消费路线 A / 路线 B 版面判定。
 * @param {{work?:string, base?:object, pages?:Array}} tr
 */
function transcribeToGrid(tr) {
  return {
    work: tr.work,
    base: tr.base,
    pages: (tr.pages || []).map(pg => ({ n: pg.n, cols: colsOfPage(pg) })),
  };
}

module.exports = { colsOfPage, transcribeToGrid };
