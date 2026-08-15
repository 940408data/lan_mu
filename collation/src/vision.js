/**
 * collation · 视觉模型客户端（src/vision.js）
 * 两角色：初校（基本验证，快/广/省）/ 覆校（升级详定，强/精/贵）。
 *   角色名固定，底层模型可迭代（见 config/vision.yaml）。
 *   路由：默认先初校；置信 < threshold → 升级覆校复判；无 key → mock(deferred)。
 *
 * 两类视觉任务：
 *   judgeJZ(pageB64)     经注大小学判定（第一层）：逐列判 经(j大字单行)/注(z小字双行)
 *   verifyChar(pageB64, ocrChar, altChar, context)  OCR 误字复核（第三层）：善本实印何字
 *
 * 边界：只答"实印何字/该列经还是注"（读图）；不裁决"该用哪个字"（归校书官/人）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const YAML = require('yaml');
const { extractJSON, resolveApiKey } = require('./llm');

const CFG_PATH = path.join(__dirname, '..', 'config', 'vision.yaml');
function loadVisionConfig() {
  return YAML.parse(fs.readFileSync(CFG_PATH, 'utf8'));
}

/** 善本页 PDF → PNG（pdftoppm 单页）→ base64。返回 {b64, file}，用完可清理。 */
function renderPage(pdfPath, pageN, dpi) {
  const cfg = loadVisionConfig();
  const d = dpi || cfg.vision.render.dpi;
  const tmp = fs.mkdtempSync('/tmp/vpage-');
  const prefix = path.join(tmp, 'p');
  execSync(`pdftoppm -png -r ${d} -f ${pageN} -l ${pageN} ${JSON.stringify(pdfPath)} ${JSON.stringify(prefix)}`);
  const png = fs.readdirSync(tmp).find(f => f.endsWith('.png'));
  const file = path.join(tmp, png);
  const b64 = fs.readFileSync(file).toString('base64');
  return { b64, file };
}

/** 调百炼兼容端点（多模态）。对齐 /root/guji_ocr/ocr_dianjiao_original_only.py：
 *  temperature:0.3、max_tokens:8192；enable_thinking 按任务开关（关思考快 5.7×，纯 OCR 用之）。 */
