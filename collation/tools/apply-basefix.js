#!/usr/bin/env node
/**
 * collation · P4.5 回路：善本底本误回修（tools/apply-basefix.js）
 * 读 clusters-verify.json 中「善本底本误」簇，按前后锚点在 shanben-v2.json 对应页定位，
 * 以视觉照录的「善本实印」(sbActual) 替换底本误文（实印「无」= 删除衍文）。
 * 回修后须重跑：run.js <书> --step=diff（簇核验结论自动按内容键迁移）→ verify → officer → export。
 *
 * 产物：私有 _derived/collation/basefix-log.json（永久修复记录，校勘记第四节取此）；
 * clusters-verify.json 中已修条目标 fixed。
 * 用法: node collation/tools/apply-basefix.js <书名> [--dry]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { privatePath, internalReadPath } = require('../src/paths');

const args = process.argv.slice(2);
const flags = {}, pos = [];
for (const a of args) { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) flags[m[1]] = m[2] ?? true; else pos.push(a); }
const workId = pos[0];
if (!workId) { console.error('用法: node collation/tools/apply-basefix.js <书名> [--dry]'); process.exit(1); }
const dry = !!flags.dry;

const dir = path.join(__dirname, '..', 'data', workId);
const v2path = path.join(dir, 'shanben-v2.json');
const v2 = JSON.parse(fs.readFileSync(v2path, 'utf8'));
const clusters = JSON.parse(fs.readFileSync(internalReadPath(workId, 'clusters.json'), 'utf8'));
const verifs = JSON.parse(fs.readFileSync(internalReadPath(workId, 'clusters-verify.json'), 'utf8'));
const cmap = {}; clusters.forEach(c => cmap[c.id] = c);

const logPath = privatePath(workId, 'basefix-log.json');
const log = fs.existsSync(logPath) ? JSON.parse(fs.readFileSync(logPath, 'utf8')) : [];

let applied = 0, skipped = 0;
for (const v of verifs) {
  if (v.verdict !== '善本底本误' || v.fixed) continue;
  const c = cmap[v.id];
  if (!c) { console.log(` ${v.id}：簇已不在（对校已变），跳过`); skipped++; continue; }
  const actual = (v.sbActual || '').trim();
  const replacement = (actual === '无' || actual === '未见') ? '' : actual;
  // 定位页：簇内善本页 > 邻近页 > 核验时实际用页（orphan 回路）
  const pg = c ? (c.sbPages[0] || c.sbPagesAround[Math.floor(c.sbPagesAround.length / 2)]) : null;
  const pgN = pg || v.sbPageUsed;
  const pgObj = v2.pages.find(x => x.n === pgN);
  if (!pgObj) { console.log(` ${v.id}：无善本页 ${pgN}，跳过`); skipped++; continue; }

  // orphan 整句补入：锚点为空前/后，改用核验时录得的「善本前邻 6 字」定位
  if (c && c.orphan) {
    const before6 = (v.sbBefore6 || '').trim();
    if (!before6 || before6 === '未见') { console.log(` ${v.id}：orphan 无前邻定位字，跳过——需人工`); skipped++; continue; }
    const bi = pgObj.text.indexOf(before6);
    if (bi < 0 || pgObj.text.indexOf(before6, bi + 1) >= 0) {
      console.log(` ${v.id}：前邻「${before6}」定位${bi < 0 ? '失败' : '不唯一'}（p${pgN}），跳过——需人工`); skipped++; continue;
    }
    if (!replacement) { console.log(` ${v.id}：orphan 实印为无，无可补`); skipped++; continue; }
    // 近邻守卫：插入点后 24 字内已含所补文字（归一比照，≤6 字短句才检）→ 底本本有、orphan 系对齐噪声，留人工
    const { normChar } = require('../src/align');
    const win = pgObj.text.slice(bi + before6.length, bi + before6.length + 24);
    const norm = s => [...s].map(normChar).join('');
    if (replacement.length <= 6 && norm(win).includes(norm(replacement))) {
      console.log(` ${v.id}：近邻已含「${replacement}」（orphan 疑为对齐噪声），跳过——需人工`); skipped++; continue;
    }
    if (!dry) pgObj.text = pgObj.text.slice(0, bi + before6.length) + replacement + pgObj.text.slice(bi + before6.length);
    console.log(` ${v.id} p${pgN}：「…${before6}」后补入【${replacement.slice(0, 20)}${replacement.length > 20 ? '…' : ''}】${dry ? '（dry）' : ''}`);
    log.push({ id: v.id, kind: c.kind, page: pgN, before: '…' + before6, wrong: '∅(脱句)', right: replacement, note: v.note || '', engine: v.engine, at: new Date().toISOString() });
    v.fixed = new Date().toISOString();
    applied++; continue;
  }

  const phrase = c.shanben || '';
  const before = c.anchor.sbBefore || '', after = c.anchor.sbAfter || '';
  const oldText = pgObj.text;
  const needle = before + phrase + after;
  let idx = oldText.indexOf(needle), mode = 'full';
  if (idx < 0 || oldText.indexOf(needle, idx + 1) >= 0) {
    // 回退规则：仅「删除衍文/废字」（replacement=''）允许短语定位——短语页内唯一且后锚紧随即可安全删除；
    // 插字/改字必须全锚命中（跨页或后锚不接者一律留人工，防错位替换）
    if (replacement === '' && phrase) {
      const pi = oldText.indexOf(phrase);
      const unique = pi >= 0 && oldText.indexOf(phrase, pi + 1) < 0;
      const afterOk = unique && oldText.slice(pi + phrase.length, pi + phrase.length + 3) === after.slice(0, 3);
      if (unique && afterOk) { idx = pi; mode = 'phrase-del'; }
    }
    if (mode === 'full') {
      console.log(` ${v.id}：锚点定位失败（p${pgN} 「${before}【${phrase}】${after}」），跳过——需人工`);
      skipped++; continue;
    }
  }
  if (mode === 'full') {
    pgObj.text = oldText.slice(0, idx) + before + replacement + after + oldText.slice(idx + needle.length);
  } else {
    pgObj.text = oldText.slice(0, idx) + oldText.slice(idx + phrase.length);
  }
  console.log(` ${v.id} p${pgN}：「${before}【${phrase || '∅'}】${after}」→「${before}【${replacement || '∅'}】${after}」${dry ? '（dry）' : ''}`);
  log.push({ id: v.id, kind: c.kind, page: pgN, before, wrong: phrase, right: replacement, note: v.note || '', engine: v.engine, at: new Date().toISOString() });
  v.fixed = new Date().toISOString();
  applied++;
}

if (!dry) {
  fs.writeFileSync(v2path, JSON.stringify(v2, null, 2));
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
  fs.writeFileSync(privatePath(workId, 'clusters-verify.json'), JSON.stringify(verifs, null, 2));
}
console.log(`${dry ? '[dry] ' : ''}回修 ${applied} 处，跳过 ${skipped} 处（累计修复记录 ${log.length} 条）`);
if (applied && !dry) console.log('→ 请重跑：node collation/run.js ' + workId + ' --step=diff && --step=verify && --step=officer && --step=export');
