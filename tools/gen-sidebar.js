#!/usr/bin/env node
/**
 * 生成 docs/_sidebar.md 中「校对数据」分类下的书名/文件列表。
 *
 * 扫描 collation/data/<书名>/output/*.md，按固定顺序生成侧边栏链接。
 * 书名简→繁显示（opencc cn→tw），路径保持简体原样；文件名保持简体，
 * "-" 替换为 "·" 作为显示名。
 *
 * 用法：node tools/gen-sidebar.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SIDEBAR_PATH = path.join(ROOT, 'docs', '_sidebar.md');
const DATA_DIR = path.join(ROOT, 'collation', 'data');

const START = '<!-- docs:collation-data start -->';
const END = '<!-- docs:collation-data end -->';

// 书名显示顺序优先级（传统四书序）；未列入的按字母序排在后面
const BOOK_ORDER = ['大学章句', '中庸章句', '论语章句', '孟子章句'];

// 文件显示顺序优先级；未列入的按字母序排在后面
const FILE_ORDER = ['校勘记', '善本点校本', '善本点校本-分栏', '现代本'];

let s2tw;
try {
  const OpenCC = require('opencc-js');
  s2tw = OpenCC.Converter({ from: 'cn', to: 'tw' });
} catch {
  s2tw = (s) => s;
}

function sortFiles(a, b) {
  const ka = a.replace(/\.md$/, '');
  const kb = b.replace(/\.md$/, '');
  const ia = FILE_ORDER.indexOf(ka);
  const ib = FILE_ORDER.indexOf(kb);
  return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || ka.localeCompare(kb);
}

function generateCollationSection() {
  const books = fs.readdirSync(DATA_DIR)
    .filter((d) => fs.statSync(path.join(DATA_DIR, d)).isDirectory())
    .sort((a, b) => {
      const ia = BOOK_ORDER.indexOf(a);
      const ib = BOOK_ORDER.indexOf(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.localeCompare(b);
    });

  const lines = [];
  for (const book of books) {
    const outputDir = path.join(DATA_DIR, book, 'output');
    if (!fs.existsSync(outputDir)) continue;

    const files = fs.readdirSync(outputDir)
      .filter((f) => f.endsWith('.md'))
      .sort(sortFiles);

    if (files.length === 0) continue;

    lines.push(`  - ${s2tw(book)}`);
    for (const f of files) {
      const name = f.replace(/\.md$/, '');
      const display = name.replace(/-/g, '·');
      lines.push(`    - [${display}](/collation-data/${book}/output/${f})`);
    }
  }
  return lines.join('\n');
}

function main() {
  const content = fs.readFileSync(SIDEBAR_PATH, 'utf8');
  const startIdx = content.indexOf(START);
  const endIdx = content.indexOf(END);

  if (startIdx === -1 || endIdx === -1) {
    console.error(`错误：_sidebar.md 中找不到标记 ${START} / ${END}`);
    console.error('请在「校对数据」分类的手动链接之后、书名列表处放置标记。');
    process.exit(1);
  }

  const before = content.slice(0, startIdx + START.length);
  const after = content.slice(endIdx);
  const generated = generateCollationSection();

  fs.writeFileSync(SIDEBAR_PATH, `${before}\n${generated}\n${after}`, 'utf8');

  const bookCount = (generated.match(/^  - /gm) || []).length;
  const fileCount = (generated.match(/^    - /gm) || []).length;
  console.log(`✓ _sidebar.md 校对数据已更新（${bookCount} 部书，${fileCount} 个文件）`);
}

main();
