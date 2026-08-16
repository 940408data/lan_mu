#!/usr/bin/env node
/**
 * collation · M3 备援：经注投影判定（tools/project-jz.js）
 * 适用：版面**真正无经注空间区分**的刻本（经注同顶格又同退格，顶格/退格规则全失效）。
 * ⚠️「经注同大字」≠「无空间区分」：若经顶格、注退格（layout.zhuStart≠顶格），退格规则有效，
 *    应走 judge-grid（顶格=j/退格=z），勿用本工具 LCS 投影。LCS 在「注引经」时会把经文误判注、
 *    序文/朱熹总论误判经——中庸晋府本即曾误用，经文「天命之谓性」被判注、序被判经，已回退 judge-grid。
 *    仅当经注同顶格又同退格、版面规则确全失效时方为正当（且须 layout 可验 + 人工确认）。
 * 原理：以既有 works 的经注结构为语料，对 grid.json 每列文字做归一化 LCS 覆盖率比对，
 *       列文字落入经文语料者多 → j，落入注文语料者多 → z；覆写 grid.json 的 type（保留实测 start）。
 * 注意：此法依赖既有结构（非独立视觉判定），校勘记/文档须注明；LCS 覆盖率对「注引经」易误判，慎用。
 *       默认 dry-run，--write 方写入 grid.json。
 *
 * 用法: node collation/tools/project-jz.js <书名> --works=<既有作品id> [--write] [--force]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { normChar } = require('../src/align');

const args = process.argv.slice(2);
const flags = {}, pos = [];
for (const a of args) { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) flags[m[1]] = m[2] ?? true; else pos.push(a); }
const workId = pos[0], worksId = flags.works;
if (!workId || !worksId) { console.error('用法：node collation/tools/project-jz.js <书名> --works=<既有作品id> [--write] [--force]'); process.exit(1); }

// 触发判断：版面有经注退格区分（zhuStart≠顶格）则退格规则有效，应走 judge-grid，拒绝 LCS 投影防误用
const layoutPath = path.join(__dirname, '..', 'data', workId, 'layout.json');
if (fs.existsSync(layoutPath)) {
  const L = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));
  const hasIndent = L.zhuStart && L.zhuStart !== '顶格' && L.zhuStart !== '頂格';
  if (hasIndent) {
    console.error(`✗ 版面有经注退格区分（jingStart=${L.jingStart} / zhuStart=${L.zhuStart}），退格规则有效。\n  应走 judge-grid（顶格=j/退格=z）；LCS 投影会在「注引经」时把经文误判注、序文/总论误判经。\n  如确属经注同顶格又同退格、规则全失效，加 --force 强制。`);
    if (!flags.force) process.exit(1);
    console.error('  ⚠ --force 强制 LCS 投影，自负其责。');
  }
}

const gridPath = path.join(__dirname, '..', 'data', workId, 'grid.json');
const grid = JSON.parse(fs.readFileSync(gridPath, 'utf8'));
const textYaml = YAML.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'works', worksId, 'text.yaml'), 'utf8'));
let jCorpus = '', zCorpus = '';
for (const sec of textYaml.sections || []) for (const b of sec.blocks || []) {
  const t = [...(b.text || '')].map(normChar).join('');
  if (b.type === 'j') jCorpus += t; else zCorpus += t;
}

function lcs(a, b) {
  if (!a || !b) return 0;
  const dp = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const t = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = t;
    }
  }
  return dp[b.length];
}

let j = 0, z = 0, tie = 0;
const rows = [];
for (const pg of grid.pages) for (const c of pg.cols) {
  const t = [...(c.text || '')].map(normChar).join('');
  if (!t) continue;
  const sj = lcs(t, jCorpus) / t.length, sz = lcs(t, zCorpus) / t.length;
  const type = sj === sz ? (c.type || 'z') : (sj > sz ? 'j' : 'z');
  if (sj === sz) tie++;
  rows.push({ page: pg.n, col: c.col, len: t.length, sj: +sj.toFixed(2), sz: +sz.toFixed(2), from: c.type, to: type });
  if (flags.write) c.type = type;
  type === 'j' ? j++ : z++;
}
if (flags.write) {
  grid.method = `投影判定（project-jz）：以 works/${worksId} 结构语料 LCS 投影；start 保留版面实测`;
  fs.writeFileSync(gridPath, JSON.stringify(grid, null, 2));
}
const changed = rows.filter(r => r.from !== r.to).length;
console.log(`投影判定：${rows.length} 列 → 经 ${j} / 注 ${z}（改判 ${changed}，持平保原判 ${tie}）${flags.write ? '【已写入 grid.json】' : '【dry-run】'}`);
for (const r of rows.filter(r => r.sj < 0.6 && r.sz < 0.6).slice(0, 10)) {
  console.log(`  低覆盖 p${r.page}列${r.col} j=${r.sj} z=${r.sz}（可能为题跋/序文，语料外）`);
}
