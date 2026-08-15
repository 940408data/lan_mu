/**
 * collation · P6 双本出具 + P7 精校台/flags（src/export.js）
 * 入参：adjudicate() 全量结果（含 align/diff/clusters/verdicts）→ 写出
 *   data/<书>/output/善本点校本.md   （公开）
 *   data/<书>/output/校勘记.md       （公开；字级真异文 + 簇级夺衍换 + 异体 + 底本修复 + 噪声附录）
 *   data/<书>/punctuated.json + quality-report.json（公开善本结构与质量摘要）
 *   input_data/<书>/_derived/collation/output/现代本.md、精校台.html（私有）
 *   input_data/<书>/_derived/collation/{aligned,diffs,clusters,verdicts}.json + flags.yaml（私有）
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
const { publicWorkDir, privateWorkDir, privatePath, internalReadPath } = require('./paths');
const { buildQualityReport } = require('./quality');
const { loadM2Base } = require('./base');

function outDir(workId) {
  return publicWorkDir(workId);
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
  let tail;
  if (v.verdict === 'human') tail = `今人工裁定從${ADOPT[v.adopt] || v.adopt}${v.humanNote ? `（${v.humanNote}）` : ''}。`;
  else if (v.verdict === 'suspended') tail = '諸說未一，姑兩存之，俟考。';
  else if (v.adopt === 'shanben') tail = '機器初判仍底本之舊，待人工覆核。';
  else if (v.adopt === 'xiandai') tail = `機器初判從今本${v.xiandai ? `作「${v.xiandai}」` : ''}，待人工覆核。`;
  else tail = '機器初判兩存，待人工覆核。';
  return head + tail;
}

function exportAll(result, workId) {
  const dir = outDir(workId);
  const privateDir = privateWorkDir(workId);
  const { shanben, xiandai } = loadWork(workId);
  const m2 = loadM2Base(workId);
  const baselineSb = buildShanbenPunctuated(result);
  let sb = baselineSb;
  const punctuationFile = privatePath(workId, 'punctuation-llm.json');
  if (fs.existsSync(punctuationFile)) {
    try {
      const proposal = JSON.parse(fs.readFileSync(punctuationFile, 'utf8'));
      if (proposal.sourceHash === baselineSb.sourceHash && proposal.approved && proposal.decisions) {
        sb = buildShanbenPunctuated(result, { decisions: proposal.decisions });
      }
    } catch (e) {
      // 标点建议损坏或 hash 不匹配时回退基础标点，不阻塞其他公开产物。
    }
  }
  if (!result.cleaned || !result.cleaned.xiandai) throw new Error('P6 出具必须由 P1.5 清洗结果驱动');
  const cleanBlockers = [
    ...(result.cleaned.shanben.quality?.blockers || []),
    ...(result.cleaned.xiandai.quality?.blockers || []),
  ];
  if (cleanBlockers.length) throw new Error(`P1.5 清洗质量闸未通过：${cleanBlockers.join('；')}`);
  const xd = buildXiandaiText(result.cleaned.xiandai);
  const qualityReport = buildQualityReport(result);
  const fullReviewFile = privatePath(workId, 'full-review.json');
  if (fs.existsSync(fullReviewFile)) {
    try {
      const fullReview = JSON.parse(fs.readFileSync(fullReviewFile, 'utf8'));
      qualityReport.fullReview = {
        schemaVersion: fullReview.schemaVersion,
        status: fullReview.scores?.status || null,
        contentScore: fullReview.scores?.content ?? null,
        modelScore: fullReview.scores?.model ?? null,
        modelConcernScore: fullReview.scores?.modelConcern ?? null,
        findingCount: Array.isArray(fullReview.findings) ? fullReview.findings.length : 0,
        blockerCount: Array.isArray(fullReview.findings) ? fullReview.findings.filter(x => x.severity === 'blocker').length : 0,
        highCount: Array.isArray(fullReview.findings) ? fullReview.findings.filter(x => x.severity === 'high').length : 0,
        source: fullReview.source || null,
      };
    } catch {}
  }
  const variants = result.variants || [];
  const clusters = result.clusters || [];
  const verdicts = result.verdicts || [];
  const vmap = {}; verdicts.forEach(v => vmap[v.diffId] = v);
  const verifs = loadVerifications(workId);
  const vfmap = {}; verifs.forEach(x => vfmap[x.id] = x);
  const fixLogPath = internalReadPath(workId, 'basefix-log.json');
  const fixLog = fs.existsSync(fixLogPath)
    ? JSON.parse(fs.readFileSync(fixLogPath, 'utf8')).filter(x => x.baseSha256 === m2.sha256)
    : [];

  // ── 善本点校本（公开）──
  const shanbenMd = [
    `# ${result.work.title} · 善本点校本`,
    '',
    `> 底本：${shanben.title}（${shanben.role === 'shanben' ? '公开善本' : ''}，${shanben.level} 级，可公开传播）。`,
    `> 句读由本系统点校；正文与校勘记分层，异文裁定见《校勘记》。经注分栏见 善本点校本-分栏.md。`,
    `> 文本状态：${qualityReport.status}（${qualityReport.blockers.join('；') || '自动质量闸通过，仍须人工终校方可发布'}）。`,
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
    `> 本文件仅含 P1.5 清洗后的自用正文；脚注、校记与机器工作意见均已分层。`,
    '',
    '## 正文',
    '',
    xd,
  ].join('\n');
  write(path.join(privateDir, 'output', '现代本.md'), xiandaiMd);

  const officerMd = [
    `# ${result.work.title} · 校书官工作记录（内部）`,
    '',
    '> 以下为机器生成的研究线索，不是校勘定论，不进入正文与公开校勘记。',
    '',
    ...verdicts.map(v => [
      `### ${v.diffId} 善本「${v.shanben || '∅'}」/ 现代本「${v.xiandai || '∅'}」 (${v.type})`,
      `- 所在句：${segTextOf(v) || '—'}`,
      `- 悬置原因：${(v.suspendReasons || []).join('；') || '—'}`,
      `- 暂拟倾向：${ADOPT[v.tentative] || v.tentative || 'neither'}`,
      ...(v.opinions || []).map(o => `  - **${o.name || o.officer}**（${o.adopt}·${o.grade || '—'}${o.confidence ? `·信${(o.confidence * 10).toFixed(0)}/10` : ''}）：${o.reason}${o.线索 ? `〔线索：${o.线索}〕` : ''}`),
    ].join('\n')),
  ].join('\n') + '\n';
  write(path.join(privateDir, 'output', '校书官工作记录.md'), officerMd);

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
  ].join('\n') + '\n';
  write(path.join(dir, 'output', '校勘记.md'), jiaoji);

  // ── 中间 JSON ──
  write(path.join(privateDir, 'aligned.json'), JSON.stringify(result.segments.map(s => ({
    segId: s.segId, score: s.score, orphan: !!s.orphan,
    xiandai: s.xiandai.raw, page: s.xiandai.page,
    shanben: (s.shanben.detail || []).filter(d => d.sb).map(d => d.sb.ch).join(''),
  })), null, 2));
  write(path.join(privateDir, 'diffs.json'), JSON.stringify(variants.map(v => ({
    id: v.id, type: v.type, shanben: v.shanben, xiandai: v.xiandai, pos: v.pos, note: v.note, seg: v.seg.xiandai, ctx: v.ctx, reconfirm: v.reconfirm,
  })), null, 2));
  write(path.join(privateDir, 'clusters.json'), JSON.stringify(clusters, null, 2));
  write(path.join(privateDir, 'verdicts.json'), JSON.stringify(verdicts, null, 2));
  write(path.join(dir, 'punctuated.json'), JSON.stringify({
    schemaVersion: 1,
    work: workId,
    status: qualityReport.status,
    sourceHash: sb.sourceHash,
    punctuation: { source: sb === baselineSb ? 'deterministic' : 'llm-approved' },
    orphanCount: sb.orphanCount,
    segments: sb.segments,
  }, null, 2));
  write(path.join(dir, 'quality-report.json'), JSON.stringify(qualityReport, null, 2));

  // ── P7 人工精校台（单文件离线 HTML）──
  let reviewInfo = '';
  try {
    const payload = review.buildPayload(result, workId);
    const images = review.collectImages(workId, payload.cases.filter(c => c.suspended));
    write(path.join(privateDir, 'output', '精校台.html'), review.buildReviewApp(payload, images));
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
  write(path.join(privateDir, 'flags.yaml'), YAML.stringify({ work: workId, count: flags.length, flags }, null, 2));

  return { dir, privateDir, shanbenResolved: sb.resolvedCount, variantCount: variants.length, clusterCount: clusters.length, suspended: suspended.length, flagsCount: flags.length, reviewInfo };
}

module.exports = { exportAll, outDir, composeNote };
