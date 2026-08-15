/**
 * collation · P6 双本出具 + P7 flags（src/export.js）
 * 入参：adjudicate() 全量结果（含 align/diff/verdicts）→ 写出
 *   data/<书>/output/善本点校本.md   （公开）
 *   data/<书>/output/现代本.md       （自用）
 *   data/<书>/output/校勘记.md       （异文表 + 裁决 + 悬置）
 *   data/<书>/{aligned,diffs,verdicts}.json
 *   data/<书>/flags.yaml            （人工待办）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { loadWork } = require('./io');
const { buildShanbenPunctuated, buildXiandaiText } = require('./punctuate');

function outDir(workId) {
  const d = path.join(__dirname, '..', 'data', workId);
  fs.mkdirSync(path.join(d, 'output'), { recursive: true });
  return d;
}
function write(file, content) { fs.writeFileSync(file, content, 'utf8'); }

function exportAll(result, workId) {
  const dir = outDir(workId);
  const { shanben, xiandai } = loadWork(workId);
  const sb = buildShanbenPunctuated(result);
  const xd = buildXiandaiText(xiandai);

  // ── 善本点校本（公开）──
  const shanbenMd = [
    `# ${result.work.title} · 善本点校本`,
    '',
    `> 底本：${shanben.title}（${shanben.role === 'shanben' ? '公开善本' : ''}，${shanben.level} 级，可公开传播）。`,
    `> 句读由本系统点校（${result.verdictSummary?.engine === 'mock' ? 'mock 基线' : 'LLM'} + 校书官${result.verdictSummary?.resolved || 0} 条定论）。`,
    `> 经注大小学未细分（flat OCR 限制，见 DESIGN §9）；resolved 异文以夹注附。`,
    '',
    sb.text,
    '',
  ].join('\n');
  write(path.join(dir, 'output', '善本点校本.md'), shanbenMd);

  // ── 现代本（自用）──
  const suspended = (result.verdicts || []).filter(v => v.verdict === 'suspended');
  const xiandaiMd = [
    `# ${result.work.title} · 现代本（自用）`,
    '',
    `> 底本：${xiandai.title}（${xiandai.level} 级，仅供自修，不外传）。`,
    `> 附校书官对异文全部意见（含善本异）+ 悬置疑问 ${suspended.length} 条。`,
    '',
    '## 正文',
    '',
    xd,
    '',
    '## 校书官意见（悬置疑问）',
    '',
    ...suspended.map(v => [
      `### ${v.diffId} 善本「${v.shanben || '∅'}」/ 现代本「${v.xiandai || '∅'}」 (${v.type})`,
      `- 所在句：${typeof v.seg === 'string' ? v.seg : (v.seg && v.seg.xiandai) || '—'}`,
      `- 暂拟倾向：${v.tentative || 'neither'}`,
      ...v.opinions.map(o => `  - **${o.name || o.officer}**（${o.adopt}${o.confidence ? `·信${(o.confidence * 10).toFixed(0)}/10` : ''}）：${o.reason}${o.线索 ? `〔线索：${o.线索}〕` : ''}`),
    ].join('\n')),
    '',
  ].join('\n');
  write(path.join(dir, 'output', '现代本.md'), xiandaiMd);

  // ── 校勘记 ──
  const variants = result.variants || [];
  const verdicts = result.verdicts || [];
  const vmap = {}; verdicts.forEach(v => vmap[v.diffId] = v);
  const jiaoji = [
    `# ${result.work.title} · 校勘记`,
    '',
    `> 异文 ${variants.length} 条（异体 ${result.summary?.异体 || 0} / 真异文 ${result.summary?.真异文 || 0} / ocr疑 ${result.summary?.ocr疑 || 0} / 夺 ${result.summary?.夺 || 0} / 衍 ${result.summary?.衍 || 0}）。`,
    `> 校书官裁决：resolved ${result.verdictSummary?.resolved || 0}，suspended ${result.verdictSummary?.suspended || 0}（engine: ${result.verdictSummary?.engine}）。`,
    '',
    '| 编号 | 类型 | 善本 | 现代本 | 所在句(现代本) | 裁决 | 采纳 |',
    '|---|---|---|---|---|---|---|',
    ...variants.map(v => {
      const r = vmap[v.id];
      const verdict = r ? r.verdict : (v.type === '异体' ? '—' : '待裁');
      const adopt = r ? (r.adopt ? (r.adopt === 'shanben' ? '善本' : '现代本') : (r.tentative || '悬置')) : '';
      const sent = (v.seg.xiandai || '').slice(0, 24);
      return `| ${v.id} | ${v.type} | ${v.shanben || '∅'} | ${v.xiandai || '∅'} | ${sent} | ${verdict} | ${adopt} |`;
    }),
    '',
    '## resolved 定论',
    '',
    ...verdicts.filter(v => v.verdict === 'resolved').map(v =>
      `- ${v.diffId} 采${v.adopt === 'shanben' ? '善本' : '现代本'}「${v.adopt === 'shanben' ? v.shanben : v.xiandai}」：${v.opinions[0]?.reason || ''}`),
    '',
  ].join('\n');
  write(path.join(dir, 'output', '校勘记.md'), jiaoji);

  // ── 中间 JSON ──
  write(path.join(dir, 'aligned.json'), JSON.stringify(result.segments.map(s => ({
    segId: s.segId, score: s.score, orphan: !!s.orphan,
    xiandai: s.xiandai.raw, page: s.xiandai.page,
    shanben: (s.shanben.detail || []).filter(d => d.sb).map(d => d.sb.ch).join(''),
  })), null, 2));
  write(path.join(dir, 'diffs.json'), JSON.stringify(variants.map(v => ({
    id: v.id, type: v.type, shanben: v.shanben, xiandai: v.xiandai, pos: v.pos, note: v.note, seg: v.seg.xiandai, ctx: v.ctx, reconfirm: v.reconfirm,
  })), null, 2));
  write(path.join(dir, 'verdicts.json'), JSON.stringify(verdicts, null, 2));

  // ── flags.yaml（P7 人工待办）──
  const flags = [
    ...(verdicts.filter(v => v.verdict === 'suspended')).map(v => ({
      id: v.diffId, kind: 'suspended', desc: `善「${v.shanben || '∅'}」/今「${v.xiandai || '∅'}」(${v.type})`,
      tentative: v.tentative, seg: v.seg.xiandai, officers: v.opinions.map(o => `${o.name || o.officer}:${o.adopt}`),
    })),
    ...(variants.filter(v => v.type === 'ocr疑')).map(v => ({
      id: v.id, kind: 'ocr疑', desc: `善「${v.shanben || '∅'}」疑误读，今「${v.xiandai || '∅'}」`, reconfirm: v.reconfirm?.status || 'deferred',
    })),
  ];
  write(path.join(dir, 'flags.yaml'), YAML.stringify({ work: workId, count: flags.length, flags }, null, 2));

  return { dir, shanbenResolved: sb.resolvedCount, variantCount: variants.length, suspended: suspended.length, flagsCount: flags.length };
}

module.exports = { exportAll, outDir };
