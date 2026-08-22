/**
 * 将孝经注疏合并文本按卷分割为单独文件
 */
const fs = require('fs');
const path = require('path');

const mergedFile = 'input_data/十三经注疏/xiaojing_merged.txt';
const outDir = 'input_data/十三经注疏/xiaojing_vols';

const raw = fs.readFileSync(mergedFile, 'utf8');
const lines = raw.split(/\r?\n/);

fs.mkdirSync(outDir, { recursive: true });

const CN2NUM = {
  '一': '01', '二': '02', '三': '03', '四': '04', '五': '05',
  '六': '06', '七': '07', '八': '08', '九': '09'
};

const volPattern = /^卷([一二三四五六七八九十百]+)\s/;
let currentVol = null;
let currentLines = [];
const volData = {};

for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  const m = line.match(volPattern);
  
  if (m) {
    if (currentVol && currentLines.length > 0) {
      volData[currentVol] = currentLines.join('\n');
    }
    currentVol = m[1];
    currentLines = [lines[i]];
  } else if (currentVol) {
    currentLines.push(lines[i]);
  }
}
if (currentVol && currentLines.length > 0) {
  volData[currentVol] = currentLines.join('\n');
}

for (const [vol, content] of Object.entries(volData)) {
  const num = CN2NUM[vol] || vol;
  const outFile = path.join(outDir, `vol_${num}.txt`);
  fs.writeFileSync(outFile, content, 'utf8');
  console.log(`卷${vol} → vol_${num}.txt (${content.length} chars)`);
}

console.log(`\n共分割 ${Object.keys(volData).length} 卷`);
