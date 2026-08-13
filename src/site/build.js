/** 站點構建：A 級小字庫子集 + 首頁 + 各書目錄頁 → dist/。
 *  由 tools/gen-index.js（生產預生成）與 tools/cli.js cmdBuild（全量構建末尾）調用；
 *  dev 預覽由 serve.js 動態生成同式頁面（不構子集，字體落回退鏈）。 */
const fs = require('fs');
const path = require('path');
const subsetFont = require('subset-font');
const { aggregateSite } = require('./aggregate');
const {
  siteFaces, renderHome, renderShuku, renderTopic, renderComingSoon, renderJiaoshu, renderToc,
} = require('./render');
const { NAV, TABS, TOPICS, COPY } = require('./home');

/* 站點固定文案用字（頁面框架/落款/導航/頁簽/專題/招募），與數據用字一併入子集 */
const UI_CHARS = '蘭木藏書目錄一次校錄多態呈現書法古籍音樂之現代數字文創凡卷並序單手幅需點校回經史子集禮樂畫第葉前後半右其他檢索名篇聲微志遠此弄宜緩種全帙覽，·—→　';

function collectSiteChars(site) {
  const chars = new Set(UI_CHARS);
  const add = (s) => { for (const ch of s || '') chars.add(ch); };
  for (const b of site.books) {
    add(b.title); add(b.caption); add(b.category);
    for (const v of b.volumes) {
      add(v.title);
      if (v.entry) { add(v.entry.big); add(v.entry.sub); }
      add((v.gong || []).join(''));
    }
  }
  for (const n of NAV) add(n.label);
  for (const t of TABS) { add(t.key); (t.virtual || []).forEach(add); }
  for (const t of TOPICS) { add(t.title); add(t.desc); (t.virtual || []).forEach(add); Object.values(t.marks || {}).forEach(add); }
  add(COPY.soon.title); add(COPY.soon.sub); add(COPY.back); add(COPY.topicLabel);
  add(COPY.jiaoshu.title); add(COPY.jiaoshu.sub); COPY.jiaoshu.lines.forEach(add);
  return [...chars].join('');
}

async function buildSitePages(distRoot) {
  const site = aggregateSite();
  for (const w of site.warnings) console.warn('  [站點]', w);
  const faces = siteFaces();

  // 小字庫子集：固定文案 + 門戶配置 + 全部書名/卷次/篇名/部類/刻工
  const text = collectSiteChars(site);
  if (faces.subsettable.length) {
    const fontDir = path.join(distRoot, 'assets', 'fonts');
    fs.mkdirSync(fontDir, { recursive: true });
    for (const f of faces.subsettable) {
      const buf = await subsetFont(fs.readFileSync(f.file), text, { targetFormat: 'woff2' });
      fs.writeFileSync(path.join(fontDir, f.fontId + '.woff2'), buf);
      console.log(`  站點字庫: ${f.fontId}.woff2（${Math.round(buf.length / 1024)}KB，${[...text].length} 字）`);
    }
  }

  const put = (rel, html) => {
    const fp = path.join(distRoot, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, html);
  };
  put('index.html', renderHome(site, faces));
  put('shuku/index.html', renderShuku(site, faces));
  put('coming-soon/index.html', renderComingSoon(faces));
  put('jiaoshu/index.html', renderJiaoshu(faces));
  for (const t of TOPICS) put(`topics/${t.id}/index.html`, renderTopic(t, site, faces));
  let n = 0;
  for (const b of site.books) {
    if (b.standalone) continue;
    put(`books/${b.id}/index.html`, renderToc(b, faces));
    n++;
  }
  console.log(`  站點: 首頁 + 書庫 + ${TOPICS.length} 專題 + ${n} 書目錄頁 + 招募/期待頁`);
  return site;
}

module.exports = { buildSitePages };
