/**
 * collation · P6 双本出具 + P7 精校台/flags（src/export.js）
 * 入参：adjudicate() 全量结果（含 align/diff/clusters/verdicts）→ 写出
 *   data/<书>/output/善本点校本.md   （公开）
 *   data/<书>/output/现代本.md       （自用）
 *   data/<书>/output/校勘记.md       （字级真异文 + 簇级夺衍换 + 异体 + 底本修复 + 噪声附录，各带环节出处）
 *   data/<书>/output/精校台.html     （单文件离线人工精校台，见 src/review.js）
 *   data/<书>/{aligned,diffs,clusters,verdicts}.json + flags.yaml
 *
 * 校勘记是流水线各环节记录的**忠实汇总**：每条异文带「发现（对校）/ 核验（P4.5 引擎+置信）/ 裁决（校书官|规则|人工）」出处；
 * 噪声不删，移附录留痕。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { loadWork } = require('./io');
const { buildShanbenPunctuated, buildXiandaiText } = require('./punctuate');
const { loadVerifications } = require('./cluster');
const review = require('./review');

function outDir(workId) {
  const d = path.join(__dirname, '..', 'data', workId);
  fs.mkdirSync(path.join(d, 'output'), { recursive: true });
  return d;
}
function write(file, content) { fs.writeFileSync(file, content, 'utf8'); }
const ADOPT = { shanben: '善本', xiandai: '现代本', neither: '兩存' };
const segTextOf = v => (typeof v.seg === 'string' ? v.seg : (v.seg && v.seg.xiandai)) || '';

/** 四库体例校勘记句 */
function composeNote(v) {
  const b = v.shanben || '無此字', r = v.xiandai || '無此字';
  let head;
  if (v.type === '夺') head = `底本無「${r}」，今本有之。`;
  else if (v.type === '衍') head = `底本多「${b}」，今本無。`;
  else head = `「${b}」，今本作「${r}」。`;
  const GR = { '確證': 3, '旁證': 2, '推測': 1, '無證': 0 };
  const ops = (v.opinions || []).filter(o => o.adopt && o.adopt !== 'suspend');
  const strongest = ops.sort((a, z) => ((GR[z.grade] || 0) - (GR[a.grade] || 0)) || ((z.confidence || 0) - (a.confidence || 0)))[0];
  const body = strongest ? `${strongest.name || strongest.officer}案：${strongest.reason}` : '';
  let tail;
  if (v.verdict === 'human') tail = `今人工裁定從${ADOPT[v.adopt] || v.adopt}${v.humanNote ? `（${v.humanNote}）` : ''}。`;
  else if (v.verdict === 'suspended') tail = '諸說未一，姑兩存之，俟考。';
  else if (v.adopt === 'shanben') tail = '今仍底本之舊，不改。';
  else if (v.adopt === 'xiandai') tail = `今從今本${v.xiandai ? `作「${v.xiandai}」` : ''}。`;
  else tail = '兩存之。';
  return head + (body ? body : '') + tail;
}

