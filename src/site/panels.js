/** 卷影管線：四時四部圖像源資產 → dist/assets/topics/<id>.png。
 *  源：src/site/assets/topics/<id>.png（進 git，手工備圖 128×179）。
 *  接線：build.js buildSitePages 內（寫站點頁之前）調用；缺源 → 告警跳過不報錯。
 *  panelFan 直連 /assets/topics/<id>.png，故此處僅負責產物到位（返回 {id: absPath} 供渲染側探測）。 */
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, 'assets', 'topics');

/** 構建期調用：拷 src/site/assets/topics/<id>.png → dist/assets/topics/<id>.png。返回 { id: absPath }。
 *  @param {string} distRoot dist 根目錄
 *  @param {string[]} bookIds 四時專題的 book id 列表 */
function buildPanels(distRoot, bookIds) {
  const results = {};
  const missing = [];
  const outDir = path.join(distRoot, 'assets', 'topics');
  fs.mkdirSync(outDir, { recursive: true });
  for (const id of bookIds) {
    const src = path.join(SRC_DIR, `${id}.png`);
    const dst = path.join(outDir, `${id}.png`);
    if (fs.existsSync(src)) { fs.copyFileSync(src, dst); results[id] = dst; }
    else missing.push(`${id}: 缺源 ${src}`);
  }
  for (const m of missing) console.warn(`  [卷影] ${m}`);
  const n = Object.keys(results).length;
  if (n) console.log(`  卷影: ${n}/${bookIds.length} 張 → dist/assets/topics/`);
  return results;
}

module.exports = { buildPanels };
