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

/** 自源 PNG 裁卷首文字區 STRIP_W×全高 → 寫 jpg。返回产物绝对路径，缺源返回 null。 */
function cropOne(srcPng, outJpg) {
  if (!fs.existsSync(srcPng)) return null;
  const buf = fs.readFileSync(srcPng);
  let src;
  try { src = PNG.sync.read(buf); } catch (e) { return null; }
  const w = Math.min(STRIP_W, src.width);
  const x1 = textRightEdge(src);
  const x0 = Math.max(0, Math.min(x1, src.width) - STRIP_W);
  const dst = new PNG({ width: w, height: src.height });
  PNG.bitblt(src, dst, x0, 0, w, src.height, 0, 0);
  const raw = { data: Buffer.from(dst.data), width: w, height: src.height };
  const jpg = jpeg.encode(raw, JPEG_Q);
  fs.mkdirSync(path.dirname(outJpg), { recursive: true });
  fs.writeFileSync(outJpg, jpg.data);
  return outJpg;
}

/* 裁窗定位：手卷右端 = 纯色装裱边 + 卷首留白（绢纹/兰花/朱印会干扰松阈值检测），
 * 文字区自右起约 800px 始。用近黑阈值（只中真笔墨，裱边蓝黑/绢纹/兰叶/朱印均不中），
 * 自右按 80px 带扫描中段（y 25%–75%，隔 2px 采样）：跳纯色带（>1500）与空白带（<150），
 * 首个与次带连续成run的文字带即卷首文字起（单带脉冲如框线不判）；右缘 +40px 余白。
 * 找不到回退经验窗 [w-1360, w-800]。 */
const BAND_W = 80;
const PAD_R = 40;

function inkOfBand(src, x0) {
  const { width, height, data } = src;
  const y0 = Math.floor(height * .25), y1 = Math.floor(height * .75);
  let ink = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < Math.min(x0 + BAND_W, width); x += 2) {
      const i = (y * width + x) * 4;
      if (data[i] < 75 && data[i + 1] < 65 && data[i + 2] < 55) ink++;
    }
  }
  return ink;
}

function textRightEdge(src) {
  for (let x = src.width - BAND_W; x >= BAND_W; x -= BAND_W) {
    const ink = inkOfBand(src, x);
    if (ink > 1500 || ink < 150) continue;         // 纯色裱边 / 空白·脉冲
    if (inkOfBand(src, x - BAND_W) < 150) continue; // 须与左邻成 run
    return Math.min(src.width, x + BAND_W + PAD_R);
  }
  return Math.max(STRIP_W, src.width - 800);
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
