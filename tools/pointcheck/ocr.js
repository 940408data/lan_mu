#!/usr/bin/env node
/**
 * 点校系统 · OCR 管路（P1）
 * pdf/jpg/png → 页图 → tesseract OCR → text + tsv(bbox/置信度)
 *
 * 用法: node tools/pointcheck/ocr.js <pdf|jpg|png> <outdir> [--lang=chi_tra] [--dpi=300]
 *   --lang  tesseract 语言（chi_tra 繁体善本 / chi_sim 简体点校本 / eng），默认 chi_tra
 *   --dpi    pdftoppm 渲染 dpi（默认 300；善本扫描够清）
 *
 * 产出:
 *   <outdir>/pages/page-NNN.txt      每页纯文本
 *   <outdir>/pages/page-NNN.tsv      每页 bbox + 置信度（供精校图文对照定位）
 *   <outdir>/combined.txt             全文（按页拼接）
 *   <outdir>/manifest.json            页→文件映射 + 引擎/lang/dpi
 *
 * 依赖: tesseract（apt tesseract-ocr + chi_tra/chi_sim）、poppler（pdftoppm，pdf 输入时）。
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (const a of args) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) flags[m[1]] = m[2] === undefined ? true : m[2];
  else positional.push(a);
}
const [input, outdir] = positional;
if (!input || !outdir) {
  console.error('用法: node tools/pointcheck/ocr.js <pdf|jpg|png> <outdir> [--lang=chi_tra] [--dpi=300]');
  process.exit(1);
}
const lang = flags.lang || 'chi_tra';
const dpi = flags.dpi || '300';

function sh(cmd) { execSync(cmd, { stdio: ['ignore', 'ignore', 'inherit'] }); }
function q(p) { return JSON.stringify(p); }  // shell-safe quote

fs.mkdirSync(path.join(outdir, 'pages'), { recursive: true });

// 1. 输入 → 页图列表
let pageImgs = [];
const ext = path.extname(input).toLowerCase();
if (ext === '.pdf') {
  const prefix = path.join(outdir, 'pages', 'page');
  sh(`pdftoppm -png -r ${dpi} ${q(input)} ${q(prefix)}`);
  pageImgs = fs.readdirSync(path.join(outdir, 'pages'))
    .filter(f => /^page-\d+\.(png|jpg)$/.test(f))
    .map(f => ({ f, n: parseInt(f.match(/(\d+)/)[1], 10) }))
    .sort((a, b) => a.n - b.n)
    .map(x => path.join(outdir, 'pages', x.f));
  if (!pageImgs.length) { console.error('✗ pdftoppm 未产出页图'); process.exit(1); }
} else if (ext === '.jpg' || ext === '.jpeg' || ext === '.png') {
  pageImgs = [input];
} else {
  console.error('✗ 不支持的输入（须 pdf/jpg/png）: ' + ext);
  process.exit(1);
}

// 2. 每页 OCR（txt + tsv）
const manifest = { input: path.basename(input), lang, dpi, engine: 'tesseract', pages: [] };
let combined = '';
pageImgs.forEach((img, i) => {
  const idx = String(i + 1).padStart(3, '0');
  const base = path.join(outdir, 'pages', `page-${idx}`);
  sh(`tesseract ${q(img)} ${q(base)} -l ${lang}`);
  sh(`tesseract ${q(img)} ${q(base)} -l ${lang} tsv`);  // → base.tsv
  const txt = fs.existsSync(base + '.txt') ? fs.readFileSync(base + '.txt', 'utf8') : '';
  combined += `\n=== page ${idx} ===\n${txt}`;
  manifest.pages.push({ idx, src: path.basename(img), txt: `page-${idx}.txt`, tsv: `page-${idx}.tsv`, chars: txt.replace(/\s/g, '').length });
  console.log(`  page ${idx}: ${txt.replace(/\s/g, '').length} 字`);
});

fs.writeFileSync(path.join(outdir, 'combined.txt'), combined);
fs.writeFileSync(path.join(outdir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`✓ OCR 完成: ${pageImgs.length} 页, lang=${lang}, dpi=${dpi}, 输出 ${outdir}/`);