async function callVision(model, b64, prompt, key, endpoint, thinking) {
  const imgs = (Array.isArray(b64) ? b64 : [b64]).map(b => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${b}` } }));
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: 8192,
      extra_body: { enable_thinking: thinking !== false },
      messages: [{ role: 'user', content: [
        { type: 'text', text: prompt },
        ...imgs,
      ] }],
    }),
  });
  const txt = await res.text();
  if (!res.ok) return { err: `${res.status} ${txt.slice(0, 200)}` };
  const j = JSON.parse(txt);
  return { text: j.choices?.[0]?.message?.content || '' };
}

/** 从模型输出取 JSON（对象或数组） */
/** 多 key 轮询（DASHSCOPE_API_KEY 支持逗号分隔多个，供并行分摊限流）。key 经 resolveApiKey 解析（env 或 ~/.bashrc），无需命令行注入。 */
let _keyIdx = 0;
function getKey(cfg) {
  const raw = resolveApiKey(cfg.vision.keyEnv);
  if (!raw) return null;
  const keys = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (!keys.length) return null;
  return keys[(_keyIdx++) % keys.length];
}

function pickJSON(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1];
  const ai = text.indexOf('['), aj = text.lastIndexOf(']');
  const oi = text.indexOf('{'), oj = text.lastIndexOf('}');
  try {
    if (ai >= 0 && aj > ai && (oi < 0 || ai < oi)) return JSON.parse(text.slice(ai, aj + 1));
    if (oi >= 0 && oj > oi) return JSON.parse(text.slice(oi, oj + 1));
  } catch { return null; }
  return null;
}

/** 取整体置信度：数组取均值、对象取 .conf */
function getConf(obj) {
  if (!obj) return null;
  if (Array.isArray(obj)) {
    const cs = obj.map(x => x && x.conf).filter(c => typeof c === 'number');
    return cs.length ? cs.reduce((a, b) => a + b, 0) / cs.length : null;
  }
  return typeof obj.conf === 'number' ? obj.conf : null;
}

/** 初校→覆校 路由：默认初校；conf<threshold 升级覆校；无 key → mock。thinking 按 label 从配置读。 */
async function review(b64, prompt, label) {
  const cfg = loadVisionConfig();
  const key = getKey(cfg);
  if (!key) return { engine: 'mock', deferred: true, reason: '无 ' + cfg.vision.keyEnv };
  const models = cfg.vision.models;
  const thinking = (cfg.vision.thinking && label in cfg.vision.thinking) ? cfg.vision.thinking[label] : true;
  // 初校
  let r = await callVision(models.first, b64, prompt, key, cfg.vision.endpoint, thinking);
  if (r.err) return { engine: '初校(' + models.first + ')', err: r.err };
  let obj = pickJSON(r.text), conf = getConf(obj);
  if (obj !== null && conf !== null && conf >= cfg.vision.threshold) {
    return { engine: '初校(' + models.first + ')', obj, conf, role: cfg.vision.roles.first, thinking };
  }
  // 覆校升级（初校置信低或解析失败）
  r = await callVision(models.deep, b64, prompt, key, cfg.vision.endpoint, thinking);
  if (r.err) return { engine: '覆校(' + models.deep + ')', err: r.err, note: '初校后升级' };
  obj = pickJSON(r.text); conf = getConf(obj);
  return { engine: '覆校(' + models.deep + ')', obj, conf, role: cfg.vision.roles.deep, thinking, note: '初校置信低，升级覆校' };
}

/** 第一层：经注大小学判定 */
function jzPrompt(bookTitle) {
  return `这是南宋当涂郡斋刊递修本《${bookTitle}》一页古籍扫描，竖排，自右向左。
这页的每个竖列只属两类之一，判断时**先数清这一列里有几行字**，不要按文字内容猜：
- 经文(j)：一个竖列里**只有 1 行字**，字**大**、笔画粗、字距宽。
- 注文(z)：一个竖列里**并排挤着 2 行小字**（左一行右一行并列），字**明显小**（约为经字一半高）、笔画细、字密。
请自右向左逐列看，先数该行数（1 行大字 / 2 行小字），再定 type（"j"=经文大字单行，"z"=注文小字双行）。
输出每列：列序(自右1起)、识别汉字 text、type、conf(0-1)。
只输出严格 JSON 数组：[{"col":1,"text":"……","type":"j","conf":0.9}]，不要任何解释文字。`;
}
async function judgeJZ(b64, bookTitle) {
  return review(b64, jzPrompt(bookTitle), 'jz');
}

/** 第三层：OCR 误字复核（善本实印何字） */
function verifyCharPrompt(context, ocrChar, altChar) {
  return `这是南宋当涂郡斋刊递修本一页古籍扫描，竖排自右向左。
其中一句上下文为：「${context}」
某字 OCR 识为「${ocrChar || '？'}」，现代点校本作「${altChar || '？'}」。
请仔细看图，回答：该处善本实际印的是什么字？
只输出严格 JSON 对象：{"char":"实字","conf":0.9,"note":"一句理由"}，不要解释文字。`;
}
async function verifyChar(b64, context, ocrChar, altChar) {
  return review(b64, verifyCharPrompt(context, ocrChar, altChar), 'verify');
}

/** 第三层·批量：一页多个差异点一次问（省 API）。items:[{old,vis,ctx}] → [{i,char,conf,note}] */
function verifyCharsPrompt(items) {
  const list = items.map((it, i) => `${i + 1}. 上下文「${(it.ctx || '').slice(0, 18)}」，OCR作「${it.old}」，现代本作「${it.vis}」`).join('\n');
  return `这是南宋当涂郡斋刊递修本一页古籍扫描，竖排自右向左。以下 ${items.length} 处 OCR 与现代点校本用字不一，请逐一对照扫描图，确认善本实际印的是哪个字：\n${list}\n只输出严格 JSON 数组（每项对一处）：[{"i":1,"char":"善本实字","conf":0.9,"note":"一句理由"}]，不要解释文字。`;
}
async function verifyChars(b64, items) {
  return review(b64, verifyCharsPrompt(items), 'verify');
}

/** 版面结构抽样（方法论核心·先行）：视觉 Agent 分析善本版面网格，不看文字内容。
 *  产出该书版面结构（列×行、每格字数、有无双行夹注、经注的顶格/退格规则、版心鱼尾），
 *  供推导经注规则 + 后续网格转写/复原排版。每书版面不同，须逐书先抽样。 */
function layoutProbePrompt() {
  return `这是一页古籍扫描（竖排，自右向左）。请不要翻译文字内容，只分析它的**版面物理结构**：
1. 这一页（一个版面）从右到左共几列？每列从上到下共几行？（即网格是几列 × 几行）
2. 每个格网里是 1 个字，还是有并排的两个小字（双行夹注）？
3. 每列文字从第几行开始？是顶格（最上一行）开始，还是退格（空一至两格）开始？
4. 经文（正文大字）和注文（注释）各用哪种起始方式（顶格 / 退一格 / 退两格）？
5. 版心（中缝）有没有鱼尾、书题、页码等标记？
只输出严格 JSON 对象：{"cols":数字,"rows":数字,"charPerCell":1或2,"hasDoubleSmall":true或false,"jingStart":"顶格/退一格/退两格","zhuStart":"顶格/退一格/退两格","note":"其他版面特征"}，不要解释文字。`;
}
async function layoutProbe(b64) {
  return review(b64, layoutProbePrompt(), 'layout');
}

/** 网格转写：按版面网格输出每个字的位置（row,col,char,格位起始）——判经注 + 复原排版两用。 */
function gridTranscribePrompt(layout) {
  const { cols, rows } = layout || {};
  const grid = (cols && rows) ? `${cols} 列 × ${rows} 行` : '若干列 × 若干行';
  return `这是一页古籍扫描（竖排自右向左），其版面为 ${grid} 的网格，每格一字。
请按网格逐格转写：自右向左为列（col 从 1 起），自上而下为行（row 从 1 起）。
每格输出：col（列号）、row（行号）、char（该格的汉字）、start（该列文字起始位置："顶格"/"退一格"/"退两格"，仅每列第一字需标）。
空格（无字的格）用 char:"" 表示。
只输出严格 JSON 数组：[{"col":1,"row":1,"char":"大","start":"顶格"},{"col":1,"row":2,"char":"學"},...]，不要解释文字。`;
}
async function gridTranscribe(b64, layout) {
  return review(b64, gridTranscribePrompt(layout), 'layout');
}

/** 列级版面判定（轻量，判经注用）：只判每列起始（顶格/退格），文字取自已验证的干净底本。
 *  比逐格转写快得多；判经注只需列起始。逐格转写(gridTranscribe)留作复原排版专项。 */
function gridColumnsPrompt(layout) {
  const { cols, rows } = layout || {};
  return `这是一页古籍扫描（竖排自右向左），版面为 ${cols || 16} 列 × ${rows || 15} 行网格，每格一字。
对每一列（自右向左 col 从 1 起），输出三项：
- col：列号（自右 1 起）
- start：该列文字从哪行开始——"顶格"（第1行/最上起，对应经文）/"退一格"/"退两格"（空格后起，对应注文）
- text：该列全部汉字，自上而下连续照录（无字的空格不计）
只输出严格 JSON 数组（每列一项）：[{"col":1,"start":"顶格","text":"……"},{"col":2,"start":"退一格","text":"……"},...]，不要解释文字。`;
}
async function gridColumns(b64, layout) {
  return review(b64, gridColumnsPrompt(layout), 'layout');
}

/** 纯 OCR 整页原文照录（对齐 guji_ocr 脚本，关思考保速度）——可替代/补充善本旧 OCR */
function ocrPrompt() {
  return `你是一位精通古籍识别的资深学者。请对图片中的古籍页面进行严格的原文照录：
1. 准确识别所有文字（正文、旁注、夹注、页眉页脚），保持繁体字形，绝不转简体。
2. 原文有标点照录，无标点绝不添加；原样照录，不增不减。
3. 保持原板式行款：每行写到哪里就换行到哪里；段落、缩进、空行一律照录。
4. 模糊难辨的字在其后用〔？〕标注。
5. 双行小注/夹注保持原格式照录；旁注照录原位置。
仅输出原文，不要任何说明、标题或 markdown 围栏。`;
}
async function ocrPage(b64) {
  // 纯 OCR 输出为纯文本（非 JSON），不走 review 的 JSON 判定路由；初校一次即可
  const cfg = loadVisionConfig();
  const key = getKey(cfg);
  if (!key) return { engine: 'mock', deferred: true, reason: '无 ' + cfg.vision.keyEnv };
  const thinking = cfg.vision.thinking ? cfg.vision.thinking.ocr : false;
  const r = await callVision(cfg.vision.models.first, b64, ocrPrompt(), key, cfg.vision.endpoint, thinking);
  if (r.err) return { engine: '初校(' + cfg.vision.models.first + ')', err: r.err };
  return { engine: '初校(' + cfg.vision.models.first + ')', role: cfg.vision.roles.first, text: r.text, thinking };
}

module.exports = { loadVisionConfig, renderPage, review, judgeJZ, verifyChar, verifyChars, ocrPage, layoutProbe, gridTranscribe, gridColumns, callVision, getKey, pickJSON, getConf };
