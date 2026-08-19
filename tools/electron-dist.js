#!/usr/bin/env node
/** 生成 Electron 桌面版精简 dist
 *  从源 dist 复制 HTML / 字体子集 / scan.jpg / 卷影图，排除出图大文件（JPG/PNG/PDF）。
 *  第一版尽量小：精简后约 78 MB（全量 3.1 GB）。
 *
 *  源 dist 自动定位主仓根 dist（git common-dir 推导），可用 LANMU_SRC_DIST 覆盖。
 *  --if-missing：目标已存在则跳过（dev 快速启动）。 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ifMissing = process.argv.includes('--if-missing');

let srcDist;
if (process.env.LANMU_SRC_DIST && fs.existsSync(process.env.LANMU_SRC_DIST)) {
  srcDist = process.env.LANMU_SRC_DIST;
} else {
  try {
    const commonDir = execSync('git rev-parse --git-common-dir', { encoding: 'utf8' }).trim();
    srcDist = path.resolve(commonDir, '..', 'dist');
  } catch {
    // 退回相对路径推测（worktree → .claude/worktrees/x → .claude/worktrees → .claude → 仓库根）
    srcDist = path.join(__dirname, '..', '..', '..', 'dist');
  }
}
const destDist = path.join(__dirname, '..', 'dist');

if (ifMissing && fs.existsSync(destDist)) {
  console.log(`[electron-dist] 已存在，跳过（--if-missing）：${destDist}`);
  process.exit(0);
}
if (!fs.existsSync(srcDist)) {
  console.error(`[electron-dist] 源 dist 不存在：${srcDist}`);
  console.error('  请先在主仓执行 npm run build 生成 dist，或用 LANMU_SRC_DIST 指定路径。');
  process.exit(1);
}

// 出图大文件命名：<id>-Scroll-<Face>.{jpg,png} / <id>-Songke-<Face>.{jpg,png} / *.pdf
// scan.jpg、assets/topics/*.png、assets/fonts/*.woff2 不含 Scroll/Songke，保留
const isOutputArt = (file) => {
  if (/\.pdf$/i.test(file)) return true;
  if (/\.(jpg|png)$/i.test(file) && /-(Scroll|Songke)-/i.test(file)) return true;
  return false;
};

fs.rmSync(destDist, { recursive: true, force: true });
fs.mkdirSync(destDist, { recursive: true });

let copied = 0, skipped = 0, bytes = 0;
fs.cpSync(srcDist, destDist, {
  recursive: true,
  filter: (s) => {
    const stat = fs.statSync(s);
    if (stat.isDirectory()) return true;
    const file = path.basename(s);
    if (isOutputArt(file)) { skipped++; return false; }
    copied++; bytes += stat.size; return true;
  },
});

console.log(`[electron-dist] 复制 ${copied} 文件（${(bytes / 1048576).toFixed(1)} MB），排除出图 ${skipped} 个`);
console.log(`[electron-dist] → ${destDist}`);
