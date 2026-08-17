/** M2 善本终态底本的读取与指纹校验。下游不得静默回退旧 OCR。 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_ROOT = path.join(__dirname, '..', 'data');

function basePath(workId) {
  return path.join(DATA_ROOT, workId, 'shanben-v2.json');
}

function loadM2Base(workId) {
  const file = basePath(workId);
  if (!fs.existsSync(file)) {
    throw new Error(`M2 新底本缺失：${file}；请先运行 build-v2.js（并按需运行 verify-v2.js）`);
  }
  const raw = fs.readFileSync(file, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data.pages) || !data.pages.length) throw new Error(`M2 新底本无 pages：${file}`);
  const pendingFile = path.join(DATA_ROOT, workId, 'pending-verify.json');
  let pending = [];
  if (fs.existsSync(pendingFile)) {
    const value = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
    if (Array.isArray(value)) pending = value;
  }
  // 指纹按 LF 归一化：Windows 检出会把 JSON 转成 CRLF，哈希须与平台无关，
  // 否则同一底本在 Windows/Linux 上算出两个 sha，断点续跑门控会误报"换底本"。
  const canonical = raw.replace(/\r\n/g, '\n');
  return {
    data,
    file,
    source: data.source || null,
    stats: data.stats || null,
    pendingFile,
    pendingCount: pending.length,
    sha256: crypto.createHash('sha256').update(canonical, 'utf8').digest('hex'),
  };
}

module.exports = { basePath, loadM2Base };
