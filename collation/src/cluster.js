/**
 * collation · P4.5 簇级核验（src/cluster.js）
 *
 * 字级 diff 把「注文措辞不同 / OCR 跳行 / 页眉残留」炸成几十条夺/衍单行。
 * 本模块把同段内相邻（间隔 ≤2 同字）的夺/衍归并为**短语级句簇**（原生自对齐段流），
 * 再逐簇核验定谳：
 *   规则类（书题/页眉/牌记残留）直接归类，不动视觉；
 *   其余渲染善本页 + 现代本页双图同呈，视觉如实照录两侧实印，四分类：
 *     现代OCR误（剔除留痕）/ 善本底本误（回修 shanben-v2 重跑对齐对校）/
 *     真异文（入册送校书官）/ 书题牌记（剔除留痕）
 *
 * 产物：input_data/<书>/_derived/collation/clusters.json（diff 步骤写）、
 * clusters-verify.json（verify 步骤写，增量保存断点续传；均为私有）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { loadConfig, INPUT_DATA } = require('./io');
const { loadVisionConfig, renderPage, callVision, getKey, pickJSON, getConf } = require('./vision');
const { privateWorkDir, privatePath, internalReadPath } = require('./paths');
const { loadM2Base } = require('./base');

const HEADER_WORDS = new Set(['大學', '中庸', '論語', '孟子', '朱熹章句', '·', '章句']);
const COLOPHON_PAGE = { '大学章句': 37 };   // 题跋牌记起始页（按书登记；未登记书无此规则）
const XD_APPARATUS = /原脱|原奪|未詳|去聲|入聲|平聲|上聲|叶音|一作|^○|校按|謹按/;  // 现代本自带校记/音注脚注

/** 夺/衍簇归并：自 diff 的对齐段流原生产出（字级异文不再含夺/衍） */
function clusterize(segments, gap = 2) {
  const clusters = [];
  let cid = 0;
  for (const seg of segments) {
    // orphan 段（现代本有、善本全无对应）→ 整段作一个夺簇
    if (seg.orphan) {
      clusters.push({
        id: `c${++cid}`, segId: seg.segId, kind: '夺', orphan: true,
        shanben: null, xiandai: seg.xiandai.raw,
        sbPages: [], sbPagesAround: [], xdPage: seg.xiandai.page,
        anchor: { sbBefore: '', sbAfter: '', xdBefore: '', xdAfter: '' },
        segXiandai: seg.xiandai.raw,
      });
      continue;
    }
    const det = seg.shanben.detail || [];
    const idx = [];
    for (let k = 0; k < det.length; k++) {
      if (det[k].type === '夺' || det[k].type === '衍') idx.push(k);
    }
    if (!idx.length) continue;
    let start = idx[0], prev = idx[0];
    const spans = [];
    for (let i = 1; i <= idx.length; i++) {
      if (i === idx.length || idx[i] - prev > gap + 1) {
        spans.push([start, prev]);
        if (i < idx.length) start = idx[i];
      }
      if (i < idx.length) prev = idx[i];
    }
    for (const [i, j] of spans) {
      const run = det.slice(i, j + 1);
      const sbPhrase = run.filter(x => x.sb).map(x => x.sb.ch).join('');
      const xdPhrase = run.filter(x => x.xd).map(x => x.xd.ch).join('');
      const sbPages = [...new Set(run.filter(x => x.sb).map(x => x.sb.page))].sort((a, b) => a - b);
      const CTX = 10;
      const before = det.slice(Math.max(0, i - CTX), i), after = det.slice(j + 1, j + 1 + CTX);
      clusters.push({
        id: `c${++cid}`, segId: seg.segId,
        kind: sbPhrase && xdPhrase ? '换' : (sbPhrase ? '衍' : '夺'),
        shanben: sbPhrase || null, xiandai: xdPhrase || null,
        sbPages,
        sbPagesAround: [...new Set([...before, ...after].filter(x => x.sb).map(x => x.sb.page))].sort((a, b) => a - b),
        xdPage: seg.xiandai.page,
        anchor: {
          sbBefore: before.filter(x => x.sb).map(x => x.sb.ch).join(''),
          sbAfter: after.filter(x => x.sb).map(x => x.sb.ch).join(''),
          xdBefore: before.filter(x => x.xd).map(x => x.xd.ch).join(''),
          xdAfter: after.filter(x => x.xd).map(x => x.xd.ch).join(''),
        },
        segXiandai: seg.xiandai.raw,
      });
    }
  }
  return clusters;
}

/** 规则预分类：书题/页眉残字、牌记题跋页、现代本校记/音注脚注 —— 不动视觉 */
function ruleClassify(c, workId) {
  const phrase = (c.shanben || c.xiandai || '').trim();
  if (HEADER_WORDS.has(phrase)) return { verdict: '书题牌记', note: `页眉书题残字「${phrase}」`, engine: 'rule', conf: 1 };
  if (c.orphan && XD_APPARATUS.test(phrase)) return { verdict: '现代校记', note: '现代本自带校勘/音注脚注，非正文', engine: 'rule', conf: 1 };
  const colophon = COLOPHON_PAGE[workId];
  if (colophon && c.sbPages.length && Math.min(...c.sbPages) >= colophon) {
    return { verdict: '牌记题跋', note: `善本 p${c.sbPages.join('/')} 属题跋牌记页`, engine: 'rule', conf: 1, deferred: true };
  }
  return null;
}