function exportAll(result, workId) {
  const dir = outDir(workId);
  const { shanben, xiandai } = loadWork(workId);
  const sb = buildShanbenPunctuated(result);
  const xd = buildXiandaiText(xiandai);
  const variants = result.variants || [];
  const clusters = result.clusters || [];
  const verdicts = result.verdicts || [];
  const vmap = {}; verdicts.forEach(v => vmap[v.diffId] = v);
  const verifs = loadVerifications(workId);
  const vfmap = {}; verifs.forEach(x => vfmap[x.id] = x);
  const fixLogPath = path.join(dir, 'basefix-log.json');
  const fixLog = fs.existsSync(fixLogPath) ? JSON.parse(fs.readFileSync(fixLogPath, 'utf8')) : [];

  // ── 善本点校本（公开）──
  const shanbenMd = [
    `# ${result.work.title} · 善本点校本`,
    '',
    `> 底本：${shanben.title}（${shanben.role === 'shanben' ? '公开善本' : ''}，${shanben.level} 级，可公开传播）。`,
    `> 句读由本系统点校；resolved 与人工裁定异文以夹注附。经注分栏见 善本点校本-分栏.md（版面结构先行产物）。`,
    '',
    sb.text,
    '',
  ].join('\n');
  write(path.join(dir, 'output', '善本点校本.md'), shanbenMd);

  // ── 现代本（自用）──
  const suspended = verdicts.filter(v => v.verdict === 'suspended');
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
      `- 所在句：${segTextOf(v) || '—'}`,
      `- 悬置原因：${(v.suspendReasons || []).join('；') || '—'}`,
      `- 暂拟倾向：${ADOPT[v.tentative] || v.tentative || 'neither'}`,
      ...v.opinions.map(o => `  - **${o.name || o.officer}**（${o.adopt}·${o.grade || '—'}${o.confidence ? `·信${(o.confidence * 10).toFixed(0)}/10` : ''}）：${o.reason}${o.线索 ? `〔线索：${o.线索}〕` : ''}`),
    ].join('\n')),
    '',
  ].join('\n');
  write(path.join(dir, 'output', '现代本.md'), xiandaiMd);

  // ── 校勘记（环节出处汇总）──
  const charRows = variants.filter(v => v.type !== '异体').map(v => {
    const r = vmap[v.id];
    const verdict = r ? (r.verdict === 'human' ? '人工' : r.verdict) : '待裁';
    const adopt = r && r.adopt ? (ADOPT[r.adopt] || r.adopt) : (r && r.tentative ? '暂拟' + (ADOPT[r.tentative] || r.tentative) : '');
    const why = r ? (r.verdict === 'suspended' ? (r.suspendReasons || []).join('；') : composeNote(r)) : '';
    return `| ${v.id} | ${v.type} | ${v.shanben || '∅'} | ${v.xiandai || '∅'} | ${segTextOf(v).slice(0, 22)} | ${verdict} | ${adopt} | ${why} |`;
  });
  const clusterRows = [], noiseRows = [], fixRows = [];
  for (const c of clusters) {
    const vf = vfmap[c.id];
    const r = vmap[c.id];
    const base = `| ${c.id} | ${c.kind} | ${(c.shanben || '∅').slice(0, 18)} | ${(c.xiandai || '∅').slice(0, 18)} | ${c.sbPages.join('/') || '—'} | ${c.xdPage || '—'} |`;
    if (!vf) {
      clusterRows.push(`${base} 待核 | — | — |`);
    } else if (vf.verdict === '真异文') {
      const verdict = r ? (r.verdict === 'human' ? '人工' : r.verdict) : '待裁';
      const adopt = r && r.adopt ? (ADOPT[r.adopt] || r.adopt) : (r && r.tentative ? '暂拟' + (ADOPT[r.tentative] || r.tentative) : '');
      clusterRows.push(`${base} 真异文（${vf.engine}${typeof vf.conf === 'number' ? ' ' + vf.conf.toFixed(2) : ''}） | ${verdict} | ${adopt} |`);
    } else if (vf.verdict === '善本底本误') {
      fixRows.push(`${base} 善本实印「${vf.sbActual || '?'}」（${vf.engine}） | ⚠待回修：${vf.note || ''} |`);
    } else {
      noiseRows.push(`${base} ${vf.verdict}（${vf.engine}） | ${vf.note || ''} |`);
    }
  }
  const yitiRows = variants.filter(v => v.type === '异体')
    .map(v => `| ${v.id} | ${v.shanben} | ${v.xiandai} | ${segTextOf(v).slice(0, 30)} |`);
  const nChar = variants.filter(v => v.type !== '异体').length;
  const vs = result.verdictSummary || {};
  const jiaoji = [
    `# ${result.work.title} · 校勘记`,
    '',
    `> 字级异文 ${nChar + yitiRows.length} 条（真异文 ${result.summary?.真异文 || 0} / ocr疑 ${result.summary?.ocr疑 || 0} / 异体 ${yitiRows.length}）；夺衍换簇 ${clusters.length} 个（真 ${verifs.filter(x => x.verdict === '真异文').length} / 噪声 ${noiseRows.length} / 底本已修 ${fixLog.length} 待修 ${fixRows.length} / 待核 ${clusters.length - verifs.length}）。`,
    `> 校书官：resolved ${vs.resolved || 0}，suspended ${vs.suspended || 0}，人工裁定 ${verdicts.filter(v => v.verdict === 'human').length}（engine: ${vs.engine}）。`,
    `> 体例：每条带环节出处——发现于对校（P4），核验于 P4.5（引擎+置信），裁决于校书官（加权+悬置三规则）或人工（精校台）。`,
    '',
    '## 一、真异文（字级 · 校书官裁决）',
    '',
    '| 编号 | 类型 | 善本 | 现代本 | 所在句(现代本) | 裁决 | 采纳 | 理据/悬置原因 |',
    '|---|---|---|---|---|---|---|---|',
    ...(charRows.length ? charRows : ['| — | — | — | — | 无 | — | — | — |']),
    '',
    '## 二、夺·衍·换（簇级 · P4.5 双侧视觉核验）',
    '',
    '| 编号 | 类 | 善本 | 现代本 | 善页 | 今页 | 核验 | 裁决 | 采纳 |',
    '|---|---|---|---|---|---|---|---|---|',
    ...(clusterRows.length ? clusterRows : ['| — | — | — | — | — | — | 无 | — | — |']),
    '',
    '## 三、异体（存古，不裁）',
    '',
    '| 编号 | 善本 | 现代本 | 所在句(现代本) |',
    '|---|---|---|---|',
    ...(yitiRows.length ? yitiRows : ['| — | — | — | 无 |']),
    '',
    '## 四、善本底本修复记录（P4.5 发现 → 回修 shanben-v2）',
    '',
    '已回修（永久留档）：',
    '',
    '| 页 | 底本误作 | 善本实印（已改） | 依据 |',
    '|---|---|---|---|',
    ...(fixLog.length ? fixLog.map(f => `| p${f.page} | ${f.before}【${f.wrong || '∅'}】 | 【${f.right || '∅'}】 | ${f.engine}：${(f.note || '').slice(0, 40)} |`) : ['| — | 无 | — | — |']),
    '',
    '待回修 / 需人工：',
    '',
    '| 编号 | 类 | 善本(底本) | 现代本 | 善页 | 今页 | 核验 | 备注 |',
    '|---|---|---|---|---|---|---|---|',
    ...(fixRows.length ? fixRows : ['| — | — | — | — | — | — | 无 | — |']),
    '',
    '## 附录A · 已核验噪声（留痕，不入正文异文）',
    '',
    '| 编号 | 类 | 善本侧 | 现代本侧 | 善页 | 今页 | 归类 | 备注 |',
    '|---|---|---|---|---|---|---|---|',
    ...(noiseRows.length ? noiseRows : ['| — | — | — | — | — | — | 无 | — |']),
    '',
    '## 附录B · 定论体例（resolved + 人工裁定）',
    '',
    ...verdicts.filter(v => v.verdict === 'resolved' || v.verdict === 'human').map(v => `- ${v.diffId} ${composeNote(v)}`),
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
  write(path.join(dir, 'clusters.json'), JSON.stringify(clusters, null, 2));
  write(path.join(dir, 'verdicts.json'), JSON.stringify(verdicts, null, 2));

  // ── P7 人工精校台（单文件离线 HTML）──
  let reviewInfo = '';
  try {
    const payload = review.buildPayload(result, workId);
    const images = review.collectImages(workId, payload.cases.filter(c => c.suspended));
    write(path.join(dir, 'output', '精校台.html'), review.buildReviewApp(payload, images));
    reviewInfo = ` + 精校台.html（悬置 ${payload.cases.filter(c => c.suspended).length} 条，书影 ${Object.keys(images).length} 页）`;
  } catch (e) {
    reviewInfo = `（精校台生成失败：${e.message}）`;
  }

  // ── flags.yaml（P7 人工待办，纯文本兜底）──
  const flags = [
    ...suspended.map(v => ({
      id: v.diffId, kind: 'suspended', desc: `善「${v.shanben || '∅'}」/今「${v.xiandai || '∅'}」(${v.type})`,
      reasons: (v.suspendReasons || []).join('；'),
      tentative: v.tentative, seg: segTextOf(v), officers: v.opinions.map(o => `${o.name || o.officer}:${o.adopt}`),
    })),
    ...variants.filter(v => v.type === 'ocr疑').map(v => ({
      id: v.id, kind: 'ocr疑', desc: `善「${v.shanben || '∅'}」疑误读，今「${v.xiandai || '∅'}」`, reconfirm: v.reconfirm?.status || 'deferred',
    })),
    ...fixRows.length ? [{ id: 'base-fix', kind: '善本底本误', desc: `${fixRows.length} 簇核验为底本误，回修 shanben-v2 后重跑对齐对校` }] : [],
  ];
  write(path.join(dir, 'flags.yaml'), YAML.stringify({ work: workId, count: flags.length, flags }, null, 2));

  return { dir, shanbenResolved: sb.resolvedCount, variantCount: variants.length, clusterCount: clusters.length, suspended: suspended.length, flagsCount: flags.length, reviewInfo };
}

module.exports = { exportAll, outDir, composeNote };
