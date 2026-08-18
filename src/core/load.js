/**
 * 作品数据装载：works/<id>/ → WorkData
 */
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const ROOT = path.join(__dirname, '..', '..');

function readYaml(p) {
  return YAML.parse(fs.readFileSync(p, 'utf8'));
}

/** 装载一部作品的全部数据 */
function loadWork(workId) {
  const dir = path.join(ROOT, 'works', workId);
  if (!fs.existsSync(dir)) throw new Error(`作品不存在: works/${workId}`);
  const meta = readYaml(path.join(dir, 'meta.yaml'));
  const textPath = path.join(dir, 'text.yaml');
  const gridPath = path.join(dir, 'grid.yaml');
  if (!fs.existsSync(textPath) && !fs.existsSync(gridPath)) {
    throw new Error(`作品 ${workId} 缺数据源（text.yaml 或 grid.yaml 至少其一）`);
  }
  // text.yaml（重排引擎源）可缺：影刻直出（songke-facsimile）作品只有 grid.yaml
  const sections = fs.existsSync(textPath) ? (readYaml(textPath).sections || []) : [];
  const grid = fs.existsSync(gridPath) ? readYaml(gridPath) : null;
  const seals = fs.existsSync(path.join(dir, 'seals.yaml'))
    ? readYaml(path.join(dir, 'seals.yaml')).seals || [] : [];
  const ornDoc = fs.existsSync(path.join(dir, 'ornaments.yaml'))
    ? readYaml(path.join(dir, 'ornaments.yaml')) : {};
  const ornaments = ornDoc.orchids || [];
  const paperDecor = ornDoc.paperDecor || '';
  const orchidShapesPath = path.join(dir, 'assets', 'orchids.json');
  const orchidShapes = fs.existsSync(orchidShapesPath)
    ? JSON.parse(fs.readFileSync(orchidShapesPath, 'utf8')).shapes : [];
  const scanPath = path.join(dir, 'assets', 'scan.jpg');
  return {
    id: workId, dir, meta, sections, grid, seals, ornaments, orchidShapes, paperDecor,
    scan: fs.existsSync(scanPath) ? scanPath : null,
  };
}

/** 列出全部作品 id */
function listWorks() {
  const dir = path.join(ROOT, 'works');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'meta.yaml')))
    .map((d) => d.name);
}

module.exports = { loadWork, listWorks, ROOT };
