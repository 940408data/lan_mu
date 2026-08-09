/** 预览服务器：托管 dist/works/youlan + 本机增强
 *  B 级字体（英椎行书等）经 /b-fonts/ HTTP 路由注入预览 HTML，
 *  使本机预览可见真行书（dist HTML 本身不含此注入，B 级不泄漏）。
 *  注：file:// 字体在 http:// origin 被 Chromium 阻止，故走 HTTP 同源路由。 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadRegistry, fontFileOf } = require('../src/fonts/fonts');

const ROOT = path.join(__dirname, '..', 'dist', 'works', 'youlan');
const MIME = {
  '.html': 'text/html;charset=utf-8', '.css': 'text/css', '.js': 'application/javascript',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
};

// B 级字体本机增强：经 HTTP 路由加载（file:// 在 http origin 被阻止）
const bRoutes = {};
let bCss = '';
for (const [id, e] of Object.entries(loadRegistry())) {
  if (e.license !== 'B' || e.allowEmbed) continue;
  const f = fontFileOf(e);
  if (!f) continue;
  bRoutes[id] = f;
  const locals = [`local("${e.family}")`];
  if (e.familyLocal) locals.push(`local("${e.familyLocal}")`);
  bCss += `@font-face{font-family:"${e.family}";src:${locals.join(',')},url("/b-fonts/${id}") format("truetype");font-display:swap;}`;
}

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  // B 级字体路由
  if (p.startsWith('/b-fonts/')) {
    const id = p.slice(9);
    const f = bRoutes[id];
    if (!f) { res.writeHead(404); res.end('no font: ' + id); return; }
    fs.readFile(f, (err, buf) => {
      if (err) { res.writeHead(500); res.end('read err'); return; }
      res.writeHead(200, { 'Content-Type': 'font/ttf', 'Cache-Control': 'no-store' });
      res.end(buf);
    });
    return;
  }
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(f, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found: ' + p); return; }
    if (path.extname(f) === '.html' && bCss) {
      buf = Buffer.from(buf.toString('utf8').replace('</head>', `<style>${bCss}</style></head>`));
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
    res.end(buf);
  });
});
server.listen(8125, () => console.log('serve http://localhost:8125/ (B-fonts: ' + Object.keys(bRoutes).join(',') + ')'));
