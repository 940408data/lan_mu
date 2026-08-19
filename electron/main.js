/** 兰木桌面版主进程
 *  把现有 dist/ 静态站点包装成桌面应用：注册自定义协议 lanmu:// 映射到 dist 目录，
 *  使站点页绝对路径（/works/<id>/index.html、/assets/fonts/...）在 file:// 失效的场景下
 *  仍能天然解析。零改引擎、无内嵌 HTTP、无端口冲突。
 *
 *  dist 路径解析：打包后 → resourcesPath/dist；开发期 → 环境变量 LANMU_DIST 或 ../dist。
 *  第一版精简：dist 不含出图大文件（JPG/PNG/PDF），仅 HTML + 字体子集 + scan.jpg + 卷影图。 */
const { app, BrowserWindow, protocol } = require('electron');
const path = require('path');
const fs = require('fs');

const PROTO = 'lanmu';

// 自定义协议注册为标准特权协议：支持 fetch、流式响应、安全上下文
// （@font-face、viewer 内联脚本等 Web API 正常工作）
protocol.registerSchemesAsPrivileged([{
  scheme: PROTO,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);

const DIST_DIR = process.env.LANMU_DIST
  || (process.resourcesPath ? path.join(process.resourcesPath, 'dist') : path.join(__dirname, '..', 'dist'));

const MIME = {
  '.html': 'text/html;charset=utf-8', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
  '.ico': 'image/x-icon', '.txt': 'text/plain;charset=utf-8',
};

// 协议 URL → dist 内文件路径；目录尾斜杠 / 无扩展名目录 → 补 index.html
function resolveFile(urlStr) {
  let p;
  try { p = decodeURIComponent(new URL(urlStr).pathname); } catch { return null; }
  if (p === '/' || p === '') p = '/index.html';
  const full = path.join(DIST_DIR, p);
  // 防 dist 越界
  if (!path.resolve(full).startsWith(path.resolve(DIST_DIR) + path.sep)) return null;
  if (p.endsWith('/')) return path.join(full, 'index.html');
  if (!path.extname(p)) {
    const withIdx = path.join(full, 'index.html');
    if (fs.existsSync(withIdx)) return withIdx;
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
    return withIdx;
  }
  return full;
}

async function handle(req) {
  const fp = resolveFile(req.url);
  if (!fp || !fs.existsSync(fp)) {
    return new Response('Not Found: ' + req.url, { status: 404, headers: { 'content-type': 'text/plain;charset=utf-8' } });
  }
  const mime = MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream';
  const buf = await fs.promises.readFile(fp);
  return new Response(buf, { status: 200, headers: { 'content-type': mime, 'cache-control': 'no-cache' } });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 960, minHeight: 640,
    backgroundColor: '#1a1612',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL(`${PROTO}://${PROTO}/index.html`);
  return win;
}

app.whenReady().then(() => {
  protocol.handle(PROTO, handle);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
