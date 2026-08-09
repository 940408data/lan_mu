/**
 * 字体子集化与覆盖率校验。
 *  - 仅 A 级（开源协议）且 allowEmbed 的字体会产出 woff2 子集
 *  - 覆盖率校验对全部已就位字体生效，缺字列出清单（供升级完整版/换字体/集字兜底决策）
 */
const fs = require('fs');
const path = require('path');
const fontkit = require('fontkit');
const subsetFont = require('subset-font');
const { fontFileOf } = require('./fonts');

/** 收集作品全部用字（正文 + 夹注 + 印章 + 界面所需少量字符） */
function collectChars(work) {
  const set = new Set();
  for (const sec of work.sections) {
    for (const col of sec.columns) {
      for (const ch of col.text) set.add(ch);
      if (col.note) for (const ch of col.note.text) set.add(ch);
    }
  }
  for (const s of work.seals || []) for (const c of s.chars) set.add(c.ch);
  return [...set];
}

/** 校验字体对作品用字的覆盖率，返回缺字数组 */
function checkCoverage(fontPath, chars) {
  const font = fontkit.openSync(fontPath);
  const missing = chars.filter((ch) => !font.hasGlyphForCodePoint(ch.codePointAt(0)));
  return { total: chars.length, missing };
}

/**
 * 为作品构建 A 级字体的 woff2 子集。
 * @returns {Promise<{built:string[], warnings:string[]}>}
 */
async function buildSubsets(work, registry, distWorkDir) {
  const built = [];
  const warnings = [];
  const chars = collectChars(work);
  // 子集字符集 = 作品用字 + 本作品元信息用字 + 界面通用字（按钮/说明面板固定文案）
  const m = work.meta;
  const metaChars = [m.title, m.subtitle, m.mark, m.docTitle, m.ariaLabel,
    ...Object.values(m.faces || {}).map((f) => f.label)].filter(Boolean).join('');
  const uiExtra = '宋體寫經行楷摹本原貌界行縮小放大卷軸說明全卷行文摹錄處夾注厘米關於本製作取材操作 ·—0123456789';
  const text = [...new Set(chars.join('') + metaChars + uiExtra)].join('');

  const usedFontIds = new Set(
    Object.values(work.meta.faces || {})
      .flatMap((f) => [f.font, f.fontLocal].filter(Boolean))
  );
  for (const fontId of usedFontIds) {
    const entry = registry[fontId];
    if (!entry || entry.status === '待选型' || entry.status === '待下载') continue;
    const file = fontFileOf(entry);
    if (!file) continue;

    const cov = checkCoverage(file, chars);
    if (cov.missing.length) {
      warnings.push(
        `字体「${entry.name}」缺 ${cov.missing.length} 字（共需 ${cov.total}）：` +
        cov.missing.slice(0, 30).join('') + (cov.missing.length > 30 ? ' …' : '')
      );
    }
    if (entry.license === 'A' && entry.allowEmbed) {
      const outDir = path.join(distWorkDir, 'fonts');
      fs.mkdirSync(outDir, { recursive: true });
      const out = path.join(outDir, fontId + '.woff2');
      const buf = await subsetFont(fs.readFileSync(file), text, { targetFormat: 'woff2' });
      fs.writeFileSync(out, buf);
      built.push(`${fontId}.woff2 (${Math.round(buf.length / 1024)}KB, ${[...text].length}字)`);
    }
  }
  return { built, warnings };
}

module.exports = { collectChars, checkCoverage, buildSubsets };
