/**
 * 合并毛诗正义提取页面为完整文本
 * 输入：input_data/十三经注疏/maoshi_extracted/page_*.txt
 * 输出：input_data/十三经注疏/maoshi_merged.txt
 */
const fs = require('fs');
const path = require('path');

const inDir = 'input_data/十三经注疏/maoshi_extracted';
const outFile = 'input_data/十三经注疏/maoshi_merged.txt';

const files = fs.readdirSync(inDir)
  .filter(f => /^page_\d+\.txt$/.test(f))
  .sort();

let merged = '';
for (const f of files) {
  const content = fs.readFileSync(path.join(inDir, f), 'utf8');
  merged += content + '\n';
}

fs.writeFileSync(outFile, merged, 'utf8');
console.log(`合并完成: ${files.length} 页, ${merged.length} 字符`);

// 分析卷次分布
const volPattern = /^卷([一二三四五六七八九十百]+)\s/gm;
const vols = [];
let m;
while ((m = volPattern.exec(merged)) !== null) {
  vols.push(m[1]);
}
console.log(`检测到卷次: ${[...new Set(vols)].join(', ')}`);
console.log(`共 ${new Set(vols).size} 卷`);
