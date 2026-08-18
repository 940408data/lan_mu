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

/** workId → input_data 子目录名（分卷书每卷一作品时，workId ≠ 目录名，经 works[].inputBook 别名解耦） */
function inputBookOf(workId) {
  try {
    const w = loadConfig().works[workId];
    if (w && w.inputBook) return w.inputBook;
  } catch {}
  return workId;
}

/** 列出某版本某书的 OCR 页（page_XXXX.md），按页码升序。
 *  分卷书（input_data/<书>/<卷>/<ocrDir>/，页码全局连续）自动回退卷目录扫描，带 vol 字段。 */
function listPages(bookDir, ocrDir) {
  const dir = path.join(INPUT_DATA, bookDir, ocrDir);
  if (fs.existsSync(dir)) {
    return fs.readdirSync(dir)
      .filter(f => /^page_\d+\.md$/.test(f))
      .sort()
      .map(f => ({
        n: parseInt(f.match(/(\d+)/)[1], 10),
        file: f,
        path: path.join(dir, f),
      }));
  }
  // 分卷书：扫描 input_data/<bookDir>/<任意卷目录>/<ocrDir>/
  const vol = listVolumePages(bookDir, ocrDir);
  if (!vol.length) throw new Error(`OCR 目录不存在: ${dir}（含分卷扫描）`);
  return vol;
}

/** 分卷书页扫描：input_data/<bookDir>/<卷>/<ocrDir>/page_*.md → [{vol,n,file,path}]（页码升序） */
function listVolumePages(bookDir, ocrDir) {
  const root = path.join(INPUT_DATA, bookDir);
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory() || ent.name.startsWith('_') || ent.name === 'chm_extract') continue;
    const dir = path.join(root, ent.name, ocrDir);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter(f => /^page_\d+\.md$/.test(f))) {
      out.push({ vol: ent.name, n: parseInt(f.match(/(\d+)/)[1], 10), file: f, path: path.join(dir, f) });
    }
  }
  return out.sort((a, b) => a.n - b.n);
}

/** 按页码解析善本 PDF 页路径：平铺优先，分卷书回退卷目录扫描。 */
function pagePdfPath(bookDir, pdfDir, n) {
  const name = `page_${String(n).padStart(4, '0')}.pdf`;
  const flat = path.join(INPUT_DATA, bookDir, pdfDir, name);
  if (fs.existsSync(flat)) return flat;
  const root = path.join(INPUT_DATA, bookDir);
  if (fs.existsSync(root)) {
    for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
      if (!ent.isDirectory() || ent.name.startsWith('_') || ent.name === 'chm_extract') continue;
      const p = path.join(root, ent.name, pdfDir, name);
      if (fs.existsSync(p)) return p;
    }
  }
  return flat; // 不存在时返回平铺路径（调用方 existsSync 自查）
}

/** 页码→卷名（分卷书）：在 <ocrDir> 的卷扫描中定位 n 所在卷。平铺书返回 null。 */
function volumeOfPage(bookDir, ocrDir, n) {
  for (const p of listVolumePages(bookDir, ocrDir)) {
    if (p.n === n) return p.vol;
  }
  return null;
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
  const bookDir = (work && work.inputBook) || bookId;
  const pages = listPages(bookDir, e.ocrDir).map(p => {
    const r = readPage(p.path);
    return { n: p.n, vol: p.vol || null, ...r, isCover: isCoverPage(r.lines, e.role) };
  });
  // PDF 页数（仅登记，不读二进制；分卷书退卷目录合计）
  const pdfDir = path.join(INPUT_DATA, bookDir, e.pdfDir);
  let pdfCount = 0;
  if (fs.existsSync(pdfDir)) {
    pdfCount = fs.readdirSync(pdfDir).filter(f => /\.pdf$/i.test(f)).length;
  } else {
    pdfCount = listVolumePages(bookDir, e.pdfDir).length;
  }
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

module.exports = { loadConfig, loadWork, loadEdition, listPages, listVolumePages, pagePdfPath, volumeOfPage, inputBookOf, readPage, INPUT_DATA, REPO_ROOT };
