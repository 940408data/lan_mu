#!/usr/bin/env node
/**
 * 点校系统 · AI 初校（P2 脚手架）
 * OCR tsv（bbox+置信度）→ 按字高区分经(j大字)/注(z小字) → opencc+CORRECT → text.yaml 草稿 + 疑难点 flags
 *
 * 用法: node tools/pointcheck/ai.js <ocr-outdir> <work-id> [--name=篇名] [--vol=N]
 *   读 <ocr-outdir>/pages/page-NNN.tsv（ocr.js 产出）+ combined.txt
 *   产 <ocr-outdir>/draft-text.yaml + flags.yaml
 *
 * 说明：本脚本为规则基线（按 OCR 字高聚类经注），LLM（Claude API）结构化为后续增强——
 *   规则基线处理清晰版面；疑难（残字/异体字/经注难辨）应转 LLM，此处输出 flags 供人工/LLM 复核。
 *   opencc/CORRECT/○ 规则复用 extract-*.js 既有逻辑（见 tools/extract-mengzi.js）。
 */
const fs = require('fs');
const path = require('path');
const OpenCC = require('opencc-js');
const s2tw = OpenCC.Converter({ from: 'cn', to: 'tw' });

const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (const a of args) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) flags[m[1]] = m[2] === undefined ? true : m[2];
  else positional.push(a);
}
const [ocrdir, workId] = positional;
if (!ocrdir || !workId) {
  console.error('用法: node tools/pointcheck/ai.js <ocr-outdir> <work-id> [--name=篇名] [--vol=N]');
  process.exit(1);
}

// opencc 过度转修正（与 extract-*.js 一致）
const fixOpencc = (s) => s.replace(/嘆|遊|慾|系|吊|慼|裡|並|範/g, (c) => ({ '嘆': '歎', '遊': '游', '慾': '欲', '系': '繫', '吊': '弔', '慼': '戚', '裡': '里', '並': '并', '範': '范' }[c] || c));
const quotes = (s) => s.replace(/“/g, '「').replace(/”/g, '」').replace(/‘/g, '『').replace(/’/g, '』');

// 解析 tsv：返回 [{text, conf, h, page}, ...]（h=字高，用于经/注聚类）
function parseTsv(tsvPath) {
  const lines = fs.readFileSync(tsvPath, 'utf8').trim().split('\n');
  const header = lines[0].split('\t');
  const iText = header.indexOf('text');
  const iConf = header.indexOf('conf');
  const iH = header.indexOf('height');
  const iLevel = header.indexOf('level');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split('\t');
    if (c[iLevel] !== '5') continue;  // level 5 = word/char
    if (!c[iText] || c[iText] === ' ' || c[iText] === '') continue;
    out.push({ text: c[iText], conf: parseFloat(c[iConf]), h: parseInt(c[iH], 10) });
  }
  return out;
}

// 按字高聚类：中位字高为阈值，高于=经(j)，低于=注(z)
function clusterJZ(chars) {
  const hs = chars.map(c => c.h).filter(h => h > 0).sort((a, b) => a - b);
  if (!hs.length) return [];
  const med = hs[Math.floor(hs.length / 2)];
  const thresh = med * 1.15;  // 高于中位 15% 视为大字（经）
  // 分段：连续同类归一块，类切换另起
  const blocks = [];
  let cur = null;
  for (const c of chars) {
    const isJ = c.h >= thresh;
    if (!cur || cur.type !== (isJ ? 'j' : 'z')) {
      if (cur) blocks.push(cur);
      cur = { type: isJ ? 'j' : 'z', text: '', confs: [] };
    }
    cur.text += c.text;
    cur.confs.push(c.conf);
  }
  if (cur) blocks.push(cur);
  return blocks.map(b => ({ type: b.type, text: b.text, conf: b.confs.reduce((a, c) => a + c, 0) / b.confs.length }));
}

// 主
const pagesDir = path.join(ocrdir, 'pages');
const pages = fs.readdirSync(pagesDir).filter(f => /page-\d+\.tsv$/.test(f)).sort();
if (!pages.length) { console.error('✗ 无 tsv（先跑 ocr.js）'); process.exit(1); }

let allBlocks = [];
let lowConf = [];
const lowConfThresh = 60;
pages.forEach(p => {
  const chars = parseTsv(path.join(pagesDir, p));
  const blocks = clusterJZ(chars);
  blocks.forEach(b => {
    const text = quotes(fixOpencc(s2tw(b.text)));
    allBlocks.push({ type: b.type, text });
    if (b.conf < lowConfThresh) lowConf.push({ page: p, type: b.type, conf: b.conf.toFixed(1), text: b.text.slice(0, 20), note: '低置信，建议人工/LLM 复核' });
  });
});

// 输出 draft-text.yaml
const name = flags.name || workId;
const vol = flags.vol || '';
let out = `# 点校系统 AI 初校草稿（规则基线）· ${workId}\n# 由 OCR tsv 按字高聚类经/注 + opencc+CORRECT 生成；疑难见 flags.yaml\nsections:\n  - id: ${workId}\n    name: ${name}\n    blocks:\n`;
for (const b of allBlocks) out += `      - { type: ${b.type}, text: ${b.text} }\n`;
fs.writeFileSync(path.join(ocrdir, 'draft-text.yaml'), out);
fs.writeFileSync(path.join(ocrdir, 'flags.yaml'), JSON.stringify(lowConf, null, 2));
console.log(`✓ AI 初校草稿: ${allBlocks.length} 块 (j${allBlocks.filter(b => b.type === 'j').length}/z${allBlocks.filter(b => b.type === 'z').length}), 疑难点 ${lowConf.length} 处`);
console.log(`  → ${ocrdir}/draft-text.yaml + flags.yaml`);
if (lowConf.length) console.log('  注：规则基线对竖排善本经/注聚类粗糙，建议接 LLM（Claude API）做结构化 + 疑难判定。');
