/**
 * 宋版善刻 PDF 渲染器：一葉一頁的多頁 PDF，每字面一版（楷/宋/行楷等）。
 * 逐葉高清截图后以 pdf-lib 逐页嵌入，页尺寸按 CSS 像素折算为点（96dpi→72dpi）。
 */
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { launchBrowser } = require('./browser');
const { loadRegistry, resolveExportFaces } = require('../fonts/fonts');

/**
 * @param {object} tree     songke LayoutTree
 * @param {string} htmlPath 作品 HTML 绝对路径
 * @param {string} outDir   输出目录
 * @param {object} opts     { full?: boolean } 全量 PDF（否则仅前 previewLeaves 叶预览，默认 5）
 * @returns {Promise<string[]>} 每字面一份 PDF 的路径列表
 */
async function renderSongkePdf(tree, htmlPath, outDir, opts = {}) {
  const exp = tree.meta.export || {};
  const base = exp.base || `${tree.meta.id}-songke`;
  const faces = exp.faces || { kai: 'Kai', song: 'Song' };
  const scale = 2; // 固定 2×：印刷级清晰度与体积折中
  const exportU = exp.u || 26;

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
    await page.evaluate((u) => {
      document.getElementById('book').classList.remove('single');
      document.documentElement.style.setProperty('--u', u + 'px');
      document.querySelector('.bar').style.display = 'none';
    }, exportU);

    const outputs = [];
    for (const [role, tag] of Object.entries(faces)) {
      await page.evaluate((r) => document.documentElement.style.setProperty('--face', `var(--${r})`), role);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(1000);

      const loc = page.locator('.leafwrap');
      const n = await loc.count();
      // 预览模式：仅截前 previewLeaves 叶（meta.export.previewLeaves 可覆盖）；--pdf-full 出全量
      const maxLeaves = opts.full ? n : Math.min(n, exp.previewLeaves || 5);
      const pdfDoc = await PDFDocument.create();
      pdfDoc.setTitle(tree.meta.docTitle || tree.meta.title);
      if (maxLeaves < n) console.log(`  [PDF] ${tag}面：預覽前 ${maxLeaves} 葉（共 ${n} 葉，全量用 --pdf-full）`);
      for (let i = 0; i < maxLeaves; i++) {
        const buf = await loc.nth(i).screenshot({ type: 'png' });
        const img = await pdfDoc.embedPng(buf);
        // 设备像素 → CSS 像素 → 点（72dpi）
        const w = (img.width / scale) * 0.75;
        const h = (img.height / scale) * 0.75;
        const p = pdfDoc.addPage([w, h]);
        p.drawImage(img, { x: 0, y: 0, width: w, height: h });
      }
      const out = path.join(outDir, `${base}-${tag}.pdf`);
      require('fs').writeFileSync(out, await pdfDoc.save());
      outputs.push(out);
    }
    return outputs;
  } finally {
    await browser.close();
  }
}

module.exports = { renderSongkePdf };
