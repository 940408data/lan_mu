/**
 * 卷级校录助手：对校本 vs lunyuN text.yaml
 * 1) 逐字 diff（去 ○ 去空格）→ 找字符讹误
 * 2) ○ 总数对比
 * 用法: node tools/_proofread.js <篇行起> <篇行止> <section-id> ...
 */
const fs = require('fs');
const refRaw = fs.readFileSync('input_data/lunyucollect.txt', 'utf-8').replace(/^﻿/, '');
const refLines = refRaw.split(/\r?\n/);

// args: pairs of (start, end, sectionId, workId)
const args = process.argv.slice(2);
const workId = args[args.length - 1];
const yaml = fs.readFileSync(`works/${workId}/text.yaml`, 'utf-8');

function getRefText(startIdx, endIdx) {
  const out = [];
  for (let i = startIdx; i < endIdx; i++) {
    const line = refLines[i];
    if (!line || !line.trim()) continue;
    out.push(line);
  }
  return out.join('');
}

function getLunyuText(sectionId) {
  let inSec = false;
  const parts = [];
  for (const line of yaml.split('\n')) {
    if (line.match(new RegExp(`id:\\s+${sectionId}`))) { inSec = true; continue; }
    if (inSec && line.match(/^\s+-\s+id:/)) break;
    if (!inSec) continue;
    const m = line.match(/text:\s*(.+?)\s*\}\s*$/);
    if (m) {
      const t = m[1];
      if (/^論語集注卷之|^新安朱熹集註$/.test(t)) continue; // 卷首手加，對校本無
      parts.push(t);
    }
  }
  return parts.join('');
}

const norm = s => s.replace(/○/g, '').replace(/\s/g, '').replace(/〔[^〕]*〕/g, '');

// 处理每个 section
for (let i = 0; i < args.length - 1; i += 3) {
  const start = parseInt(args[i]);
  const end = parseInt(args[i + 1]);
  const secId = args[i + 2];
  const refText = getRefText(start, end);
  const lunText = getLunyuText(secId);

  const refO = (refText.match(/○/g) || []).length;
  const lunO = (lunText.match(/○/g) || []).length;
  console.log(`\n══ ${secId} ══`);
  console.log(`  ○ 總數（含行首）：校 ${refO}，本 ${lunO}`);

  const refS = norm(refText);
  const lunS = norm(lunText);
  console.log(`  去○去空格字數：校 ${refS.length}，本 ${lunS.length}`);

  // 逐字 diff（贪心 + 小窗口）
  const diffs = [];
  let ri = 0, li = 0;
  while (ri < refS.length && li < lunS.length) {
    if (refS[ri] === lunS[li]) { ri++; li++; continue; }
    let found = false;
    for (let w = 1; w <= 40 && !found; w++) {
      // 替换（同长）
      if (w === 1 && ri + 1 < refS.length && li + 1 < lunS.length && refS[ri + 1] === lunS[li + 1]) {
        diffs.push(`  字替：校「${refS[ri]}」→本「${lunS[li]}」 ctx「…${refS.slice(Math.max(0, ri - 6), ri)}【】${refS.slice(ri + 1, ri + 7)}…」`);
        ri++; li++; found = true;
      } else if (li + w < lunS.length && refS[ri] === lunS[li + w]) {
        diffs.push(`  本多：「${lunS.slice(li, li + w)}」 ctx「…${lunS.slice(Math.max(0, li - 8), li)}【】${lunS.slice(li + w, li + w + 8)}…」`);
        li += w; found = true;
      } else if (ri + w < refS.length && refS[ri + w] === lunS[li]) {
        diffs.push(`  本少：「${refS.slice(ri, ri + w)}」 ctx「…${refS.slice(Math.max(0, ri - 8), ri)}【】${refS.slice(ri + w, ri + w + 8)}…」`);
        ri += w; found = true;
      } else if (w > 1 && ri + w < refS.length && li + w < lunS.length && refS[ri + w] === lunS[li + w]) {
        diffs.push(`  段替：校「${refS.slice(ri, ri + w)}」→本「${lunS.slice(li, li + w)}」`);
        ri += w; li += w; found = true;
      }
    }
    if (!found) { ri++; li++; }
  }
  if (ri < refS.length) diffs.push(`  本尾部少：「${refS.slice(ri, ri + 60)}…」`);
  if (li < lunS.length) diffs.push(`  本尾部多：「${lunS.slice(li, li + 60)}…」`);

  console.log(`  差異 ${diffs.length} 處：`);
  diffs.forEach(d => console.log(d));
}
