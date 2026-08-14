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
const { extractJSON } = require('./llm');

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
        { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
      ] }],
    }),
  });
  const txt = await res.text();
  if (!res.ok) return { err: `${res.status} ${txt.slice(0, 200)}` };
  const j = JSON.parse(txt);
  return { text: j.choices?.[0]?.message?.content || '' };
}

/** 从模型输出取 JSON（对象或数组） */
/** 多 key 轮询（DASHSCOPE_API_KEY 支持逗号分隔多个，供并行分摊限流） */
let _keyIdx = 0;
function getKey(cfg) {
  const raw = process.env[cfg.vision.keyEnv];
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
版式按字形大小分两类，请严格按【字的大小和每列行数】判断，不要按文字内容判断：
- 经文：字**大**，每列是**单行**（一列只有一竖行字，字数较少）。
- 注文：字**小**（约为经字一半高），每列是**双行**（一列拆成左右并排的两个短行，字数较多、字明显小）。
请按自右向左逐列识别，输出每列：列序(自右1起)、识别出的汉字 text、类型 type（"j"=经文大字单行 / "z"=注文小字双行）、置信度 conf(0-1)。
只输出严格 JSON 数组，形如 [{"col":1,"text":"……","type":"j","conf":0.9}]，不要任何解释文字。`;
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

module.exports = { loadVisionConfig, renderPage, review, judgeJZ, verifyChar, ocrPage, callVision };
