/** 卷影管線：從四時四部手卷整卷 PNG 右緣裁 560px×全高豎條 → dist/assets/topics/<id>.jpg。
 *  原料：dist/works/<id>/<Base>-<Tag>.png（選主字面那份，即 export.faces 首鍵對應 tag）。
 *  接線：build.js buildSitePages 內（寫站點頁之前）調用；缺源 PNG → 告警跳過不報錯。
 *  依賴：pngjs / jpeg-js 均為 image.js 現有依賴，無新增。 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');

const STRIP_W = 560;       // 裁切寬度（像素，源 PNG 原始尺寸）
const JPEG_Q = 88;         // 輸出 jpeg quality

/* 四時四部手卷：id → { base, tag }，tag 取主字面（export.faces 首鍵之值）。
 *  四部 meta.yaml 主字面均為 song → tag = 'Song'。若日後某作主字面變，改此表。 */
const SCROLLS = {
  lanting:     { base: 'Lanting-Scroll',     tag: 'Song' },
  dushanjing:  { base: 'Dushanjing-Scroll',  tag: 'Song' },
  chibifu:     { base: 'Chibifu-Scroll',     tag: 'Song' },
  huxinting:   { base: 'Huxinting-Scroll',   tag: 'Song' },
};

/** 自源 PNG 右緣裁 STRIP_W×全高 → 寫 jpg。返回产物绝对路径，缺源返回 null。 */
function cropOne(srcPng, outJpg) {
  if (!fs.existsSync(srcPng)) return null;
  const buf = fs.readFileSync(srcPng);
  let src;
  try { src = PNG.sync.read(buf); } catch (e) { return null; }
  const w = Math.min(STRIP_W, src.width);
  const x0 = Math.max(0, src.width - STRIP_W); // 右緣
  const dst = new PNG({ width: w, height: src.height });
  PNG.bitblt(src, dst, x0, 0, w, src.height, 0, 0);
  const raw = { data: Buffer.from(dst.data), width: w, height: src.height };
  const jpg = jpeg.encode(raw, JPEG_Q);
  fs.mkdirSync(path.dirname(outJpg), { recursive: true });
  fs.writeFileSync(outJpg, jpg.data);
  return outJpg;
}

/** 構建期調用：對 TOPICS[0].books（四時四部）各產一卷影。返回 { id: absPath } 字典。
 *  @param {string} distRoot dist 根目錄
 *  @param {string[]} bookIds 四時專題的 book id 列表 */
function buildPanels(distRoot, bookIds) {
  const results = {};
  const missing = [];
  for (const id of bookIds) {
    const spec = SCROLLS[id];
    if (!spec) { missing.push(`${id}: 未配置 SCROLLS`); continue; }
    const srcPng = path.join(distRoot, 'works', id, `${spec.base}-${spec.tag}.png`);
    const outJpg = path.join(distRoot, 'assets', 'topics', `${id}.jpg`);
    const got = cropOne(srcPng, outJpg);
    if (got) results[id] = got;
    else missing.push(`${id}: 缺源 ${srcPng}`);
  }
  for (const m of missing) console.warn(`  [卷影] ${m}`);
  const n = Object.keys(results).length;
  if (n) console.log(`  卷影: ${n}/${bookIds.length} 張 → dist/assets/topics/`);
  return results;
}

module.exports = { buildPanels, SCROLLS, STRIP_W };
