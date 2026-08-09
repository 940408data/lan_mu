/**
 * 笔墨引擎：为每个字生成「浓淡 k / 错位 j / 欹侧 h」三类微变换标记。
 * 两类来源：
 *  1. 作品数据自带 marks（如幽兰：自原卷复刻 HTML 逐字迁出，保证观感逐字一致）；
 *  2. 无 marks 时以 mulberry32(seed, line) 确定性生成——同一 seed 下，
 *     HTML / JPG / PDF 三端输出永远一致（确定性渲染）。
 */

/** mulberry32 伪随机数发生器（确定性、跨平台一致） */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 为一列文字生成逐字笔墨标记。
 * 模拟蘸墨节奏：饱墨起笔（k0 浓）→ 渐行渐淡（至 k3/k4）→ 再蘸墨（回 k0）。
 * @param {number} seed 作品级随机种子（meta.seed）
 * @param {number} line 行号（从 1 起）
 * @param {number} len  本列字数
 * @returns {Array<{k:number,j:number,h:number}>}
 */
function glyphMarks(seed, line, len) {
  const rng = mulberry32(((seed ^ Math.imul(line, 2654435761)) >>> 0));
  const marks = new Array(len);
  let i = 0;
  while (i < len) {
    const cycle = 8 + Math.floor(rng() * 9); // 一蘸写 8–16 字
    const maxK = rng() < 0.35 ? 4 : 3; // 本蘸最淡至 k3 或 k4
    for (let j = 0; j < cycle && i < len; j++, i++) {
      const k = Math.min(4, Math.floor((j / cycle) * (maxK + 1) + rng() * 0.45));
      marks[i] = { k, j: Math.floor(rng() * 8), h: Math.floor(rng() * 10) };
    }
  }
  return marks;
}

/**
 * 解码数据侧 marks 紧凑串：每字 3 位数字 k/j/h（k≤5 j≤7 h≤9）。
 * @param {string} str
 * @returns {Array<{k:number,j:number,h:number}>}
 */
function parseMarks(str) {
  if (str.length % 3 !== 0) throw new Error(`marks 长度须为 3 的倍数：${str.length}`);
  const out = [];
  for (let i = 0; i < str.length; i += 3) {
    out.push({ k: +str[i], j: +str[i + 1], h: +str[i + 2] });
  }
  return out;
}

module.exports = { mulberry32, glyphMarks, parseMarks };
