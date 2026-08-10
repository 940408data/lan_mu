/**
 * 宋版善刻图像渲染器：逐葉截图后纵向拼接为整册长图（每字面一版 JPG+PNG）。
 * 整册纵向高度常超 Chromium 单次截图上限（16384px），故逐 .leafwrap 元素截图，
 * 不受整页高度限制，拼接亦无错位。
 */
const path = require('path');
const fs = require('fs');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');
const { launchBrowser } = require('./browser');
const { loadRegistry, resolveExportFaces } = require('../fonts/fonts');

/**
 * @param {object} tree     songke LayoutTree
 * @param {string} htmlPath 作品 HTML 绝对路径
 * @param {string} outDir   输出目录
 * @returns {Promise<string[]>} 产出的图片路径（每字面 JPG + PNG）
 */
async function renderSongkeImages(tree, htmlPath, outDir) {
  const exp = tree.meta.export || {};
  const base = exp.base || `${tree.meta.id}-songke`;
  const faces = exp.faces || { kai: 'Kai', song: 'Song' };
  const scale = exp.scale || 1.6;
  const quality = exp.quality || 88;
  const exportU = exp.u || 26; // 出图锁定字号，像素尺寸可复现

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({
      viewport: { width: 1200, height: 900 },
      deviceScaleFactor: scale,
    });
    await page.goto('file://' + htmlPath.replace(/\\/g, '/'));
    await page.waitForLoadState('load', { timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    // 出图模式：注入 B 级 fontLocal 字体的 file:// url（如有）
    const exportCss = resolveExportFaces(tree.meta, loadRegistry());
    if (exportCss) await page.addStyleTag({ content: exportCss });
    // 通葉模式 + 锁定字号，确保全部书叶可见且尺寸固定
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
      const tiles = [];
      for (let i = 0; i < n; i++) {
        const buf = await loc.nth(i).screenshot({ type: 'png' });
        tiles.push(PNG.sync.read(buf));
      }
      const whole = stitchV(tiles);

      const jpgOut = path.join(outDir, `${base}-${tag}.jpg`);
      fs.writeFileSync(jpgOut, jpeg.encode(pngToRaw(whole), quality).data);
      outputs.push(jpgOut);
      const pngOut = path.join(outDir, `${base}-${tag}.png`);
      fs.writeFileSync(pngOut, PNG.sync.write(whole));
      outputs.push(pngOut);
    }
    return outputs;
  } finally {
    await browser.close();
  }
}

/** 纵向拼接 PNG 分片（书叶自上而下），宽度取最大值，右侧留白补齐 */
function stitchV(tiles) {
  const w = Math.max(...tiles.map((t) => t.width));
  const h = tiles.reduce((a, t) => a + t.height, 0);
  const out = new PNG({ width: w, height: h, fill: true });
  out.data.fill(255); // 透明底 → 白
  let y = 0;
  for (const t of tiles) {
    for (let row = 0; row < t.height; row++) {
      out.data.set(t.data.subarray(row * t.width * 4, row * t.width * 4 + t.width * 4), ((y + row) * w) * 4);
    }
    y += t.height;
  }
  return out;
}

function pngToRaw(png) {
  return { data: Buffer.from(png.data), width: png.width, height: png.height };
}

module.exports = { renderSongkeImages };
