/**
 * 合并尚书正义提取的页面文件为完整文本
 * 输入：input_data/十三经注疏/shangshu_extracted/page_*.txt
 * 输出：input_data/十三经注疏/shangshu_merged.txt
 */
const fs = require('fs');
const path = require('path');

const inDir = 'input_data/十三经注疏/shangshu_extracted';
const outFile = 'input_data/十三经注疏/shangshu_merged.txt';

// 读取所有页面（跳过目录页 page_000_toc.txt）
const pages = [];
for (let i = 1; i <= 59; i++) {
  const file = path.join(inDir, `page_${String(i).padStart(3, '0')}.txt`);
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf8');
    pages.push(content);
    console.log(`读取 page_${String(i).padStart(3, '0')}.txt (${content.length} chars)`);
  }
}

// 合并所有页面
const merged = pages.join('\n\n');
fs.writeFileSync(outFile, merged, 'utf8');
console.log(`\n合并完成: ${outFile} (${merged.length} chars, ${pages.length} pages)`);

// 分析卷次分布
const lines = merged.split(/\r?\n/);
const volPattern = /^卷([一二三四五六七八九十]+)\s/;
let currentVol = null;
const volRanges = {};

for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  const m = line.match(volPattern);
  if (m) {
    const vol = m[1];
    if (!volRanges[vol]) {
      volRanges[vol] = { start: i, end: i };
    }
    currentVol = vol;
  }
  if (currentVol && volRanges[currentVol]) {
    volRanges[currentVol].end = i;
  }
}

console.log('\n=== 卷次分布 ===');
const CN2NUM = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '十一': 11, '十二': 12, '十三': 13, '十四': 14, '十五': 15, '十六': 16, '十七': 17, '十八': 18, '十九': 19, '二十': 20 };
for (const [vol, range] of Object.entries(volRanges).sort((a, b) => CN2NUM[a[0]] - CN2NUM[b[0]])) {
  const lineCount = range.end - range.start + 1;
  console.log(`卷${vol}: 行 ${range.start}-${range.end} (${lineCount} 行)`);
}
