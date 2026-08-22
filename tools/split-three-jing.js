/**
 * 三经注疏分割脚本：源文件 → {bookId}_vols/vol_XX.txt（UTF-8）
 *
 * 论语注疏：GBK .txt，● 标记分卷（20 卷）
 * 孟子注疏：GBK .txt，● 标记分节（序 + 题辞 + 14 卷上下 = 27 节）
 * 尔雅注疏：OLE2 .doc，● 标记分节（序 + 19 篇 = 20 节）
 *
 * 用法：node tools/split-three-jing.js [bookId]
 */
const fs = require('fs');
const path = require('path');
const { TextDecoder } = require('util');

const ROOT = path.join(__dirname, '..');
const INPUT_DIR = path.join(ROOT, 'input_data', '十三经注疏');
const dec = new TextDecoder('gbk');

// ── 论语注疏 ──
function splitLunyu() {
  const raw = dec.decode(fs.readFileSync(path.join(INPUT_DIR, '《论语注疏》.txt')));
  const lines = raw.split(/\r?\n/);
  const sections = [];
  let cur = null;

  for (const line of lines) {
    const trimmed = line.replace(/\u3000/g, '').trim();
    // ●卷X·... 为分卷标记
    const m = trimmed.match(/^●\s*卷([一二三四五六七八九十百]+)[·\s](.+)/);
    if (m) {
      if (cur) sections.push(cur);
      cur = { title: `卷${m[1]}·${m[2]}`, lines: [] };
      continue;
    }
    if (cur) cur.lines.push(line);
  }
  if (cur) sections.push(cur);

  const outDir = path.join(INPUT_DIR, 'lunyu_vols');
  fs.mkdirSync(outDir, { recursive: true });
  for (let i = 0; i < sections.length; i++) {
    const volNum = i + 1;
    const outPath = path.join(outDir, `vol_${String(volNum).padStart(2, '0')}.txt`);
    fs.writeFileSync(outPath, sections[i].lines.join('\n'), 'utf8');
  }
  console.log(`论语注疏：${sections.length} 卷 → ${outDir}`);
  return sections.length;
}

// ── 孟子注疏 ──
// exe 提取文本将每卷的 上/下 拆成两个 ● 节，需合并为 1 卷
function splitMengzi() {
  const raw = dec.decode(fs.readFileSync(path.join(INPUT_DIR, '《孟子注疏》.txt')));
  const lines = raw.split(/\r?\n/);
  const rawSections = [];  // ● 分割的原始节
  let cur = null;

  for (const line of lines) {
    const trimmed = line.replace(/\u3000/g, '').trim();
    if (/^●\s*序/.test(trimmed)) {
      if (cur) rawSections.push(cur);
      cur = { title: '序', lines: [], volNum: '', half: '' };
      continue;
    }
    if (/^●\s*题辞/.test(trimmed)) {
      if (cur) rawSections.push(cur);
      cur = { title: '题辞', lines: [], volNum: '', half: '' };
      continue;
    }
    const m = trimmed.match(/^●\s*卷([一二三四五六七八九十百]+)([上下])[·\s](.+)/);
    if (m) {
      if (cur) rawSections.push(cur);
      cur = { title: `卷${m[1]}${m[2]}·${m[3]}`, lines: [], volNum: m[1], half: m[2] };
      continue;
    }
    if (cur) cur.lines.push(line);
  }
  if (cur) rawSections.push(cur);

  // 合并同卷的 上/下 为一卷
  const sections = [];
  const volMap = new Map();  // volNum → { upper, lower }
  const nonVol = [];  // 序/题辞

  for (const s of rawSections) {
    if (!s.volNum) { nonVol.push(s); continue; }
    if (!volMap.has(s.volNum)) volMap.set(s.volNum, {});
    const entry = volMap.get(s.volNum);
    if (s.half === '上') entry.upper = s;
    else entry.lower = s;
  }

  // 序 → vol_01
  for (const s of nonVol) sections.push(s);
  // 按卷号顺序合并
  const volOrder = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四'];
  for (const vn of volOrder) {
    if (!volMap.has(vn)) continue;
    const e = volMap.get(vn);
    const combined = { title: '', lines: [], volNum: vn };
    if (e.upper) { combined.lines.push(...e.upper.lines); combined.title = e.upper.title; }
    if (e.lower) combined.lines.push(...e.lower.lines);
    sections.push(combined);
  }

  const outDir = path.join(INPUT_DIR, 'mengzi_vols');
  fs.mkdirSync(outDir, { recursive: true });
  for (let i = 0; i < sections.length; i++) {
    const volNum = i + 1;
    const outPath = path.join(outDir, `vol_${String(volNum).padStart(2, '0')}.txt`);
    fs.writeFileSync(outPath, sections[i].lines.join('\n'), 'utf8');
  }
  console.log(`孟子注疏：${sections.length} 卷（${nonVol.length} 序 + ${volOrder.length} 卷合并）→ ${outDir}`);
  sections.forEach((s, i) => console.log(`  vol_${String(i + 1).padStart(2, '0')}: ${s.title} (${s.lines.length} 行)`));
  return sections.length;
}

