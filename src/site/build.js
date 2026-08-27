/** 站點構建：A 級小字庫子集 + 首頁 + 各書目錄頁 → dist/。
 *  由 tools/gen-index.js（生產預生成）與 tools/cli.js cmdBuild（全量構建末尾）調用；
 *  dev 預覽由 serve.js 動態生成同式頁面（不構子集，字體落回退鏈）。 */
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const subsetFont = require('subset-font');
const { aggregateSite } = require('./aggregate');
const {
  siteFaces, renderHome, renderSanzang, renderShuku, renderTopic, renderComingSoon, renderJiaoshu, renderToc,
} = require('./render');
const { NAV, TABS, TOPICS, COPY } = require('./home');
const { buildPanels } = require('./panels');

/* 靜態特頁清單：[dist 相對路徑, 源文件] */
const STATIC_PAGES = [
  ['topics/sishu/lineage.html', path.join(__dirname, 'topics', 'sishu-lineage.html')],
];

/* 站點固定文案用字（頁面框架/落款/導航/簽條/專題/招募/版本源流三態），與數據用字一併入子集 */
const UI_CHARS = '蘭木藏書目錄一次校錄多態呈現書法古籍音樂之現代數字文創凡卷並序單手幅需點校回經史子集禮樂畫第葉前後半右其他檢索名篇聲微志遠此弄宜緩種全帙覽，·—→ 入專題推薦涵泳幽賞四時書三釋編版本源流在庋待訪亡佚';

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
  for (const t of TOPICS) {
    add(t.title); add(t.desc); add(t.intro); (t.virtual || []).forEach(add); Object.values(t.marks || {}).forEach(add);
    for (const e of t.editions || []) {
      add(e.era); add(e.blurb);
      for (const it of e.items || []) { add(it.name); add(it.note); }
    }
    (t.extras || []).forEach((x) => { add(x.label); add(x.note); });
  }
  add(COPY.soon.title); add(COPY.soon.sub); add(COPY.back); add(COPY.topicLabel); add(COPY.topicHead); add(COPY.topicEnter); add(COPY.enterSanzang); add(COPY.sanzangSub); add(COPY.enterShuku); add(COPY.shukuSub);
  add(COPY.jiaoshu.title); add(COPY.jiaoshu.sub); COPY.jiaoshu.lines.forEach(add);
  return [...chars].join('');
}

async function buildSitePages(distRoot) {
  const site = aggregateSite();
  for (const w of site.warnings) console.warn('  [站點]', w);
  // 先取字面（stacks/可子集列表；faceCss 此時無版本戳——子集化產出 hash 後重算注入）
  const base = siteFaces();

  // 卷影：四時四部手卷右緣裁切（寫站點頁之前，渲染側讀产物）
  const sishi = TOPICS.find((t) => t.id === 'sishi-youshang');
  const panelResults = sishi ? buildPanels(distRoot, sishi.books) : {};

  // 小字庫子集：固定文案 + 門戶配置 + 全部書名/卷次/篇名/部類/刻工
  const text = collectSiteChars(site);
  const versions = {};
  if (base.subsettable.length) {
    const fontDir = path.join(distRoot, 'assets', 'fonts');
    fs.mkdirSync(fontDir, { recursive: true });
    for (const f of base.subsettable) {
      const buf = await subsetFont(fs.readFileSync(f.file), text, { targetFormat: 'woff2' });
      fs.writeFileSync(path.join(fontDir, f.fontId + '.woff2'), buf);
      versions[f.fontId] = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8);
      console.log(`  站點字庫: ${f.fontId}.woff2?v=${versions[f.fontId]}（${Math.round(buf.length / 1024)}KB，${[...text].length} 字）`);
    }
  }
  // 帶版本戳的最終字面：@font-face url 注入 ?v=<內容 hash>，內容變則戳變、URL 變即破緩存
  const faces = siteFaces(versions);

  const put = (rel, html) => {
    const fp = path.join(distRoot, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, html);
  };
  put('index.html', renderHome(site, faces, panelResults));
  put('sanzang/index.html', renderSanzang(site, faces));
  put('shuku/index.html', renderShuku(site, faces));
  put('coming-soon/index.html', renderComingSoon(faces));
  put('jiaoshu/index.html', renderJiaoshu(faces));
  for (const t of TOPICS) put(`topics/${t.id}/index.html`, renderTopic(t, site, faces));
  // 靜態特頁：自包含頁不經模板/子集字庫，源在 src/site/topics/，原樣入 dist
  for (const [rel, src] of STATIC_PAGES) if (fs.existsSync(src)) put(rel, fs.readFileSync(src, 'utf8'));
  let n = 0;
  for (const b of site.books) {
    if (b.standalone) continue;
    put(`books/${b.id}/index.html`, renderToc(b, faces));
    n++;
  }
  console.log(`  站點: 首頁 + 三藏 + 書庫 + ${TOPICS.length} 專題 + ${n} 書目錄頁 + 招募/期待頁`);
  return site;
}

module.exports = { buildSitePages };
