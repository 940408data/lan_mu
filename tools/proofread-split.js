/**
 * 卷级校录（按章对齐版）：
 *   校「…○ 经首句…」切章 → 章内分 j/z；lunyuN 按 blocks 切章。
 *   每章：经文逐字比；注文按字符集合比（消除合并顺序噪音）+ ○ 计数。
 * 用法: node tools/_proofread2.js <workId> <secId> <refStart> <refEnd> [<secId> <refStart> <refEnd> ...]
 */
const fs = require('fs');
const refRaw = fs.readFileSync('input_data/lunyucollect.txt', 'utf-8').replace(/^﻿/, '');
const refLines = refRaw.split(/\r?\n/);
const workId = process.argv[2];
const yaml = fs.readFileSync(`works/${workId}/text.yaml`, 'utf-8');

function refChapters(startIdx, endIdx) {
  const chs = [];
  let cur = null;
  for (let i = startIdx; i < endIdx; i++) {
    const line = refLines[i];
    if (!line || !line.trim()) continue;
    if (line.startsWith('○')) {
      if (cur) chs.push(cur);
      cur = { first: line.replace(/^○[\s ]+/, ''), lines: [] };
    } else if (cur) {
      cur.lines.push(line.trim());
    }
  }
  if (cur) chs.push(cur);
  // 去篇名/篇旨章
  return chs.filter(c => !/^凡[一二三四五六七八九十百]+章/.test(c.first) && !/^此篇多/.test(c.first) && !/^(?:先進|顏淵|子路|憲問|衛靈公|季氏|陽貨|微子|子張|堯曰)第/.test(c.first));
}

// 注文判定（与之前相同）
function isZ(line) {
  if (line.includes('○')) return true;
  if (/^.{1,6}[，、](?:.{1,4}反|音.{1,3}[。，]|如字|又如字)/.test(line)) return true;
  if (/(?:程子|尹氏|謝氏|楊氏|范氏|張子|吳氏|蘇氏|馮氏|游氏|洪氏|馬氏|胡氏|陳氏|侯氏|呂氏|李氏|林氏|鄭氏|周氏|黃氏|劉氏|王氏|孔氏|邢氏|晁氏|陸氏|或)曰/.test(line)) return true;
  if (/^.{1,4}[，、](?:地名|史記|官名|黨名|靈鳥|喪服|無目|諸侯|外棺)/.test(line)) return true;
  if (line.length > 30 && !/子曰|子謂|^曰：「|子貢曰|子路曰|哀公/.test(line)) return true;
  return false;
}
function splitJZ(ch) {
  let j = ch.first, z = '';
  let inZ = false;
  for (const line of ch.lines) {
    if (!inZ) {
      if (isZ(line)) { inZ = true; z += line; }
      else j += line;
    } else {
      if (/^(?:子曰|子謂|曰：「|「)/.test(line) && line.length < 40 && !line.includes('反') && !line.includes('○')) {
        j += line;
      } else {
        z += line;
      }
    }
  }
  return { j, z };
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
      if (/^(?:先進|顏淵|子路|憲問|衛靈公|季氏|陽貨|微子|子張|堯曰|子罕|鄉黨|述而|泰伯)第[一二三四五六七八九十]+$/.test(t)) continue;
      if (cur) chs.push(cur);
      cur = { j: t, z: '' };
    } else if (zM && cur) {
      let t = zM[1];
      if (/^凡[一二三四五六七八九十百]+章|^此篇多評/.test(t)) continue;
      cur.z = t;
    }
  }
  if (cur) chs.push(cur);
  return chs;
}

const norm = s => s.replace(/○/g, '').replace(/\s/g, '').replace(/〔[^〕]*〕/g, '');
const charSig = s => s.split('').sort().join('');

const argv = process.argv.slice(3);
for (let k = 0; k < argv.length; k += 3) {
  const secId = argv[k], start = parseInt(argv[k + 1]), end = parseInt(argv[k + 2]);
  const refs = refChapters(start, end).map(splitJZ);
  const luns = lunyuChapters(secId);
  console.log(`\n══ ${secId}：校 ${refs.length} 章 vs 本 ${luns.length} 章 ══`);
  const n = Math.min(refs.length, luns.length);
  for (let i = 0; i < n; i++) {
    const rj = norm(refs[i].j), lj = norm(luns[i].j);
    const rz = norm(refs[i].z), lz = norm(luns[i].z);
    const issues = [];
    if (rj !== lj) {
      // 经文字符集合差异
      const rSet = new Map(), lSet = new Map();
      for (const c of rj) rSet.set(c, (rSet.get(c) || 0) + 1);
      for (const c of lj) lSet.set(c, (lSet.get(c) || 0) + 1);
      const diffs = [];
      for (const [c, cnt] of rSet) { const d = cnt - (lSet.get(c) || 0); if (d > 0) diffs.push(`本少${c}×${d}`); }
      for (const [c, cnt] of lSet) { const d = cnt - (rSet.get(c) || 0); if (d > 0) diffs.push(`本多${c}×${d}`); }
      issues.push(`經文集差: ${diffs.join(' ')}`);
    }
    // 注文字符集合差异
    const rSet = new Map(), lSet = new Map();
    for (const c of rz) rSet.set(c, (rSet.get(c) || 0) + 1);
    for (const c of lz) lSet.set(c, (lSet.get(c) || 0) + 1);
    const zdiffs = [];
    for (const [c, cnt] of rSet) { const d = cnt - (lSet.get(c) || 0); if (d > 0) zdiffs.push(`本少${c}×${d}`); }
    for (const [c, cnt] of lSet) { const d = cnt - (rSet.get(c) || 0); if (d > 0) zdiffs.push(`本多${c}×${d}`); }
    if (zdiffs.length) issues.push(`注文集差: ${zdiffs.join(' ')}`);
    // ○ 数
    const rO = (refs[i].z.match(/○/g) || []).length;
    const lO = (luns[i].z.match(/○/g) || []).length;
    if (rO !== lO) issues.push(`○ 校${rO} 本${lO}`);

    const prev = luns[i].j.slice(0, 18);
    if (issues.length === 0) console.log(`  ${i + 1}.「${prev}」✓`);
    else { console.log(`  ${i + 1}.「${prev}」`); issues.forEach(x => console.log(`      ${x}`)); }
  }
  if (refs.length !== luns.length) console.log(`  ⚠ 章數不等：校 ${refs.length} vs 本 ${luns.length}`);
}