// ── 尔雅注疏 ──
async function splitErya() {
  const WordExtractor = require('word-extractor');
  const extractor = new WordExtractor();
  const doc = await extractor.extract(path.join(INPUT_DIR, '尔雅注疏.doc'));
  const raw = doc.getBody();
  const lines = raw.split(/\r?\n/);

  // 跳过目录区域：找到第二个 ●《尔雅》疏叙（即正文开始）
  let startIdx = -1;
  let foundFirst = false;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].replace(/\u3000/g, '').trim();
    if (/^●《尔雅》疏叙/.test(t)) {
      if (foundFirst) { startIdx = i; break; }
      foundFirst = true;
    }
  }
  if (startIdx < 0) {
    console.error('尔雅注疏：找不到正文起始位置');
    return 0;
  }

  const sections = [];
  let cur = null;

  for (let i = startIdx; i < lines.length; i++) {
    const t = lines[i].replace(/\u3000/g, '').trim();
    // ●《尔雅》疏叙（正文起始标题）
    if (/^●《尔雅》疏叙/.test(t)) {
      if (cur) sections.push(cur);
      cur = { title: '疏叙', lines: [] };
      continue;
    }
    // ●卷一·序
    const mOrder = t.match(/^●\s*卷([一二三四五六七八九十百]+)[·\s]序/);
    if (mOrder) {
      if (cur) sections.push(cur);
      cur = { title: `卷${mOrder[1]}·序`, lines: [] };
      continue;
    }
    // ●卷X·释X第X
    const m = t.match(/^●\s*卷([一二三四五六七八九十百]+)[·\s](释.+)/);
    if (m) {
      if (cur) sections.push(cur);
      cur = { title: `卷${m[1]}·${m[2]}`, lines: [] };
      continue;
    }
    if (cur) cur.lines.push(lines[i]);
  }
  if (cur) sections.push(cur);

  const outDir = path.join(INPUT_DIR, 'erya_vols');
  fs.mkdirSync(outDir, { recursive: true });
  for (let i = 0; i < sections.length; i++) {
    const volNum = i + 1;
    const outPath = path.join(outDir, `vol_${String(volNum).padStart(2, '0')}.txt`);
    fs.writeFileSync(outPath, sections[i].lines.join('\n'), 'utf8');
  }
  console.log(`尔雅注疏：${sections.length} 节 → ${outDir}`);
  sections.forEach((s, i) => console.log(`  vol_${String(i + 1).padStart(2, '0')}: ${s.title} (${s.lines.length} 行)`));
  return sections.length;
}

// ── 主流程 ──
(async () => {
  const only = process.argv[2];
  let total = 0;
  if (!only || only === 'lunyu') total += splitLunyu();
  if (!only || only === 'mengzi') total += splitMengzi();
  if (!only || only === 'erya') total += await splitErya();
  console.log(`\n完成：共 ${total} 节`);
})();
