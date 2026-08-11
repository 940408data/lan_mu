/** 构建后生成静态首页 dist/index.html（serve.js 在开发时动态生成，生产需预生成）
 *  分级发布：meta.stage === 'draft' 的卷次标注「需點校」（页面仅书叶与序，正文未公开）。 */
const fs = require('fs');
const path = require('path');
const { listWorks, loadWork, ROOT } = require('../src/core/load');

const links = listWorks()
  .map((id) => {
    let title = id, tag = '';
    try {
      const w = loadWork(id);
      title = (w.meta && w.meta.title) || id;
      if (w.meta && w.meta.stage === 'draft') tag = '　<span style="color:#a55;font-size:.85em">【需點校】</span>';
    } catch (e) { /* 元数据缺失时仅列 id */ }
    return `<li><a href="/works/${id}/index.html">${title}</a>${tag}</li>`;
  })
  .join('');

const html = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>蘭木 · 作品列表</title>
<body style="font:16px/2 serif;padding:2em">
<h2>蘭木 · 作品列表</h2>
<ul>${links}</ul>
</body>`;

fs.writeFileSync(path.join(ROOT, 'dist', 'index.html'), html);
console.log('首页: dist/index.html');
