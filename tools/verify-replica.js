/**
 * 复刻保真验收：dist/works/youlan/index.html 与原始 Youlan-Scroll.html 逐字符对比。
 * 对比范围（三者须完全一致）：
 *  1. 正文 242 列（含逐字 k/j/h 笔墨标记、夹注几何、行元数据）
 *  2. 印章 svg（9 枚，含非正方形印面）
 *  3. 纸面 svg（兰花 12 处 + 缂丝界行等装饰）
 * 用法：node tools/verify-replica.js   （退出码 0 = 通过）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OLD = path.join(ROOT, 'Youlan-Scroll.html');
const NEW = path.join(ROOT, 'dist', 'works', 'youlan', 'index.html');

const o = fs.readFileSync(OLD, 'utf8');
const n = fs.readFileSync(NEW, 'utf8');
let fail = 0;

// 渲染细节归一化：全角空格字盒包裹（<i class="sp">）不影响内容保真；
// 行尾归一：历史快照为 CRLF、构建产物为 LF，逐字符比对前统一为 LF
const norm = (h) => h.replace(/\r\n/g, '\n').replace(/<i class="sp">　<\/i>/g, '　');

// 1. 正文列逐行对比
const colLines = (h) => norm(h).split('\n').filter((l) => l.startsWith('<i class="col '));
const oc = colLines(o), nc = colLines(n);
const colDiff = oc.reduce((s, l, i) => s + (l === nc[i] ? 0 : 1), 0) + Math.abs(oc.length - nc.length);
console.log(`正文列: ${nc.length}/${oc.length}，差异 ${colDiff}`);
if (oc.length !== 242 || colDiff) { console.error('✗ 正文列不一致'); fail++; }
else console.log('✓ 242 列逐字符一致（文字/笔墨标记/夹注/行元数据）');

// 2. svg 全文对比
function extractSvg(h, cls) {
  const i = h.indexOf(`<svg class="${cls}"`);
  const j = h.indexOf('</svg>', i);
  return i < 0 ? '' : h.slice(i, j + 6);
}
for (const [cls, label] of [['seals', '印章'], ['tex', '纸面/兰花']]) {
  const same = extractSvg(o, cls) === extractSvg(n, cls);
  console.log(same ? `✓ ${label} svg 逐字符一致` : `✗ ${label} svg 不一致`);
  if (!same) fail++;
}

// 3. 扫描图已外置为独立资源（不再 base64 内联）
const externalized = !/data:image\/jpeg;base64/.test(n) && /data-src="scan\.jpg"/.test(n);
console.log(externalized ? '✓ 扫描图外置为 scan.jpg 按需加载' : '✗ 扫描图未正确外置');
if (!externalized) fail++;

if (fail) { console.error(`\n复刻验收未通过（${fail} 项）`); process.exit(1); }
console.log('\n复刻保真验收通过');
