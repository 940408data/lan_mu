/** 构建后生成静态首页 dist/index.html（serve.js 在开发时动态生成，生产需预生成） */
const fs = require('fs');
const path = require('path');
const { listWorks, ROOT } = require('../src/core/load');

const links = listWorks()
  .map((id) => `<li><a href="/works/${id}/index.html">${id}</a></li>`)
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
