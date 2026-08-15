#!/usr/bin/env node
/**
 * collation · tools/verify-clusters.js — 夺/衍句簇双侧视觉核验
 *
 * 对 cluster-dy.js 归并的句簇逐簇核验：
 *   规则类（书题/页眉/牌记残留）直接归类，不动用视觉；
 *   其余簇渲染善本页 + 现代本页双图，一次视觉调用如实照录两侧实印，归类：
 *     现代OCR误 / 善本底本误 / 真异文 / 书题牌记
 *   初校（qwen3.7-plus）先判，conf<阈值升级覆校（qwen3.8-max）。开思考。
 *
 * 增量保存 data/<书>/clusters-verify.json，断点续传。
 *
 * 用法: node collation/tools/verify-clusters.js <书> [--conc=3] [--only=c1,c7]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { loadConfig, INPUT_DATA } = require('../src/io');
const { loadVisionConfig, renderPage, callVision, getKey, pickJSON, getConf } = require('../src/vision');

const workId = process.argv[2];
if (!workId) { console.error('用法: node collation/tools/verify-clusters.js <书> [--conc=3] [--only=c1,c7]'); process.exit(1); }
const conc = +((process.argv.find(a => a.startsWith('--conc=')) || '').split('=')[1] || 3);
const only = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1];
const onlySet = only ? new Set(only.split(',')) : null;

const HEADER_WORDS = new Set(['大學', '中庸', '論語', '孟子', '朱熹章句', '·', '章句']);
const COLOPHON_PAGE = 37; // 当涂郡本题跋牌记起始页（大学；他书按实调整）

const dir = path.join(__dirname, '..', 'data', workId);
const clusters = JSON.parse(fs.readFileSync(path.join(dir, 'clusters.json'), 'utf8'));
const outFile = path.join(dir, 'clusters-verify.json');
const done = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : [];
const doneIds = new Set(done.map(x => x.id));

const { editions, works } = loadConfig();
const work = works[workId];
const sbPdfDir = path.join(INPUT_DATA, workId, editions[work.shanben].pdfDir);
const xdPdfDir = path.join(INPUT_DATA, workId, editions[work.xiandai].pdfDir);
const vcfg = loadVisionConfig();
const threshold = vcfg.vision.threshold || 0.7;

function pdfOf(dirP, n) { return path.join(dirP, `page_${String(n).padStart(4, '0')}.pdf`); }

/** 规则预分类：书题/页眉残字、牌记题跋页 —— 不动视觉 */
function ruleClassify(c) {
  const phrase = (c.shanben || c.xiandai || '').trim();
  if (HEADER_WORDS.has(phrase)) return { verdict: '书题牌记', note: `页眉书题残字「${phrase}」`, engine: 'rule' };
  if (c.sbPages.length && Math.min(...c.sbPages) >= COLOPHON_PAGE) return { verdict: '牌记题跋', note: `善本 p${c.sbPages.join('/')} 属题跋牌记页`, engine: 'rule', deferred: true };
  return null;
}

function prompt(c) {
  const sb = c.shanben || '∅', xd = c.xiandai || '∅';
  const a = c.anchor;
  return `你在核验古籍对校中的一处「${c.kind}」疑团。图一：善本（当涂郡斋刊递修本）原叶扫描。图二：现代点校本（儒藏本）书页。

现代本 OCR 此处作：「${a.xdBefore}【${xd}】${a.xdAfter}」
善本校勘底本此处作：「${a.sbBefore}【${sb}】${a.sbAfter}」
（【】内为两本相异之处，∅ 表示此处无字；锚点文字供定位）

任务：按前后文锚点在两图中各自定位此处，如实照录实印文字——不得凭文意猜字、不得增删：
1. 善本图中该位置实印何字？（【】处逐字照录；若两锚字之间确实无字答 "无"；找不到该位置答 "未见"）
2. 现代本图中该位置实印何字？（同上）
3. 归类其一：
   - "现代OCR误"：现代本实印与善本相同，或现代本实印有字而 OCR 漏/误
   - "善本底本误"：善本实印与现代本相同，是善本 OCR/底本漏/误
   - "真异文"：两图实印确实不同（善本真夺/真衍/措辞真异）
   - "书题牌记"：属书题、页眉、鱼尾、牌记等非正文
仅输出 JSON：{"sbActual":"...","xdActual":"...","verdict":"...","conf":0.0,"note":"≤30字"}`;
}

async function verifyOne(c) {
  const rule = ruleClassify(c);
  if (rule) return { id: c.id, ...rule, conf: 1 };

  const sbPage = c.sbPages[0] || c.sbPagesAround[Math.floor(c.sbPagesAround.length / 2)];
  if (!sbPage || !c.xdPage) return { id: c.id, verdict: '无法定位', engine: 'rule', conf: 0, note: '缺页码' };
  let sbB64, xdB64;
  try {
    sbB64 = renderPage(pdfOf(sbPdfDir, sbPage), 1, vcfg.vision.dpi || 150).b64;
    xdB64 = renderPage(pdfOf(xdPdfDir, c.xdPage), 1, vcfg.vision.dpi || 150).b64;
  } catch (e) {
    return { id: c.id, verdict: '渲染失败', engine: '-', err: e.message };
  }
  const p = prompt(c), key = () => getKey(vcfg);
  const models = vcfg.vision.models;
  // 初校
  let r = await callVision(models.first, [sbB64, xdB64], p, key(), vcfg.vision.endpoint, true);
  if (r.err) return { id: c.id, verdict: '调用失败', engine: `初校(${models.first})`, err: r.err };
  let obj = pickJSON(r.text), conf = getConf(obj);
  if (obj && typeof conf === 'number' && conf >= threshold) {
    return { id: c.id, ...obj, conf, engine: `初校(${models.first})` };
  }
  // 覆校
  r = await callVision(models.deep, [sbB64, xdB64], p, key(), vcfg.vision.endpoint, true);
  if (r.err) return { id: c.id, verdict: '调用失败', engine: `覆校(${models.deep})`, err: r.err };
  obj = pickJSON(r.text); conf = getConf(obj);
  return { id: c.id, ...(obj || { verdict: '解析失败' }), conf, engine: `覆校(${models.deep})`, note: (obj && obj.note ? obj.note + '；' : '') + '初校置信低，升级覆校' };
}

function save() { fs.writeFileSync(outFile, JSON.stringify(done, null, 2)); }

(async () => {
  const todo = clusters.filter(c => !doneIds.has(c.id) && (!onlySet || onlySet.has(c.id)));
  console.log(`${workId} 句簇共 ${clusters.length}，已完成 ${done.length}，本次待核 ${todo.length}`);
  let i = 0;
  async function worker() {
    while (i < todo.length) {
      const c = todo[i++];
      const r = await verifyOne(c);
      done.push({ ...r, kind: c.kind, shanben: c.shanben, xiandai: c.xiandai, sbPages: c.sbPages, xdPage: c.xdPage });
      save();
      console.log(` ${c.id} ${c.kind} 善「${(c.shanben || '∅').slice(0, 12)}」今「${(c.xiandai || '∅').slice(0, 12)}」→ ${r.verdict}（${r.engine}${typeof r.conf === 'number' ? ' ' + r.conf.toFixed(2) : ''}）${r.note ? ' | ' + r.note : ''}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(conc, todo.length) }, worker));
  const stat = {};
  for (const x of done) stat[x.verdict] = (stat[x.verdict] || 0) + 1;
  console.log('核验完成:', stat);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
