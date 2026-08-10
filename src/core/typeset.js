/**
 * 行列排版：把 text.yaml 的 sections 展开为带笔墨标记、行号、夹注几何的列数组。
 */
const { glyphMarks, parseMarks } = require('./calligraphy');

/**
 * @param {object} work  loadWork() 的返回
 * @returns {{columns: Array, stats: object}}
 */
function typeset(work) {
  const { meta, sections } = work;
  const dims = meta.scroll;
  const columns = [];
  let totalChars = 0;
  let totalNotes = 0;

  for (const sec of sections) {
    for (const col of sec.columns) {
      const chars = [...col.text]; // 按码点切分，兼容生僻字
      const count = chars.filter((ch) => ch !== '\u3000').length; // 字数只计字形、不计全角间隔
      // 笔墨标记：数据自带 marks（逐字复刻）优先；无则按 seed 确定性生成
      let marks;
      if (col.marks) {
        marks = parseMarks(col.marks);
        if (marks.length !== count) {
          throw new Error(`第 ${col.line} 行 marks 数 ${marks.length} ≠ 字数 ${count}`);
        }
      } else {
        marks = glyphMarks(meta.seed, col.line, count);
      }
      let mi = 0;
      const glyphs = chars.map((ch) =>
        ch === '　' ? { ch } : { ch, ...marks[mi++] });
      // 句讀（施朱）：col.du 為斷讀段字符串列表——各段須為 text 的連續前綴片段，
      // 構建期前綴接龍校驗（錯即報行號），偏移自動累加，杜絕心算計數；
      // 兼容舊的 1-based 數字列表。
      if (col.du && col.du.length) {
        let offs;
        if (typeof col.du[0] === 'string') {
          offs = [];
          let cur = 0;
          for (const seg of col.du) {
            if (!col.text.startsWith(seg, cur)) {
              throw new Error(`第 ${col.line} 行句讀段「${seg}」與經文不接（起於第 ${cur + 1} 字）`);
            }
            cur += [...seg].length;
            offs.push(cur);
          }
        } else {
          offs = col.du;
        }
        const duSet = new Set(offs);
        let ord = 0;
        for (const g of glyphs) if (g.ch !== '　') g.du = duSet.has(++ord) ? 1 : 0;
      }
      const note = col.note
        ? {
            at: col.note.at,
            fontSize: col.note.fontSize != null ? col.note.fontSize : dims.noteFontSize,
            height: dims.textH - col.note.at, // 夹注块高 = 文本区高 − 起始偏移
            text: col.note.text,
          }
        : null;
      const meta3 =
        String(col.line).padStart(3, '0') + ' · ' + count + '字' +
        (note ? ' · 夾注' + [...note.text].length + '字' : '');
      // n 为 CSS 变量 --n（列序号），手卷模型中与行号恒等
      columns.push({ line: col.line, n: col.line, cls: col.class, sec: sec.name, count, glyphs, note, meta: meta3 });
      totalChars += count;
      if (note) totalNotes++;
    }
  }

  const scoreSecs = ['譜題', '文字譜', '尾題'];
  const stats = {
    lines: columns.length,
    scoreLines: columns.filter((c) => scoreSecs.includes(c.sec)).length,
    chars: totalChars,
    notes: totalNotes,
  };
  return { columns, stats };
}

module.exports = { typeset };
