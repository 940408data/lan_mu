/**
 * 将毛诗正义合并文本按卷分割为单独文件
 * 输入：input_data/十三经注疏/maoshi_merged.txt
 * 输出：input_data/十三经注疏/maoshi_vols/vol_XX.txt
 */
const fs = require('fs');
const path = require('path');

const mergedFile = 'input_data/十三经注疏/maoshi_merged.txt';
const outDir = 'input_data/十三经注疏/maoshi_vols';

const raw = fs.readFileSync(mergedFile, 'utf8');
const lines = raw.split(/\r?\n/);

fs.mkdirSync(outDir, { recursive: true });

// 中文数字到阿拉伯数字映射
const CN2NUM = {
  '一': '01', '二': '02', '三': '03', '四': '04', '五': '05',
  '六': '06', '七': '07', '八': '08', '九': '09', '十': '10',
  '十一': '11', '十二': '12', '十三': '13', '十四': '14', '十五': '15',
  '十六': '16', '十七': '17', '十八': '18', '十九': '19', '二十': '20'
};

const volPattern = /^卷([一二三四五六七八九十]+)\s/;
let currentVol = null;
let currentLines = [];
const volData = {};

for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  const m = line.match(volPattern);
  
  if (m) {
    // 保存上一卷
    if (currentVol && currentLines.length > 0) {
      volData[currentVol] = currentLines.join('\n');
    }
    // 开始新卷
    currentVol = m[1];
    currentLines = [lines[i]];
  } else if (currentVol) {
    currentLines.push(lines[i]);
  }
}
// 保存最后一卷
if (currentVol && currentLines.length > 0) {
  volData[currentVol] = currentLines.join('\n');
}

// 写入各卷文件
for (const [vol, content] of Object.entries(volData)) {
  const num = CN2NUM[vol] || vol;
  const outFile = path.join(outDir, `vol_${num}.txt`);
  fs.writeFileSync(outFile, content, 'utf8');
  console.log(`卷${vol} → vol_${num}.txt (${content.length} chars)`);
}

console.log(`\n共分割 ${Object.keys(volData).length} 卷`);
