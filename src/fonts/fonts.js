/**
 * 字体登记与策略：
 *  - A 级（开源协议）：构建时子集化为 woff2 随站点分发（@font-face 嵌入）
 *  - B 级（免费商用但限制嵌入）：仅以 local() 引用访客本机字体 + 本机渲染出图，字体文件不分发
 *  - 无文件：使用作品 meta.fallbackStacks 中的系统回退链
 */
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const ROOT = path.join(__dirname, '..', '..');
const REGISTRY_PATH = path.join(__dirname, 'fonts.yaml');

function loadRegistry() {
  const doc = YAML.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  return doc.fonts || {};
}

/** 判断字体文件是否已就位 */
function fontFileOf(entry) {
  if (!entry.file) return null;
  const p = path.join(ROOT, entry.file);
  return fs.existsSync(p) ? p : null;
}

/**
 * 单轨字面解析：font（A 级嵌入或 B 级 local）+ fontLocal（B 级本机出图字体，local() 栈前置）。
 * 繁体轨（faces）与简体轨（facesSc / 遗留镜像）共用。
 * @returns {{stack:string, faceCss:string, files:Array}}
 */
function resolveTrackFace(faceConf, fallback, registry, distWorkDir, warnings) {
  const fontId = faceConf.font;
  const entry = fontId && registry[fontId];

  if (!entry || entry.status === '待选型') {
    return { stack: fallback, faceCss: '', files: [] };
  }
  const file = fontFileOf(entry);
  if (!file) {
    warnings.push(`字体「${entry.name}」(${fontId}) 文件未就位（${entry.file || '未配置文件路径'}），本角色使用系统回退链`);
    return { stack: fallback, faceCss: '', files: [] };
  }

  let faceCss = '';
  const stackParts = [];

  // B 级本机出图字体（fontLocal）：以 bare family name 栈前置（本机有则用真行书）。
  // 不注入 local-only @font-face——访客端 local 不命中会进入 error 状态，
  // 阻塞 stack 后续 url() 字体（如 A 级 woff2）的自动加载；
  // 出图端由 resolveExportFaces 注入含 url(file://) 的 @font-face 兑底。
  if (faceConf.fontLocal) {
    const le = registry[faceConf.fontLocal];
    const lf = le && fontFileOf(le);
    if (le && lf && le.license === 'B' && !le.allowEmbed) {
      stackParts.push(`"${le.family}"`);
    } else if (le && !lf) {
      warnings.push(`本机出图字体「${le.name}」(${faceConf.fontLocal}) 文件未就位，跳过 local() 注入`);
    }
  }

  // 主字体
  const family = `"${entry.family}"`;
  const files = [];
  if (entry.license === 'A' && entry.allowEmbed) {
    // 子集由构建前置步骤产出：dist/works/<id>/fonts/<fontId>.woff2。
    // 以源文件就位为准（而非探测 dist 产物）：首构建时子集在同序稍早生成，探测会落空
    faceCss += `@font-face{font-family:"${entry.family}";src:url("fonts/${fontId}.woff2") format("woff2");font-display:swap;}`;
    const woff2 = path.join(distWorkDir, 'fonts', fontId + '.woff2');
    if (fs.existsSync(woff2)) files.push(woff2);
  } else if (entry.license === 'B' && !entry.allowEmbed) {
    // 仅 local() 引用，不分发字体文件
    const locals = [`local("${entry.family}")`];
    if (entry.familyLocal) locals.push(`local("${entry.familyLocal}")`);
    faceCss += `@font-face{font-family:"${entry.family}";src:${locals.join(',')};font-display:swap;}`;
  }
  stackParts.push(family);
  stackParts.push(fallback);

  return { stack: stackParts.join(','), faceCss, files };
}

/**
 * 简体轨角色表：meta.facesSc 已定义则原样采用（与繁体轨完全独立的角色列表）；
 * 未定义则遗留镜像——繁体轨角色逐一镜像，font 取旧 sc 字段作种子，现有作品零迁移。
 */
