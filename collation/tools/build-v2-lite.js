#!/usr/bin/env node
/**
 * collation · M2 lite 底本直构（tools/build-v2-lite.js）——分卷书 G 管线轻量通道
 * 不跑旧管线 M2 重轨道（recollate→build-v2→verify-v2），直接从当涂郡本_ocr md
 * 构造 shanben-v2 同 schema 底本（pages[{n,text}]）：G1 指纹基准 + G2a 参校两用。
 *
 * 剥除（全部留痕入 stats.stripped）：
 *   - 扉页行：「宋本論語集注卷X」（影印丛书各卷扉页，非底本文字）
 *   - OCR 幻觉行：「欽定四庫全書」（2026-08-18 实证 2 处，影像无此字样）
 *   - markdown 标记：# 前缀、![](...) 图片占位行（OCR 失败页）
 *
 * 用法: node collation/tools/build-v2-lite.js <书名> [--pages=10-48] [--write]
 *   默认 dry-run 只打印报告；--write 落盘 collation/data/<书>/shanben-v2.json
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { listPages, loadConfig, inputBookOf } = require('../src/io');

const args = process.argv.slice(2);
const flags = {}, pos = [];
for (const a of args) { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) flags[m[1]] = m[2] ?? true; else pos.push(a); }
const workId = pos[0];
if (!workId) { console.error('用法: node collation/tools/build-v2-lite.js <书名> [--pages=10-48] [--write]'); process.exit(1); }

const cfg = loadConfig();
const work = cfg.works[workId];
if (!work) { console.error(`未登记作品: ${workId}（见 collation/config/editions.yaml）`); process.exit(1); }
const ocrDir = cfg.editions[work.shanben].ocrDir;
const bookDir = inputBookOf(workId);

let lo = 0, hi = Infinity;
if (flags.pages) { const [a, b] = String(flags.pages).split('-').map(Number); lo = a; hi = b || a; }

const pages = listPages(bookDir, ocrDir).filter(p => p.n >= lo && p.n <= hi);
if (!pages.length) { console.error(`页范围为空：--pages=${flags.pages}`); process.exit(1); }

// ── 剥行规则（test 在已剥 markdown # 前缀的行上执行，留痕） ──
const STRIP_RULES = [
  { kind: '扉页', test: l => /^宋本[^，。\s]{0,12}$/.test(l) },
  { kind: '幻觉行', test: l => /^欽定四庫全書$/.test(l) },
  { kind: '图片占位', test: l => /^!\[.*\]\(.*\)$/.test(l) },
];
const strippedCnt = {};
const outPages = [];
for (const p of pages) {
  const lines = fs.readFileSync(p.path, 'utf8').split(/\r?\n/).map(s => s.trim());
  const kept = [];
  for (const raw of lines) {
    if (!raw) continue;
    let line = raw.replace(/^#+\s*/, ''); // markdown 标题前缀剥除（正文无标题语法）
    const rule = STRIP_RULES.find(r => r.test(line));
    if (rule) { strippedCnt[rule.kind] = (strippedCnt[rule.kind] || 0) + 1; continue; }
    kept.push(line);
  }
  outPages.push({ n: p.n, text: kept.join(''), vol: p.vol || null });
}

const totalChars = outPages.reduce((s, p) => s + [...p.text].length, 0);
const emptyPages = outPages.filter(p => !p.text).map(p => p.n);

const data = {
  work: workId,
  source: 'build-v2-lite（当涂郡本_ocr 直构，非互证仲裁）',
  stats: {
    pages: outPages.length,
    chars: totalChars,
    stripped: strippedCnt,
    emptyPages,
    volSpan: pages.length ? `${pages[0].n}-${pages[pages.length - 1].n}` : null,
  },
  pages: outPages.map(p => ({ n: p.n, text: p.text })),
};

console.log(`═══ ${workId} · build-v2-lite ═══`);
console.log(`页范围: ${data.stats.volSpan}（${outPages.length} 页，含卷 ${[...new Set(pages.map(p => p.vol).filter(Boolean))].join('/') || '平铺'}）`);
console.log(`字符数: ${totalChars.toLocaleString()}（均值 ${Math.round(totalChars / outPages.length)}/页）`);
console.log(`剥除留痕: ${JSON.stringify(strippedCnt) || '无'}`);
if (emptyPages.length) console.log(`⚠ 空页（OCR 无文字输出）: ${emptyPages.join(',')} —— G2a 将记整页 missing，需影像核验`);

const outPath = path.join(__dirname, '..', 'data', workId, 'shanben-v2.json');
if (flags.write) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  // pending-verify 空数组（base.js loadM2Base 读取兼容）
  const pendingPath = path.join(path.dirname(outPath), 'pending-verify.json');
  if (!fs.existsSync(pendingPath)) fs.writeFileSync(pendingPath, '[]');
  console.log(`\n✓ 写入 ${outPath}`);
} else {
  console.log(`\n（dry-run，加 --write 写入 ${outPath}）`);
}
