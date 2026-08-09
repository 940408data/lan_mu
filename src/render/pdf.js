/**
 * PDF 渲染器：整卷长页 PDF（矢量文字、可检索），由打印样式铺平长卷。
 * 12282px ≈ 127.9in，低于 Chromium 200in 单页上限；更长卷需分段渲染 + pdf-lib 合并（预留）。
 */
const path = require('path');
const { launchBrowser } = require('./browser');
const { loadRegistry, resolveExportFaces } = require('../fonts/fonts');

/** 单页尺寸上限（英寸），超出时走分段合并（阶段一先报错提示） */
const MAX_PAGE_IN = 190;

async function renderPdf(tree, htmlPath, outDir) {
  const exp = tree.meta.export || {};
  const base = exp.base || `${tree.meta.id}-scroll`;
  const wIn = tree.dims.wrapW / 96;
  const hIn = tree.dims.wrapH / 96;
  if (wIn > MAX_PAGE_IN || hIn > MAX_PAGE_IN) {
    throw new Error(`卷尺寸 ${wIn.toFixed(1)}in × ${hIn.toFixed(1)}in 超出单页上限，待接入分段渲染 + pdf-lib 合并`);
  }

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.goto('file://' + htmlPath.replace(/\\/g, '/'));
    // 不用 networkidle：幽兰扫描图按需加载、大卷资源多，networkidle 易超时；load + fonts.ready 已足够
    await page.waitForLoadState('load', { timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    // 出图模式：注入 B 级 fontLocal 字体的 file:// url，使未安装该字体的出图机也能渲染
    const exportCss = resolveExportFaces(tree.meta, loadRegistry());
    if (exportCss) await page.addStyleTag({ content: exportCss });
    await page.emulateMedia({ media: 'print' });
    const out = path.join(outDir, `${base}.pdf`);
    await page.pdf({
      path: out,
      width: tree.dims.wrapW + 'px',
      height: tree.dims.wrapH + 'px',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      pageRanges: '1',
    });
    return out;
  } finally {
    await browser.close();
  }
}

module.exports = { renderPdf };