function scRolesOf(meta) {
  if (meta.facesSc) {
    return Object.entries(meta.facesSc).map(([id, conf]) => ({ id, conf: conf || {} }));
  }
  return Object.entries(meta.faces || {}).map(([id, conf]) => ({
    id, conf: { font: conf && conf.sc, label: conf && conf.label },
  }));
}

/** 简体轨回退链：fallbackStacksSc 按角色 id 优先，次取同名繁体轨链，兜底 serif */
function scFallbackOf(meta, id) {
  return (meta.fallbackStacksSc && meta.fallbackStacksSc[id]) ||
    (meta.fallbackStacks && meta.fallbackStacks[id]) || 'serif';
}

/**
 * 解析简体轨全部角色：各角色 font-family 栈与附加 CSS + 默认角色（defaultSc，缺省首项）。
 * @returns {{roles:Array<{id:string, label:string, stack:string, faceCss:string, files:Array}>, def:string, warnings:string[]}}
 */
function resolveScFaces(meta, registry, distWorkDir) {
  const warnings = [];
  const roles = scRolesOf(meta).map(({ id, conf }) => ({
    id, label: conf.label || id,
    ...resolveTrackFace(conf, scFallbackOf(meta, id), registry, distWorkDir, warnings),
  }));
  const def = (meta.defaultSc && roles.some((r) => r.id === meta.defaultSc)) ? meta.defaultSc : (roles[0] && roles[0].id);
  return { roles, def, warnings };
}

/**
 * 解析某作品繁体轨角色（song/jing/xing）的最终 font-family 栈与附加 CSS。
 * 双轨：font（主字体，A 级嵌入或 B 级 local）+ fontLocal（B 级本机出图字体，local() 栈前置）。
 * @returns {{stack:string, faceCss:string, files:Array, warnings:string[]}}
 *   files: 需拷入 dist 的 woff2 子集文件（由 subset.js 预先构建）
 */
function resolveFace(role, meta, registry, distWorkDir) {
  const warnings = [];
  const faceConf = (meta.faces && meta.faces[role]) || {};
  const r = resolveTrackFace(faceConf, meta.fallbackStacks[role], registry, distWorkDir, warnings);
  return { ...r, warnings };
}

/**
 * 出图模式（JPG/PDF）追加注入：B 级字体以 file:// 加载本地源文件，
 * 使未安装该字体的出图机也能渲染（不进 dist，仅本机渲染用）。
 * 覆盖两类：各角色主字体（font）与本机出图字体（fontLocal），同为 B 级禁嵌入者。
 */
function resolveExportFaces(meta, registry) {
  const faces = meta.faces || {};
  let css = '';
  const seen = new Set();
  const inject = (fontId) => {
    if (!fontId || seen.has(fontId)) return;
    seen.add(fontId);
    const le = registry[fontId];
    if (!le || le.license !== 'B' || le.allowEmbed) return;
    const lf = fontFileOf(le);
    if (!lf) return;
    const fileUrl = 'file://' + lf.replace(/\\/g, '/');
    const locals = [`local("${le.family}")`];
    if (le.familyLocal) locals.push(`local("${le.familyLocal}")`);
    css += `@font-face{font-family:"${le.family}";src:${locals.join(',')},url("${fileUrl}") format("truetype");font-display:swap;}`;
  };
  for (const fc of Object.values(faces)) {
    inject(fc.font);
    inject(fc.fontLocal);
  }
  return css;
}

/** 登记表校验：授权信息完备性 */
function validateRegistry(registry) {
  const problems = [];
  for (const [id, f] of Object.entries(registry)) {
    if (!['A', 'B', 'C'].includes(f.license)) problems.push(`字体 ${id}: license 须为 A/B/C`);
    if (!f.licenseName) problems.push(`字体 ${id}: 缺 licenseName`);
    if (f.license !== 'A' && f.allowEmbed) problems.push(`字体 ${id}: 非 A 级却 allowEmbed=true，请核实授权`);
    if (f.status !== '待选型' && !f.source) problems.push(`字体 ${id}: 缺来源链接 source`);
  }
  return problems;
}

module.exports = { loadRegistry, resolveFace, resolveScFaces, scRolesOf, resolveExportFaces, validateRegistry, fontFileOf, REGISTRY_PATH };
