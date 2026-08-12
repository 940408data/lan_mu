/** 構建後生成靜態站點：首頁「藏書」+ 各書「目錄葉」（serve.js 開發時動態生成，生產需預生成）。
 *  書目歸屬依據各卷 meta.book 塊；分級發布：全帙皆 draft 的書於首頁標「需點校」。 */
const path = require('path');
const { ROOT } = require('../src/core/load');

(async () => {
  try {
    await require('../src/site/build').buildSitePages(path.join(ROOT, 'dist'));
    console.log('首頁: dist/index.html');
  } catch (e) {
    console.error('出錯:', e.message);
    process.exit(1);
  }
})();
