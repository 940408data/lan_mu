/**
 * 将周礼注疏合并文本按卷分割为单独文件
 */
const fs = require('fs');
const path = require('path');

const mergedFile = 'input_data/十三经注疏/zhouli_merged.txt';
const outDir = 'input_data/十三经注疏/zhouli_vols';

const raw = fs.readFileSync(mergedFile, 'utf8');
const lines = raw.split(/\r?\n/);

fs.mkdirSync(outDir, { recursive: true });

const CN2NUM = {
  '一': '01', '二': '02', '三': '03', '四': '04', '五': '05',
  '六': '06', '七': '07', '八': '08', '九': '09', '十': '10',
  '十一': '11', '十二': '12', '十三': '13', '十四': '14', '十五': '15',
  '十六': '16', '十七': '17', '十八': '18', '十九': '19', '二十': '20',
  '二十一': '21', '二十二': '22', '二十三': '23', '二十四': '24', '二十五': '25',
  '二十六': '26', '二十七': '27', '二十八': '28', '二十九': '29', '三十': '30',
  '三十一': '31', '三十二': '32', '三十三': '33', '三十四': '34', '三十五': '35',
  '三十六': '36', '三十七': '37', '三十八': '38', '三十九': '39', '四十': '40',
  '四十一': '41', '四十二': '42'
};

const volPattern = /^卷([一二三四五六七八九十百]+)/;
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
