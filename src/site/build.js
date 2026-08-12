/** 站點構建：A 級小字庫子集 + 首頁 + 各書目錄頁 → dist/。
 *  由 tools/gen-index.js（生產預生成）與 tools/cli.js cmdBuild（全量構建末尾）調用；
 *  dev 預覽由 serve.js 動態生成同式頁面（不構子集，字體落回退鏈）。 */
const fs = require('fs');
const path = require('path');
const subsetFont = require('subset-font');
const { aggregateSite } = require('./aggregate');
const { siteFaces, renderIndex, renderToc } = require('./render');

/* 站點固定文案用字（頁面框架/落款/導航），與數據用字一併入子集 */
const UI_CHARS = '蘭木藏書目錄一次校錄多態呈現書法古籍音樂之現代數字文創凡卷並序單手幅需點校回經史子集禮樂畫第葉前後半右其他檢索名篇聲微志遠此弄宜緩，·—　';

async function buildSitePages(distRoot) {
  const site = aggregateSite();
  for (const w of site.warnings) console.warn('  [站點]', w);
  const faces = siteFaces();

  // 小字庫子集：固定文案 + 全部書名/卷次/篇名/部類/刻工
  const chars = new Set(UI_CHARS);
  for (const b of site.books) {
    for (const ch of (b.title || '') + (b.caption || '') + (b.category || '')) chars.add(ch);
    for (const v of b.volumes) {
      for (const ch of (v.title || '')) chars.add(ch);
      if (v.entry) for (const ch of (v.entry.big || '') + (v.entry.sub || '')) chars.add(ch);
      for (const ch of (v.gong || []).join('')) chars.add(ch);
    }
  }
  const text = [...chars].join('');
  if (faces.subsettable.length) {
    const fontDir = path.join(distRoot, 'assets', 'fonts');
    fs.mkdirSync(fontDir, { recursive: true });
    for (const f of faces.subsettable) {
      const buf = await subsetFont(fs.readFileSync(f.file), text, { targetFormat: 'woff2' });
      fs.writeFileSync(path.join(fontDir, f.fontId + '.woff2'), buf);
      console.log(`  站點字庫: ${f.fontId}.woff2（${Math.round(buf.length / 1024)}KB，${[...text].length} 字）`);
    }
  }

  fs.mkdirSync(distRoot, { recursive: true });
  fs.writeFileSync(path.join(distRoot, 'index.html'), renderIndex(site, faces));
  let n = 0;
  for (const b of site.books) {
    if (b.standalone) continue;
    const dir = path.join(distRoot, 'books', b.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), renderToc(b, faces));
    n++;
  }
  console.log(`  站點: 首頁 + ${n} 書目錄頁`);
  return site;
}

module.exports = { buildSitePages };
