/**
 * 尚书正义抽取脚本：解析从 exe 提取的 txt → text.yaml (j/z blocks)
 *
 * 数据来源：十三经注疏 exe（Delphi + IE WebBrowser 控件，GBK 编码）
 * 结构：每段 = j 行（经+孔安国注）+ z 行（孔颖达 [疏]）
 *
 * 用法：node tools/extract-shangshu.js <merged_txt> [--vol=一] [--out=text.yaml]
 */
const fs = require('fs');
const path = require('path');
const OpenCC = require('opencc-js');

const args = process.argv.slice(2);
const flags = {};
for (const a of args) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) flags[m[1]] = m[2] === undefined ? true : m[2];
}
const txtPath = args.find((a) => !a.startsWith('--'));
if (!txtPath) {
  console.error('用法: node tools/extract-shangshu.js <merged_txt> [--vol=一] [--out=text.yaml]');
  process.exit(1);
}

const volNum = flags.vol || '一';
const outPath = flags.out || path.join(path.dirname(txtPath), '..', 'works', 'shangshu-juan' + volNum.replace(/[一二三四五六七八九十]+/, ''), 'text.yaml');

// ── 1. 读取文本 ──
const raw = fs.readFileSync(txtPath, 'utf8');
const lines = raw.split(/\r?\n/);

// ── 2. opencc s2tw + 修正 ──
const s2tw = OpenCC.Converter({ from: 'cn', to: 'tw' });
// 尚书正义特有修正
const CORRECT = {
  '嘆': '歎', '遊': '游', '慾': '欲', '繫': '系', '弔': '吊', '慼': '戚', '裡': '裏',
};
const fixOpencc = (s) => {
  s = s.replace(/嘆|遊|慾|繫|弔|慼|裡/g, (c) => CORRECT[c] || c);
  return s;
};

// ── 3. 清理单行 ──
function clean(line) {
  return line
    .replace(/^\s+/g, '')   // 去前导空白
    .replace(/\s+$/g, '')   // 去尾随空白
    .replace(/\u3000/g, '')  // 去全角空格
    .trim();
}

// ── 4. 解析为 j/z 块 ──
const blocks = [];
let skipHeader = true;

for (let i = 0; i < lines.length; i++) {
  const t = clean(lines[i]);

  // 跳过文件头（书名、卷名等）
  if (skipHeader) {
    if (t === '《尚书正义》' || t.startsWith('卷') || t.startsWith('尚书') || t === '') continue;
    // 遇到第一个实际内容行时结束 header
    if (t.length > 5 && !t.startsWith('《尚书') && !t.startsWith('卷')) {
      skipHeader = false;
    } else {
      continue;
    }
  }

  // 跳过文件尾
  if (t.startsWith('目录页') || t.startsWith('上一页') || t.startsWith('□') || t === '下一页') continue;
  if (t === '') continue;  // 跳过空行

  // 分类
  if (t.startsWith('[疏]')) {
    // 疏文 → z 块
    const text = t.replace(/^\[疏\]/, '').trim();
    if (text) blocks.push({ type: 'z', text });
  } else if (t.startsWith('《尚书·') || t.match(/^卷[一二三四五六七八九十]+/)) {
    // 卷首标题 → 跳过
    continue;
  } else {
    // 经+注 → j 块
    blocks.push({ type: 'j', text: t });
  }
}

// ── 5. 转换：s2tw + 修正 ──
for (const b of blocks) {
  b.text = s2tw(b.text);
  b.text = fixOpencc(b.text);
}

// ── 6. 统计 ──
const jBlocks = blocks.filter(b => b.type === 'j');
const zBlocks = blocks.filter(b => b.type === 'z');
const jChars = jBlocks.reduce((s, b) => s + b.text.length, 0);
const zChars = zBlocks.reduce((s, b) => s + b.text.length, 0);
console.log(`j blocks: ${jBlocks.length} (${jChars} chars)`);
console.log(`z blocks: ${zBlocks.length} (${zChars} chars)`);
console.log(`total: ${blocks.length} blocks, ${jChars + zChars} chars`);

// ── 7. 生成 YAML ──
const yamlLines = [];
yamlLines.push(`# 尚書正義卷${volNum}（孔穎達疏）：j 為經文＋孔安國注，z 為正義疏文。`);
yamlLines.push(`sections:`);
const CN2NUM = { '一': '1', '二': '2', '三': '3', '四': '4', '五': '5', '六': '6', '七': '7', '八': '8', '九': '9', '十': '10', '十一': '11', '十二': '12', '十三': '13', '十四': '14', '十五': '15', '十六': '16', '十七': '17', '十八': '18', '十九': '19', '二十': '20' };
const sectionNum = CN2NUM[volNum] || volNum;
yamlLines.push(`  - id: juan${sectionNum}`);
yamlLines.push(`    name: 卷${volNum}`);
yamlLines.push(`    blocks:`);
for (const b of blocks) {
  const escaped = b.text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\x00-\x1f]/g, '');
  yamlLines.push(`      - { type: ${b.type}, text: "${escaped}" }`);
}

const outDir = path.dirname(outPath);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, yamlLines.join('\n') + '\n', 'utf8');
console.log(`\n输出: ${outPath}`);