function verifyPrompt(c) {
  const sb = c.shanben || '∅', xd = c.xiandai || '∅';
  const a = c.anchor;
  const orphanAsk = c.orphan ? `
4. 该句为现代本整句、底本无对应——若在善本图中找到该句（或其对应文字），请给出善本图中**紧随其前的 6 个实印字**（供底本定位插入用）；找不到则答 "未见"。` : '';
  const orphanField = c.orphan ? ',"sbBefore6":"..."' : '';
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
   - "书题牌记"：属书题、页眉、鱼尾、牌记等非正文${orphanAsk}
仅输出 JSON：{"sbActual":"...","xdActual":"...","verdict":"...","conf":0.0,"note":"≤30字"${orphanField}}`;
}

function dataDir(workId) { return privateWorkDir(workId); }
function loadClusters(workId) {
  const p = internalReadPath(workId, 'clusters.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : [];
}
function loadVerifications(workId) {
  const p = internalReadPath(workId, 'clusters-verify.json');
  if (!fs.existsSync(p)) return [];
  const m2 = loadM2Base(workId);
  const rows = JSON.parse(fs.readFileSync(p, 'utf8'));
  // M2 换底本后，旧核验即使内容键相同也不能复用；无指纹的历史产物同样作废。
  return rows.filter(x => x.baseSha256 === m2.sha256);
}

/** 簇内容键（编号随对校漂移，内容不变则结论可迁；同键多簇按序消化） */
function clusterKey(c) { return [c.kind, c.shanben || '', c.xiandai || ''].join('|'); }

const RETRYABLE = new Set(['无法定位', '调用失败', '渲染失败', '解析失败']);

/**
 * 底本回修/对校变更后迁移核验结论：
 *   定论类（真异文/现代OCR误/书题牌记/牌记题跋/现代校记）内容键匹配 → 保留改挂新编号；
 *   善本底本误 → 已由 apply-basefix 回修（fixed 标记）的剔除（已入 basefix-log），未修的保留待处理；
 *   可重试类（无法定位/调用失败…）→ 剔除，由 verify 重核。
 */
function migrateVerifications(workId, newClusters) {
  const oldFile = internalReadPath(workId, 'clusters-verify.json');
  const file = privatePath(workId, 'clusters-verify.json');
  if (!fs.existsSync(oldFile)) return { kept: 0, dropped: 0 };
  const m2 = loadM2Base(workId);
  const oldRows = JSON.parse(fs.readFileSync(oldFile, 'utf8'));
  const old = oldRows.filter(x => x.baseSha256 === m2.sha256);
  fs.writeFileSync(file + '.bak', JSON.stringify(oldRows, null, 2));   // 迁移前备份（覆写是破坏性的）
  const pool = new Map();
  for (const c of newClusters) {
    const k = clusterKey(c);
    if (!pool.has(k)) pool.set(k, []);
    pool.get(k).push(c.id);
  }
  const kept = [];
  let dropped = 0;
  for (const v of old) {
    if (RETRYABLE.has(v.verdict)) { dropped++; continue; }
    if (v.verdict === '善本底本误' && v.fixed) { dropped++; continue; }
    const q = pool.get(clusterKey(v));
    if (q && q.length) { v.id = q.shift(); kept.push(v); }
    else dropped++;
  }
  fs.writeFileSync(file, JSON.stringify(kept, null, 2));
  return { kept: kept.length, dropped };
}

/** 簇级双侧视觉核验主入口：规则归类 + 视觉四分类。增量保存、断点续传。 */
async function verifyClusters(workId, opts = {}) {
  const m2 = loadM2Base(workId);
  const conc = opts.conc || 3;
  const onlySet = opts.only ? new Set(opts.only.split(',')) : null;
  const clusters = loadClusters(workId);
  const outFile = privatePath(workId, 'clusters-verify.json');
  const done = loadVerifications(workId);
  const doneIds = new Set(done.map(x => x.id));

  const { editions, works } = loadConfig();
  const work = works[workId];
  const sbPdfDir = path.join(INPUT_DATA, workId, editions[work.shanben].pdfDir);
  const xdPdfDir = path.join(INPUT_DATA, workId, editions[work.xiandai].pdfDir);
  const vcfg = loadVisionConfig();
  const threshold = vcfg.vision.threshold || 0.7;
  // 在受限执行器中 Node 不能创建 pdftoppm 子进程；可由外部预渲染 PNG，
  // 通过 COLLATION_SB_IMAGE_DIR / COLLATION_XD_IMAGE_DIR 注入两侧页图目录。
  const sbImageDir = process.env.COLLATION_SB_IMAGE_DIR || null;
  const xdImageDir = process.env.COLLATION_XD_IMAGE_DIR || null;
  const pdfOf = (dirP, n) => path.join(dirP, `page_${String(n).padStart(4, '0')}.pdf`);
  const pageCache = new Map();
  const render = (dirP, n) => {
    const k = dirP + ':' + n;
    if (!pageCache.has(k)) {
      const imageDir = dirP === sbPdfDir ? sbImageDir : xdImageDir;
      if (imageDir) {
        const file = path.join(imageDir, `page_${String(n).padStart(4, '0')}.png`);
        if (!fs.existsSync(file)) throw new Error(`预渲染页图不存在：${file}`);
        pageCache.set(k, fs.readFileSync(file).toString('base64'));
      } else {
        pageCache.set(k, renderPage(pdfOf(dirP, n), 1, vcfg.vision.render?.dpi || vcfg.vision.dpi || 150).b64);
      }
    }
    return pageCache.get(k);
  };

  async function verifyOne(c) {
    const rule = ruleClassify(c, workId);
    if (rule) return { id: c.id, ...rule };
    let sbPage = c.sbPages[0] || c.sbPagesAround[Math.floor(c.sbPagesAround.length / 2)];
    if (!sbPage) {
      // orphan 段无善本溯源页：借 segId 最近邻簇的页码（善本翻页缓，邻段多在同/邻叶）
      let best = null, bestD = 1e9;
      for (const o of clusters) {
        const p = o.sbPages[0] || o.sbPagesAround[Math.floor((o.sbPagesAround || []).length / 2)];
        if (p == null) continue;
        const d = Math.abs((o.segId || 0) - (c.segId || 0));
        if (d < bestD) { bestD = d; best = p; }
      }
      sbPage = best;
    }
    if (!sbPage || !c.xdPage) return { id: c.id, verdict: '无法定位', engine: 'rule', conf: 0, note: '缺页码' };
    let sbB64, xdB64;
    try {
      sbB64 = render(sbPdfDir, sbPage);
      xdB64 = render(xdPdfDir, c.xdPage);
    } catch (e) { return { id: c.id, verdict: '渲染失败', engine: '-', err: e.message }; }
    const p = verifyPrompt(c), models = vcfg.vision.models;
    // 视觉模型可按批次临时降级为更快的兼容模型（例如 qwen-turbo），
    // 不改配置文件、不影响默认初校/覆校角色语义。
    const firstModel = process.env.DASHSCOPE_VISION_MODEL || models.first;
    const deepModel = process.env.DASHSCOPE_VISION_DEEP_MODEL || models.deep;
    let r;
    try {
      r = await callVision(firstModel, [sbB64, xdB64], p, getKey(vcfg), vcfg.vision.endpoint, true);
    } catch (e) { return { id: c.id, verdict: '调用失败', engine: `初校(${firstModel})`, err: String(e.message || e), retryable: true }; }
    if (r.err) return { id: c.id, verdict: '调用失败', engine: `初校(${firstModel})`, err: r.err, retryable: true };
    let obj = pickJSON(r.text), conf = getConf(obj);
    if (obj && typeof conf === 'number' && conf >= threshold) return { id: c.id, ...obj, conf, engine: `初校(${models.first})`, sbPageUsed: sbPage };
    try {
      r = await callVision(deepModel, [sbB64, xdB64], p, getKey(vcfg), vcfg.vision.endpoint, true);
    } catch (e) { return { id: c.id, verdict: '调用失败', engine: `覆校(${deepModel})`, err: String(e.message || e), retryable: true }; }
    if (r.err) return { id: c.id, verdict: '调用失败', engine: `覆校(${deepModel})`, err: r.err, retryable: true };
    obj = pickJSON(r.text); conf = getConf(obj);
    return { id: c.id, ...(obj || { verdict: '解析失败' }), conf, engine: `覆校(${models.deep})`, sbPageUsed: sbPage, note: (obj && obj.note ? obj.note + '；' : '') + '初校置信低，升级覆校' };
  }

  const todo = clusters.filter(c => !doneIds.has(c.id) && (!onlySet || onlySet.has(c.id)));
  if (opts.onProgress) opts.onProgress(0, todo.length, null);
  let i = 0, n = 0;
  async function worker() {
    while (i < todo.length) {
      const c = todo[i++];
      const r = await verifyOne(c);
      done.push({ ...r, baseSha256: m2.sha256, kind: c.kind, shanben: c.shanben, xiandai: c.xiandai, sbPages: c.sbPages, xdPage: c.xdPage, segXiandai: c.segXiandai });
      fs.writeFileSync(outFile, JSON.stringify(done, null, 2));
      n++;
      if (opts.onProgress) opts.onProgress(n, todo.length, { c, r });
    }
  }
  await Promise.all(Array.from({ length: Math.min(conc, todo.length) }, worker));
  const stat = {};
  for (const x of done) stat[x.verdict] = (stat[x.verdict] || 0) + 1;
  return { total: done.length, stat };
}

module.exports = { clusterize, ruleClassify, verifyClusters, loadClusters, loadVerifications, migrateVerifications, clusterKey, HEADER_WORDS };
