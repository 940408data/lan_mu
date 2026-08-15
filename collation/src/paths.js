/** collation 公私产物路径：公开善本进 data/，含现代本连续文本的内部产物进 input_data/_derived/。 */
'use strict';

const fs = require('fs');
const path = require('path');
const { INPUT_DATA } = require('./io');

const PUBLIC_ROOT = path.join(__dirname, '..', 'data');

function publicWorkDir(workId) {
  const dir = path.join(PUBLIC_ROOT, workId);
  fs.mkdirSync(path.join(dir, 'output'), { recursive: true });
  return dir;
}

function privateWorkDir(workId) {
  const dir = path.join(INPUT_DATA, workId, '_derived', 'collation');
  fs.mkdirSync(path.join(dir, 'output'), { recursive: true });
  return dir;
}

function publicPath(workId, name) {
  return path.join(publicWorkDir(workId), name);
}

function privatePath(workId, name) {
  return path.join(privateWorkDir(workId), name);
}

/** 迁移期读取：优先私有新路径；旧分支产物仅作一次性回退。写入一律走 privatePath。 */
function internalReadPath(workId, name) {
  const current = privatePath(workId, name);
  if (fs.existsSync(current)) return current;
  return publicPath(workId, name);
}

module.exports = { PUBLIC_ROOT, publicWorkDir, privateWorkDir, publicPath, privatePath, internalReadPath };
