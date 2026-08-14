/**
 * collation · P0 装载（src/io.js）
 * 读 input_data/<书名>/{当涂郡本,儒藏本}_ocr/page_*.md → Edition 对象 + PDF 页索引。
 *
 * 用法（被 run.js / 他模块调）:
 *   const { loadWork } = require('./io');
 *   const { work, shanben, xiandai } = loadWork('大学章句');
 *
 * 产物结构:
 *   work     = editions.yaml 中该作品的登记（title/structure/...）
 *   Edition  = { id, role, level, title, pages:[{n, lines:[str], raw}], pdfCount, punctuated }
 *
 * 说明：input_data 为 gitignored 源数据（体量大），运行期读取，不入仓库。
 *      善本 page_0001 为封面（「宋本大學章句」），装载时标 isCover，由上层决定是否跳过。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const INPUT_DATA = path.join(REPO_ROOT, 'input_data');
const CONFIG_PATH = path.join(__dirname, '..', 'config', 'editions.yaml');

/** 读取版本登记册 */
function loadConfig() {
  const doc = YAML.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const byId = {};
  for (const e of doc.editions) byId[e.id] = e;
  const works = {};
  for (const w of doc.works) works[w.id] = w;
  return { editions: byId, works };
}

/** 列出某版本某书的 OCR 页（page_XXXX.md），按页码升序 */
function listPages(bookDir, ocrDir) {
  const dir = path.join(INPUT_DATA, bookDir, ocrDir);
  if (!fs.existsSync(dir)) throw new Error(`OCR 目录不存在: ${dir}`);
  return fs.readdirSync(dir)
    .filter(f => /^page_\d+\.md$/.test(f))
    .sort()
    .map(f => ({
      n: parseInt(f.match(/(\d+)/)[1], 10),
      file: f,
      path: path.join(dir, f),
    }));
}

/** 读一页 markdown → { lines:[去空行后的行], raw:全文 } */
function readPage(p) {
  const txt = fs.readFileSync(p, 'utf8');
  const lines = txt.split(/\r?\n/).map(s => s.trim()).filter(s => s.length > 0);
  return { lines, raw: txt };
}

/** 封面判定：善本首页常为「宋本X章句」之类短题，无实质正文 */
function isCoverPage(lines, role) {
  if (role !== 'shanben') return false;
  const joined = lines.join('');
  return lines.length <= 2 && /宋本|章句全?$/.test(joined) && joined.replace(/[\s，。]/g, '').length <= 12;
}

/** 装载一个版本为 Edition */
function loadEdition(bookId, work, editionId) {
  const cfg = loadConfig();
  const e = cfg.editions[editionId];
  const pages = listPages(bookId, e.ocrDir).map(p => {
    const r = readPage(p.path);
    return { n: p.n, ...r, isCover: isCoverPage(r.lines, e.role) };
  });
  // PDF 页数（仅登记，不读二进制）
  const pdfDir = path.join(INPUT_DATA, bookId, e.pdfDir);
  const pdfCount = fs.existsSync(pdfDir)
    ? fs.readdirSync(pdfDir).filter(f => /\.pdf$/i.test(f)).length
    : 0;
  return {
    id: e.id,
    role: e.role,
    level: e.level,
    title: e.title,
    punctuated: !!e.punctuated,
    pages,
    pdfCount,
  };
}

/** 装载一部作品的两本 */
function loadWork(workId) {
  const cfg = loadConfig();
  const work = cfg.works[workId];
  if (!work) throw new Error(`未登记作品: ${workId}（见 collation/config/editions.yaml）`);
  return {
    work,
    shanben: loadEdition(workId, work, work.shanben),
    xiandai: loadEdition(workId, work, work.xiandai),
  };
}

module.exports = { loadConfig, loadWork, loadEdition, listPages, readPage, INPUT_DATA, REPO_ROOT };
