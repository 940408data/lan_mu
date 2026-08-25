/** 站點聚合：works/ → 書級視圖（供首頁「藏書」與書目頁「目錄葉」生成）。
 *  歸屬依據各卷 meta.book 塊（id/title/order/entry）；無 book 者視為單卷書，首頁直達作品頁。 */
const fs = require('fs');
const path = require('path');
const { listWorks, loadMeta, ROOT } = require('../core/load');
const { BOOK_META } = require('./home');

/* 部類次序（經子書禮樂；未列入者殿後，按 id 字典序） */
const CAT_ORDER = ['經', '子', '書', '禮樂'];
/* 部內書序：四書之序（學庸論孟）；未列入者按 id 字典序 */
const BOOK_ORDER = ['daxue', 'zhongyong', 'lunyu', 'mengzi'];

const DIG = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
/** 中文數碼（卷次/葉次可逾十） */
function numCn(n) {
  if (n <= 0) return '';
  if (n < 10) return DIG[n];
  if (n < 20) return '十' + (n % 10 ? DIG[n % 10] : '');
  if (n < 100) return DIG[Math.floor(n / 10)] + '十' + (n % 10 ? DIG[n % 10] : '');
  if (n < 1000) {
    const b = Math.floor(n / 100), r = n % 100;
    const head = (b === 1 ? '一' : DIG[b]) + '百';
    if (r === 0) return head;
    if (r < 10) return head + '零' + DIG[r];
    if (r < 20) return head + '一十' + (r % 10 ? DIG[r % 10] : '');
    return head + DIG[Math.floor(r / 10)] + '十' + (r % 10 ? DIG[r % 10] : '');
  }
  if (n < 10000) {
    const q = Math.floor(n / 1000), r = n % 1000;
    const head = (q === 1 ? '一' : DIG[q]) + '千';
    if (r === 0) return head;
    if (r < 100) return head + '零' + (r < 10 ? DIG[r] : DIG[Math.floor(r / 10)] + '十' + (r % 10 ? DIG[r % 10] : ''));
    return head + numCn(r);
  }
  return String(n);
}

/**
 * @returns {{books:Array, warnings:string[], catOrder:string[]}}
 * book: {id,title,category,caption,href,draft,standalone?,layout?,gong?,volumes:[{workId,title,order,entry,draft,href,gong}]}
 */
/* mtime 指紋失效快取：命中時零 parse（僅 stat 全部 meta.yaml）；改 meta/增刪作品自動失效。
 * 增量解析：逐文件記錄 mtime，指紋失效時僅重 parse 變更的 meta.yaml（dev 改一文件秒刷）。 */
let _cache = { fp: null, result: null };
const _metaCache = new Map(); // workId -> { mtimeMs, w }
function loadMetaIncr(workId) {
  const fp = path.join(ROOT, 'works', workId, 'meta.yaml');
  const mt = fs.statSync(fp).mtimeMs;
  const hit = _metaCache.get(workId);
  if (hit && hit.mtimeMs === mt) return hit.w;
  const w = loadMeta(workId);
  _metaCache.set(workId, { mtimeMs: mt, w });
  return w;
}
function fingerprint() {
  const ids = listWorks();
  const mt = ids.map((id) => fs.statSync(path.join(ROOT, 'works', id, 'meta.yaml')).mtimeMs);
  return ids.length + ':' + ids.join(',') + '|' + mt.join(',');
}
function aggregateSite() {
  const fp = fingerprint();
  if (_cache.fp === fp) return _cache.result;
  const warnings = [];
  const byBook = new Map();
  for (const workId of listWorks()) {
    let w;
    try { w = loadMetaIncr(workId); } catch (e) { warnings.push(`裝載失敗 ${workId}: ${e.message}`); continue; }
    if (!w.hasSrc) warnings.push(`作品 ${workId} 缺數據源（text.yaml 或 grid.yaml 至少其一）`);
    const m = w.meta || {};
    const draft = m.stage === 'draft';
    const bk = m.book;
    if (!bk || !bk.id) {
      // 單卷書（手卷等）：首頁直達作品頁
      byBook.set(workId, {
        id: workId, title: m.title || workId, category: m.category || '',
        standalone: true, layout: m.layout, draft,
        href: `/works/${workId}/index.html`,
        caption: m.layout === 'scroll' ? '手卷單幅' : '單卷',
        volumes: [{ workId, title: m.title, order: 1, draft, href: `/works/${workId}/index.html`, entry: null }],
      });
      continue;
    }
    let b = byBook.get(bk.id);
    if (!b) {
      b = { id: bk.id, title: bk.title || workId, category: m.category || '', volumes: [] };
      byBook.set(bk.id, b);
    } else if (bk.title && b.title !== bk.title) {
      warnings.push(`書「${bk.id}」卷 ${workId} 書名不一致：${bk.title} ≠ ${b.title}`);
    }
    b.volumes.push({
      workId, title: m.title, order: typeof bk.order === 'number' ? bk.order : 999,
      entry: bk.entry || null, draft, href: `/works/${workId}/index.html`,
      gong: (m.songke && m.songke.gong) || [],
    });
    if (!bk.entry) warnings.push(`卷 ${workId} 缺 book.entry，目錄大字列以卷題代`);
  }

  const books = [];
  for (const b of byBook.values()) {
    b.volumes.sort((x, y) => x.order - y.order || x.workId.localeCompare(y.workId));
    const seen = new Set();
    for (const v of b.volumes) {
      const k = String(v.order);
      if (seen.has(k)) warnings.push(`書「${b.id}」卷次重複：${v.order}（${v.workId}）`);
      seen.add(k);
    }
    b.draft = b.volumes.every((v) => v.draft); // 全帙皆 draft 方於首頁標「需點校」
    if (!b.standalone) {
      const zheng = b.volumes.filter((v) => v.order >= 1).length;
      const hasXu = b.volumes.some((v) => v.order < 1);
      b.caption = (zheng === 1 ? '單卷' : `凡${numCn(zheng)}卷`) + (hasXu ? '並序' : '');
      b.href = `/books/${b.id}/index.html`;
      b.gong = (b.volumes.find((v) => v.gong && v.gong.length) || {}).gong || [];
    }
    const bm = Object.assign({ collation: 'AI整理' }, BOOK_META[b.id] || {});
    b.collation = bm.collation;
    if (bm.diben) b.diben = bm.diben;
    if (bm.netdisk) b.netdisk = bm.netdisk;
    books.push(b);
  }
  const catIx = (c) => { const i = CAT_ORDER.indexOf(c); return i < 0 ? CAT_ORDER.length : i; };
  const bkIx = (id) => { const i = BOOK_ORDER.indexOf(id); return i < 0 ? 999 : i; };
  books.sort((a, b) => catIx(a.category) - catIx(b.category) || bkIx(a.id) - bkIx(b.id) || a.id.localeCompare(b.id));
  _cache = { fp, result: { books, warnings, catOrder: CAT_ORDER } };
  return _cache.result;
}

module.exports = { aggregateSite, numCn };
