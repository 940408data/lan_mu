/**
 * collation · P2.5 视觉复核（src/reconfirm.js）
 * 对善本「ocr疑/疑异/真异文」异文，渲染善本扫描对应页 → 视觉模型读图确认善本实印何字。
 *   - 初校(qwen3.7-plus) 先判；conf<阈值自动升覆校(qwen3.8-max)。
 *   - 视觉实字 ≠ OCR → 判 OCR 误读，消解异文（以善本实字为准）。
 *   - 无 key → deferred 转人工。
 *
 * 注意：无字级 bbox（善本 OCR 为 flat md），给整页 + 上下文让视觉定位该字；
 *      页图按页缓存，同页多条异文共享一次渲染/调用前的图。
 */
'use strict';
const path = require('path');
const { INPUT_DATA, loadWork } = require('./io');
const { renderPage, verifyChar } = require('./vision');

function pad(n) { return String(n).padStart(4, '0'); }

/** 从 variant 提取善本页码（pos 形如 "page:line" 或 page 数字） */
function shanbenPage(v) {
  if (v.pos != null) { const m = String(v.pos).match(/^(\d+)/); if (m) return parseInt(m[1], 10); }
  return null;
}

/**
 * 视觉复核主入口。
 * @param variants  待复核异文数组（原地加 reconfirm 字段）
 * @param workId    书名
 * @param opts      { limit: 最多复核条数(成本闸), types: 复核的类型集合 }
 */
async function reconfirm(variants, workId, opts = {}) {
  const types = opts.types || ['ocr疑', '真异文'];
  const limit = opts.limit || 0;  // 0 = 不限
  const { shanben } = loadWork(workId);
  const pdfDir = path.join(INPUT_DATA, workId, shanben.pdfDir || '当涂郡本_pdf');
  const targets = variants.filter(v => types.includes(v.type) && v.shanben);
  const pageCache = {};  // pageN → b64
  let done = 0, deferred = 0;

  for (const v of targets) {
    if (limit && done >= limit) { v.reconfirm = { status: 'skipped', reason: '超 limit 成本闸' }; continue; }
    const pg = shanbenPage(v);
    if (pg == null) { v.reconfirm = { status: 'deferred', reason: '无善本页定位' }; deferred++; continue; }
    try {
      if (!pageCache[pg]) pageCache[pg] = renderPage(path.join(pdfDir, `page_${pad(pg)}.pdf`), 1).b64;
      const ctx = v.ctx || (v.seg && (typeof v.seg === 'string' ? v.seg : v.seg.xiandai)) || '';
      const r = await verifyChar(pageCache[pg], ctx.slice(0, 40), v.shanben, v.xiandai);
      if (r.deferred) { v.reconfirm = { status: 'deferred', reason: r.reason }; deferred++; continue; }
      if (r.err) { v.reconfirm = { status: 'error', reason: r.err }; continue; }
      const realChar = r.obj && r.obj.char;
      const agreeOCR = realChar && realChar === v.shanben;   // 视觉实字 == OCR → OCR 无误
      v.reconfirm = {
        status: 'done', char: realChar, conf: r.conf, engine: r.engine, role: r.role,
        note: r.obj && r.obj.note,
        agreeOCR,                                     // true=OCR正确, false=OCR误读(以实字为准)
        verdict: realChar == null ? 'unknown' : (agreeOCR ? 'ocr正确' : (realChar === v.xiandai ? 'ocr误读·应作现代本字' : 'ocr误读·善本实为它字')),
      };
      done++;
    } catch (e) {
      v.reconfirm = { status: 'error', reason: String(e.message || e) };
    }
  }
  return { variants, summary: { target: targets.length, done, deferred } };
}

module.exports = { reconfirm, shanbenPage };
