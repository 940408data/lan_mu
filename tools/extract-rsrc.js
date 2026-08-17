/**
 * 从解包后的 exe 提取 HTML 资源
 * 适用于十三经注疏 exe（Delphi + IE WebBrowser）
 */
const fs = require('fs');
const path = require('path');

const exePath = process.argv[2] || 'input_data/十三经注疏/02.《尚书正义》_unpacked.exe';
const outDir = process.argv[3] || 'input_data/十三经注疏/shangshu_extracted';

const buf = fs.readFileSync(exePath);
const peOff = buf.readUInt32LE(0x3C);
const numSections = buf.readUInt16LE(peOff + 6);
const optHdrSize = buf.readUInt16LE(peOff + 20);
const sectStart = peOff + 24 + optHdrSize;

// 找到 .rsrc 节
let rsrcFileOff = 0, rsrcSize = 0;
for (let i = 0; i < numSections; i++) {
  const off = sectStart + i * 40;
  const name = buf.toString('ascii', off, off + 8).replace(/\0/g, '');
  if (name === '.rsrc') {
    rsrcFileOff = buf.readUInt32LE(off + 20);
    rsrcSize = buf.readUInt32LE(off + 16);
    console.log(`.rsrc: file offset=${rsrcFileOff}, size=${rsrcSize}`);
  }
}

if (!rsrcSize) { console.error('未找到 .rsrc 节'); process.exit(1); }

function rvaToFileOffset(rva) {
  for (let i = 0; i < numSections; i++) {
    const off = sectStart + i * 40;
    const vAddr = buf.readUInt32LE(off + 12);
    const rawSize = buf.readUInt32LE(off + 16);
    const rawOff = buf.readUInt32LE(off + 20);
    if (rva >= vAddr && rva < vAddr + rawSize) {
      return rawOff + (rva - vAddr);
    }
  }
  return -1;
}

// 收集所有资源条目
const allEntries = [];
function collectEntries(rsrcDirOff, level, typePath) {
  if (level > 3) return;
  const absOff = rsrcFileOff + rsrcDirOff;
  const numNamed = buf.readUInt16LE(absOff + 12);
  const numId = buf.readUInt16LE(absOff + 14);

  for (let i = 0; i < numNamed + numId; i++) {
    const entryOff = absOff + 16 + i * 8;
    if (entryOff + 8 > rsrcFileOff + rsrcSize) return;

    const nameOrId = buf.readUInt32LE(entryOff);
    const dataOrDir = buf.readUInt32LE(entryOff + 4);
    const isDir = (dataOrDir & 0x80000000) !== 0;

    if (isDir) {
      const subDirOff = dataOrDir & 0x7FFFFFFF;
      collectEntries(subDirOff, level + 1, [...typePath, nameOrId]);
    } else {
      const dataEntryAbs = rsrcFileOff + dataOrDir;
      if (dataEntryAbs + 8 > buf.length) continue;
      const dataRva = buf.readUInt32LE(dataEntryAbs);
      const dataSize = buf.readUInt32LE(dataEntryAbs + 4);
      const dataFileOff = rvaToFileOffset(dataRva);
      if (dataFileOff >= 0 && dataSize > 0 && dataFileOff + dataSize <= buf.length) {
        allEntries.push({ path: typePath, id: nameOrId, offset: dataFileOff, size: dataSize });
      }
    }
  }
}

collectEntries(0, 0, []);
console.log(`找到 ${allEntries.length} 个资源条目`);

fs.mkdirSync(outDir, { recursive: true });

let htmlCount = 0, otherCount = 0;

for (const entry of allEntries) {
  const [type, name, lang] = entry.path;
  const data = buf.slice(entry.offset, entry.offset + entry.size);

  // 检测 HTML
  const head = data.slice(0, Math.min(data.length, 200));
  const headStr = head.toString('latin1').toLowerCase();
  const isHtml = headStr.includes('<html') || headStr.includes('<body') ||
                 headStr.includes('<!doctype') || headStr.includes('<head') ||
                 headStr.includes('<table') || headStr.includes('<div');

  if (isHtml && entry.size > 50) {
    htmlCount++;
    // 尝试 GBK 解码
    let text;
    try {
      const iconv = require('iconv-lite');
      text = iconv.decode(data, 'gbk');
    } catch {
      text = data.toString('utf8');
    }
    const outFile = path.join(outDir, `${name}.html`);
    fs.writeFileSync(outFile, text, 'utf8');
    console.log(`  HTML: type=${type} name=${name} size=${entry.size} → ${name}.html`);
  } else {
    otherCount++;
  }
}

console.log(`\n统计: HTML=${htmlCount}, 其他=${otherCount}, 总计=${allEntries.length}`);
console.log(`输出目录: ${outDir}`);
