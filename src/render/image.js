/**
 * 图像渲染器：Playwright 无头浏览器打开作品 HTML，按字体角色逐版全幅截图。
 * 整卷宽 × scale 超过 Chromium 单次截图上限（16384px，超限内容会回绕重复，
 * 表现为卷首被卷尾顶替），故按 clip 分片截图后用像素拼接还原整卷，
 * 同时输出 JPG 与无损 PNG 两份。
 */
const path = require('path');
const fs = require('fs');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');
const { launchBrowser } = require('./browser');
const { loadRegistry, resolveExportFaces } = require('../fonts/fonts');

const TILE_DEV = 8000; // 单片目标宽度（设备像素），远低于 16384 上限

/**
 * @param {object} tree     LayoutTree
 * @param {string} htmlPath 作品 HTML 绝对路径
 * @param {string} outDir   输出目录
 * @returns {Promise<string[]>} 产出的图片路径（JPG + PNG）
 */
async function renderImages(tree, htmlPath, outDir) {
  const exp = tree.meta.export || {};
  const base = exp.base || `${tree.meta.id}-scroll`;
  const faces = exp.faces || { song: 'Song', xing: 'Xingkai' };
  const scale = exp.scale || 1.6;
  const quality = exp.quality || 88;

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({
      viewport: { width: tree.dims.wrapW, height: 1000 },
      deviceScaleFactor: scale,
    });
    await page.goto('file://' + htmlPath.replace(/\\/g, '/'));
    // 不用 networkidle：幽兰扫描图按需加载、大卷资源多，networkidle 易超时；load + fonts.ready 已足够
    await page.waitForLoadState('load', { timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    // 出图模式：注入 B 级 fontLocal 字体的 file:// url，使未安装该字体的出图机也能渲染
    const exportCss = resolveExportFaces(tree.meta, loadRegistry());
    if (exportCss) await page.addStyleTag({ content: exportCss });
    // 等查看器首帧 fit() 跑完再锁 zoom=1：load 比 networkidle 早，会与 fit 竞态，
    // 致 --zoom 被覆写为 fit 值、截图窗口按放大矩形裁切（卷尾裁切、右侧溢白）
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.evaluate(() => {
      // 固定 zoom=1，保证整卷像素尺寸精确（12282×868 × scale）
      document.documentElement.style.setProperty('--zoom', '1');
      const v = document.getElementById('viewer');
      v.scrollLeft = 0; v.scrollTop = 0;
      // 固定定位的卷况/进度条不入出图
      document.querySelectorAll('.hud,.bar').forEach((e) => (e.style.display = 'none'));
    });

    // .wrap 元素的精确版面矩形（CSS px），作为分片 clip 基准
    const rect = await page.locator('.wrap').boundingBox();

    const outputs = [];
    for (const [role, tag] of Object.entries(faces)) {
      await page.evaluate((f) => {
        const p = document.getElementById('paper');
        p.classList.remove('f-song', 'f-jing', 'f-xing');
        p.classList.add(f);
      }, 'f-' + role);
      // 等该模式字体加载完成（英椎行书 9MB ttf 需时间），避免截到回退字体或加载中间 reflow
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(1200);

      // 分片截图：设备像素边界对齐 scale，保证拼接无错位
      const devW = Math.round(rect.width * scale);
      const devH = Math.round(rect.height * scale);
      const tiles = [];
      for (let x0 = 0; x0 < devW; x0 += TILE_DEV) {
        const w = Math.min(TILE_DEV, devW - x0);
        const clip = {
          x: rect.x + x0 / scale,
          y: rect.y,
          width: w / scale,
          height: rect.height,
        };
        const buf = await page.screenshot({ type: 'png', clip });
        tiles.push(PNG.sync.read(buf));
      }
      const whole = stitch(tiles, devW, devH);

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

/** 水平拼接 PNG 分片（设备像素精确），不足宽度的末片以白纸补齐 */
function stitch(tiles, devW, devH) {
  const out = new PNG({ width: devW, height: devH, fill: true });
  out.data.fill(255);
  let x = 0;
  for (const t of tiles) {
    const w = Math.min(t.width, devW - x);
    for (let y = 0; y < Math.min(t.height, devH); y++) {
      out.data.set(t.data.subarray(y * t.width * 4, y * t.width * 4 + w * 4), (y * devW + x) * 4);
    }
    x += t.width;
  }
  return out;
}

/** PNG → jpeg-js 需要的 { data, width, height } */
function pngToRaw(png) {
  return { data: Buffer.from(png.data), width: png.width, height: png.height };
}

module.exports = { renderImages };
