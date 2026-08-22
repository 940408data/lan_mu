/**
 * 纸张纹理模块：seed 程序化 SVG（HTML/JPG/PDF 三端共用，可回灌 songke）。
 * 层序：底色（逐叶微异）→ 帘纹/纤维 → 老化晕影 → 水渍（褐边淡心+水线）
 *      → 霉斑 → 虫蛀 → 虫道（蜿蜒细线）。
 * 全部 id 带 -<uid> 后缀，避免同文档多内联 SVG 冲突；同一 seed 三端输出一致。
 */
const { mulberry32 } = require('./calligraphy');

/** 不规则斑形路径（椭圆周向抖动多点，配合位移滤镜成有机形） */
function blobPath(rng, cx, cy, rx, ry) {
  const n = 9;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const jx = 0.72 + rng() * 0.56;
    pts.push([cx + Math.cos(a) * rx * jx, cy + Math.sin(a) * ry * jx]);
  }
  return 'M' + pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L ') + ' Z';
}

/** 虫道：随机游走细线 */
function trailPath(rng, W, H) {
  let x = W * (0.15 + rng() * 0.7);
  let y = H * (0.08 + rng() * 0.3);
  let a = rng() * Math.PI * 2;
  const seg = [`M${x.toFixed(1)} ${y.toFixed(1)}`];
  const n = 7 + Math.floor(rng() * 6);
  for (let i = 0; i < n; i++) {
    a += (rng() - 0.5) * 2.4;
    const len = 18 + rng() * 46;
    x = Math.max(6, Math.min(W - 6, x + Math.cos(a) * len));
    y = Math.max(6, Math.min(H - 6, y + Math.sin(a) * len));
    seg.push(`L${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return seg.join(' ');
}

/**
 * 生成半叶纸张 SVG。
 * @param {number} seed  纸张种子（作品 seed + 叶序派生）
 * @param {object} opts  { w, h, decor:{stain,fox,holes,trails} }
 * @returns {string} 内联 <svg> 字符串
 */
function paperSvg(seed, opts = {}) {
  const W = opts.w || 540;
  const H = opts.h || 1008;
  const decor = opts.decor || {};
  const rng = mulberry32(seed >>> 0);
  const uid = 'q' + (seed >>> 0).toString(36);

  // 底色：奶油 / 米白 / 微黄 逐叶微异
  const hue = 42 + Math.floor(rng() * 5);
  const sat = 32 + Math.floor(rng() * 12);
  const lig = 86 + Math.floor(rng() * 5);
  const base = `hsl(${hue},${sat}%,${lig}%)`;

  const s = [];
  s.push(`<svg class="ms-paper" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">`);
  s.push(`<defs>`);
  s.push(`<filter id="gr-${uid}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${seed % 100}" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0.42 0 0 0 0 0.33 0 0 0 0 0.2 0 0 0 0.06 0"/></filter>`);
  s.push(`<filter id="ro-${uid}" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="turbulence" baseFrequency="0.015" numOctaves="3" seed="${(seed >> 3) % 100}" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="26"/></filter>`);
  s.push(`<filter id="bl-${uid}"><feGaussianBlur stdDeviation="1.1"/></filter>`);
  s.push(`<radialGradient id="vg-${uid}" cx="50%" cy="50%" r="72%"><stop offset="62%" stop-color="rgba(122,90,40,0)"/><stop offset="100%" stop-color="rgba(122,90,40,0.26)"/></radialGradient>`);
  s.push(`<radialGradient id="sg-${uid}" cx="50%" cy="50%" r="60%"><stop offset="0%" stop-color="hsla(${hue},30%,82%,0.10)"/><stop offset="78%" stop-color="rgba(158,116,52,0.10)"/><stop offset="100%" stop-color="rgba(146,100,44,0.20)"/></radialGradient>`);
  s.push(`<pattern id="ld-${uid}" width="6" height="7" patternUnits="userSpaceOnUse"><rect width="6" height="7" fill="none"/><line x1="0" y1="3.5" x2="6" y2="3.5" stroke="rgba(140,110,60,0.05)" stroke-width="1"/></pattern>`);
  s.push(`</defs>`);

  // 底 + 帘纹 + 纤维
  s.push(`<rect width="${W}" height="${H}" fill="${base}"/>`);
  s.push(`<rect width="${W}" height="${H}" fill="url(#ld-${uid})"/>`);
  s.push(`<rect width="${W}" height="${H}" filter="url(#gr-${uid})" opacity="0.9"/>`);

  // 水渍（褐边淡心 + 水线描边）
  const nStain = decor.stain || 0;
  for (let i = 0; i < nStain; i++) {
    const cx = W * (0.55 + rng() * 0.4);
    const cy = H * (0.06 + rng() * 0.3);
    const d = blobPath(rng, cx, cy, 60 + rng() * 90, 46 + rng() * 70);
    s.push(`<path d="${d}" fill="url(#sg-${uid})" stroke="rgba(140,95,40,0.32)" stroke-width="2.2" filter="url(#ro-${uid})"/>`);
  }

  // 霉斑（foxing）
  const nFox = decor.fox == null ? 12 : decor.fox;
  for (let i = 0; i < nFox; i++) {
    const cx = rng() * W, cy = rng() * H;
    s.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(1 + rng() * 2.6).toFixed(1)}" fill="#a0793a" opacity="${(0.08 + rng() * 0.2).toFixed(2)}" filter="url(#bl-${uid})"/>`);
  }

  // 虫蛀（锐边深点，个别带浅色晕）
  const nHoles = decor.holes == null ? 3 : decor.holes;
  for (let i = 0; i < nHoles; i++) {
    const cx = rng() * W, cy = rng() * H;
    const r = (0.8 + rng() * 1.5).toFixed(1);
    if (rng() < 0.35) s.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(r * 2.4).toFixed(1)}" fill="rgba(190,160,105,0.35)"/>`);
    s.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}" fill="#55402a" opacity="0.82"/>`);
  }

  // 虫道（蜿蜒细线）
  const nTrail = decor.trails || 0;
  for (let i = 0; i < nTrail; i++) {
    s.push(`<path d="${trailPath(rng, W, H)}" fill="none" stroke="#6b4e2e" stroke-width="1.1" stroke-linecap="round" opacity="0.38" filter="url(#bl-${uid})"/>`);
  }

  // 老化晕影
  s.push(`<rect width="${W}" height="${H}" fill="url(#vg-${uid})"/>`);
  s.push(`</svg>`);
  return s.join('');
}

module.exports = { paperSvg };
