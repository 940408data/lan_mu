/**
 * 宋版善刻 PDF 渲染器：一葉一頁的多頁 PDF。
 * 逐葉高清截图（默认字面）后以 pdf-lib 逐页嵌入，页尺寸按 CSS 像素折算为点（96dpi→72dpi）。
 */
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { launchBrowser } = require('./browser');
const { loadRegistry, resolveExportFaces } = require('../fonts/fonts');

/**
 * @param {object} tree     songke LayoutTree
 * @param {string} htmlPath 作品 HTML 绝对路径
 * @param {string} outDir   输出目录
 * @returns {Promise<string>} PDF 路径
 */
async function renderSongkePdf(tree, htmlPath, outDir) {
  const exp = tree.meta.export || {};
  const base = exp.base || `${tree.meta.id}-songke`;
  const scale = 2; // 固定 2×：印刷级清晰度与体积折中
  const exportU = exp.u || 26;
  const role = exp.pdfFace || Object.keys(exp.faces || { kai: 'Kai' })[0];

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({
      viewport: { width: 1200, height: 900 },
      deviceScaleFactor: scale,
    });
    await page.goto('file://' + htmlPath.replace(/\\/g, '/'));
    await page.waitForLoadState('load', { timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    const exportCss = resolveExportFaces(tree.meta, loadRegistry());
    if (exportCss) await page.addStyleTag({ content: exportCss });
    await page.evaluate((args) => {
      document.getElementById('book').classList.remove('single');
      document.documentElement.style.setProperty('--u', args.u + 'px');
      document.querySelector('.bar').style.display = 'none';
      document.documentElement.style.setProperty('--face', `var(--${args.role})`);
    }, { u: exportU, role });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1000);

    const loc = page.locator('.leafwrap');
    const n = await loc.count();
    const pdfDoc = await PDFDocument.create();
    pdfDoc.setTitle(tree.meta.docTitle || tree.meta.title);
    for (let i = 0; i < n; i++) {
      const buf = await loc.nth(i).screenshot({ type: 'png' });
      const img = await pdfDoc.embedPng(buf);
      // 设备像素 → CSS 像素 → 点（72dpi）
      const w = (img.width / scale) * 0.75;
      const h = (img.height / scale) * 0.75;
      const p = pdfDoc.addPage([w, h]);
      p.drawImage(img, { x: 0, y: 0, width: w, height: h });
    }
    const out = path.join(outDir, `${base}.pdf`);
    require('fs').writeFileSync(out, await pdfDoc.save());
    return out;
  } finally {
    await browser.close();
  }
}

module.exports = { renderSongkePdf };
