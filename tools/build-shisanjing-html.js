/**
 * 十三经注疏新卷批量构建 HTML（不含 JPG/PDF）
 * 用法：node tools/build-shisanjing-html.js [bookPrefix]
 */
const fs = require('fs');
const path = require('path');
const { loadWork } = require('../src/core/load');
const { buildLayout } = require('../src/core/model/scroll');
const { loadRegistry } = require('../src/fonts/fonts');
const { buildSubsets } = require('../src/fonts/subset');

const ROOT = path.join(__dirname, '..');
const PREFIXES = {
  maoshi: 20, zhouli: 42, yili: 50, liji: 63, zuozhuan: 60, gongyang: 28, xiaojing: 9,
};

const only = process.argv[2];
const reg = loadRegistry();
let built = 0, skipped = 0;

(async () => {
  for (const [p, n] of Object.entries(PREFIXES)) {
    if (only && only !== p) continue;
    for (let i = 1; i <= n; i++) {
      const id = `${p}-juan${i}`;
      const outDir = path.join(ROOT, 'dist', 'works', id);
      const htmlPath = path.join(outDir, 'index.html');
      // 断点续建：已存在且非空的 index.html 直接跳过
      if (fs.existsSync(htmlPath) && fs.statSync(htmlPath).size > 1000) {
        skipped++;
        continue;
      }
      try {
        const work = loadWork(id);
        const tree = buildLayout(work);
        fs.mkdirSync(outDir, { recursive: true });
        await buildSubsets(work, reg, outDir);
        const { html, warnings } = require('../src/render/html-songke').renderSongkeHtml(tree, { distWorkDir: outDir });
        for (const w of warnings) console.warn('  [字体]', id, w);
        fs.writeFileSync(htmlPath, html);
        built++;
        console.log(`✓ ${id}: ${tree.stats.leaves} 葉, HTML ${Math.round(html.length / 1024)}KB`);
      } catch (e) {
        console.error(`✗ ${id}: ${e.message}`);
      }
    }
  }
  console.log(`\n完成：构建 ${built} 卷 HTML，跳过已存在 ${skipped} 卷`);
})();
