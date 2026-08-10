/**
 * 卷级校录 v3：按章对齐，j+z 并集字符多重集比对（消除 j/z 归属与顺序噪音）。
 * 用法: node tools/_proofread3.js <workId> <secId> <refStart> <refEnd> [...]
 */
const fs = require('fs');
const refRaw = fs.readFileSync('input_data/lunyucollect.txt', 'utf-8').replace(/^﻿/, '');
const refLines = refRaw.split(/\r?\n/);
const workId = process.argv[2];
const yaml = fs.readFileSync(`works/${workId}/text.yaml`, 'utf-8');

const norm = s => s.replace(/○/g, '').replace(/\s/g, '').replace(/〔[^〕]*〕/g, '');

function refChapters(startIdx, endIdx) {
  const chs = [];
  let cur = null;
  for (let i = startIdx; i < endIdx; i++) {
    const line = refLines[i];
    if (!line || !line.trim()) continue;
    if (line.startsWith('○')) {
      if (cur) chs.push(cur);
      cur = [line.replace(/^○[\s ]+/, '')];
    } else if (cur) cur.push(line.trim());
  }
  if (cur) chs.push(cur);
  return chs.filter(c => !/^凡[一二三四五六七八九十百]+章/.test(c[0]) && !/^此篇多/.test(c[0]));
}

function lunyuChapters(secId) {
  let inSec = false;
  const chs = [];
  let cur = null;
  for (const line of yaml.split('\n')) {
    if (line.match(new RegExp(`id:\\s+${secId}`))) { inSec = true; continue; }
    if (inSec && line.match(/^\s+-\s+id:/)) break;
    if (!inSec) continue;
    const jM = line.match(/type:\s*j,\s*text:\s*(.+?)\s*\}/);
    const zM = line.match(/type:\s*z,\s*text:\s*(.+?)\s*\}/);
    if (jM) {
      const t = jM[1];
      if (/^論語集注卷之|^新安朱熹集註$/.test(t)) continue;
      if (/第[一二三四五六七八九十]+$/.test(t) && t.length <= 7) continue;
      if (cur) chs.push(cur);
      cur = [t];
    } else if (zM && cur) {
      let t = zM[1];
      if (/^凡[一二三四五六七八九十百]+章|^此篇多評/.test(t)) continue;
      cur.push(t);
    }
  }
  if (cur) chs.push(cur);
  return chs;
}

function multiDiff(a, b) {
  const am = new Map(), bm = new Map();
  for (const c of a) am.set(c, (am.get(c) || 0) + 1);
  for (const c of b) bm.set(c, (bm.get(c) || 0) + 1);
  const out = [];
  for (const [c, n] of am) { const d = n - (bm.get(c) || 0); if (d > 0) out.push(`本少${c}×${d}`); }
  for (const [c, n] of bm) { const d = n - (am.get(c) || 0); if (d > 0) out.push(`本多${c}×${d}`); }
  return out;
}

const argv = process.argv.slice(3);
for (let k = 0; k < argv.length; k += 3) {
  const secId = argv[k], start = parseInt(argv[k + 1]), end = parseInt(argv[k + 2]);
  const refs = refChapters(start, end).map(c => norm(c.join('')));
  const luns = lunyuChapters(secId).map(c => norm(c.join('')));
  console.log(`\n══ ${secId}：校 ${refs.length} 章 vs 本 ${luns.length} 章 ══`);
  let problems = 0;
  for (let i = 0; i < Math.max(refs.length, luns.length); i++) {
    if (i >= refs.length) { console.log(`  ${i + 1}. 本多出章`); problems++; continue; }
    if (i >= luns.length) { console.log(`  ${i + 1}. 對校多出章`); problems++; continue; }
    const diffs = multiDiff(refs[i], luns[i]);
    if (diffs.length === 0) continue; // ✓ 不打印，减少噪音
    problems++;
    console.log(`  ${i + 1}. ${diffs.join(' ')}`);
    // 打印上下文（本的前20字）
    console.log(`      章首：「${luns[i].slice(0, 20)}」`);
  }
  console.log(`  → ${problems === 0 ? '全章字符一致 ✓' : `問題章 ${problems} 個`}`);
}
