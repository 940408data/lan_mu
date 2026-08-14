/**
 * collation · P2.5 视觉复核（src/reconfirm.js）
 * 对善本「ocr疑」字，再调视觉理解模型(VLM)或重跑 OCR 确认善本扫描件。
 *   - 有 VISION_MODEL + key → 渲染善本对应页 → VLM 读字回填（占位实现，见 TODO）
 *   - mock/无 VLM → deferred，转 P7 人工复核
 *
 * 注：真实 VLM 需 pdftoppm 渲染善本页 + 多模态 API；此处留接口，mock 全 defer。
 */
'use strict';
const { engine } = require('./llm');

async function reconfirm(variants, workId, shanben) {
  const targets = variants.filter(v => v.type === 'ocr疑');
  for (const v of targets) {
    if (engine !== 'mock' && process.env.VISION_MODEL && process.env.ANTHROPIC_API_KEY) {
      // TODO: 渲染 input_data/<书>/当涂郡本_pdf/page_<v页>.pdf → 调 VLM 读 v.pos 附近字
      v.reconfirm = { status: 'todo', reason: 'VLM 管路待接（需渲染+多模态调用）' };
    } else {
      v.reconfirm = { status: 'deferred', reason: `${engine === 'mock' ? 'mock' : '未配置 VLM'}，转人工复核善本扫描` };
    }
  }
  return variants;
}

module.exports = { reconfirm };
