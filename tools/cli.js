/**
 * 兰木 CLI：new / validate / build / font:register / font:subset
 * 用法：
 *   node tools/cli.js build [--work=youlan] [--only=html,jpg,pdf]
 *   node tools/cli.js validate [--work=youlan]
 *   node tools/cli.js new <id> [--title=題名]
 *   node tools/cli.js font:register <id> --file=<路径> --license=A|B|C --family=<英文名> [选项]
 */
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { loadWork, listWorks, ROOT } = require('../src/core/load');
const { buildLayout } = require('../src/core/model/scroll');
const { renderHtml } = require('../src/render/html');
const { loadRegistry, validateRegistry, REGISTRY_PATH } = require('../src/fonts/fonts');

const args = process.argv.slice(2);
const cmd = args[0];
const flags = {};
for (const a of args.slice(1)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) flags[m[1]] = m[2] === undefined ? true : m[2];
  else if (!flags._) flags._ = [a];
  else flags._.push(a);
}

function distDirOf(workId) {
  return path.join(ROOT, 'dist', 'works', workId);
}

/* ---------- validate ---------- */
function cmdValidate(workId) {
  const ids = workId ? [workId] : listWorks();
  if (!ids.length) { console.log('尚无作品（works/ 为空）'); }
  let fail = 0;

  const regProblems = validateRegistry(loadRegistry());
  for (const p of regProblems) { console.error('✗ 字体登记:', p); fail++; }

  for (const id of ids) {
    try {
      const work = loadWork(id);
      const tree = buildLayout(work); // 内含 expect 基准校验
      const s = tree.stats;
      if (tree.kind === 'songke') {
        console.log(`✓ ${id}（宋版善刻）：${s.leaves} 葉 / ${s.halves} 半葉 / ${s.columns} 行 / 經字 ${s.jChars} · 注字 ${s.zChars} / 印章 ${tree.seals.length} 枚`);
      } else {
        console.log(`✓ ${id}：${s.lines} 行 / ${s.chars} 字 / ${s.notes} 处夹注 / 印章 ${tree.seals.length} 枚 / 兰花 ${tree.orchids.length} 处`);
      }
    } catch (e) {
      console.error(`✗ ${id}：${e.message}`);
      fail++;
    }
  }
  if (fail) { console.error(`共 ${fail} 处问题`); process.exit(1); }
  console.log('校验通过');
}

/* ---------- build ---------- */
async function cmdBuild(workId, only) {
  const ids = workId ? [workId] : listWorks();
  if (!ids.length) throw new Error('works/ 中没有作品');
  const outputs = only ? only.split(',') : ['html', 'jpg', 'pdf'];

  for (const id of ids) {
    console.log(`\n══ 构建 ${id} ══`);
    const work = loadWork(id);
    const tree = buildLayout(work);
    const outDir = distDirOf(id);
    fs.mkdirSync(outDir, { recursive: true });

    // 1) 字体子集（仅 A 级；B 级不参与分发）
    const { buildSubsets } = require('../src/fonts/subset');
    const sub = await buildSubsets(work, loadRegistry(), outDir);
    for (const b of sub.built) console.log('  字体子集:', b);
    for (const w of sub.warnings) console.warn('  [字体]', w);

    // 2) HTML（按版式分派渲染器）
    const songke = tree.kind === 'songke';
    const { html, warnings } = songke
      ? require('../src/render/html-songke').renderSongkeHtml(tree, { distWorkDir: outDir })
      : renderHtml(tree, { distWorkDir: outDir });
    for (const w of warnings) console.warn('  [字体]', w);
    const htmlPath = path.join(outDir, 'index.html');
    fs.writeFileSync(htmlPath, html);
    console.log('  HTML:', htmlPath, `(${Math.round(html.length / 1024)}KB)`);

    // 3) 扫描图（仅手卷引擎）
    if (work.scan) {
      fs.copyFileSync(work.scan, path.join(outDir, 'scan.jpg'));
      console.log('  扫描图: scan.jpg（按需加载）');
    }

    // 4) JPG / PDF
    if (outputs.includes('jpg')) {
      if (songke) {
        console.log('  JPG: 宋版善刻不再生成圖像長圖，已略過（改用每字面一版 PDF）');
      } else {
        const jpgs = await require('../src/render/image').renderImages(tree, htmlPath, outDir);
        for (const j of jpgs) console.log('  JPG:', j);
      }
    }
    if (outputs.includes('pdf')) {
      if (songke) {
        const pdfs = await require('../src/render/pdf-songke').renderSongkePdf(tree, htmlPath, outDir);
        for (const p of pdfs) console.log('  PDF:', p);
      } else {
        const pdf = await require('../src/render/pdf').renderPdf(tree, htmlPath, outDir);
        console.log('  PDF:', pdf);
      }
    }
  }
  console.log('\n构建完成');
}

/* ---------- new ---------- */
function cmdNew(id, title) {
  if (!id || !/^[a-z0-9-]+$/.test(id)) throw new Error('作品 id 须为小写字母/数字/连字符');
  const dir = path.join(ROOT, 'works', id);
  if (fs.existsSync(dir)) throw new Error(`作品已存在: works/${id}`);
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });

  const meta = {
    id,
    title: title || '未題名',
    subtitle: '數字復刻',
    mark: '蘭木',
    ariaLabel: `${title || id} 橫卷，自右向左讀`,
    category: '經', // 經 / 史 / 禮樂 / 書 / 畫
    era: '',
    layout: 'scroll',
    seed: Math.floor(Math.random() * 90000) + 10000,
    expect: null, // 校录完成后填 {lines, scoreLines, chars, notes} 作为校验基准
    scroll: {
      ch: 28, pitch: 46, glyph: 23, textH: 616, top: 68,
      paperW: 12042, paperH: 780, lead: 400, tail: 510,
      silk: 44, ends: 96, roll: 24, wrapW: 12282, wrapH: 868,
      noteFontSize: 9.4,
    },
    faces: {
      song: { font: 'source-han-serif', label: '宋體' },
      jing: { font: 'fahua-wenkai', label: '寫經體' },
      xing: { font: 'xingkai', label: '行楷' },
    },
    fallbackStacks: {
      song: '"Songti TC","Songti SC","STSong","SimSun","宋体","NSimSun","Source Han Serif TC","Noto Serif CJK TC","Noto Serif CJK SC","Noto Serif TC",serif',
      jing: '"Kaiti TC","Kaiti SC","STKaiti","楷体","KaiTi","BiauKai","DFKai-SB","標楷體","TW-Kai","AR PL UKai TW","Noto Serif CJK TC",serif',
      xing: '"STXingkai","華文行楷","华文行楷","Xingkai SC","Xingkai TC","HanziPen TC","HanziPen SC","漢儀行楷簡","Yuppy TC","Kaiti TC","STKaiti","楷体","Noto Serif CJK TC",serif',
    },
    sources: [],
    aboutHtml: '<h2>關於本卷</h2>\n<p>（待撰寫）</p>',
  };
  const text = {
    sections: [
      { id: 'head', name: '卷首題序', columns: [{ line: 1, class: 'title', text: '（待校錄）' }] },
    ],
  };
  fs.writeFileSync(path.join(dir, 'meta.yaml'), YAML.stringify(meta, { lineWidth: 0 }));
  fs.writeFileSync(path.join(dir, 'text.yaml'), YAML.stringify(text, { lineWidth: 0 }));
  fs.writeFileSync(path.join(dir, 'seals.yaml'), 'seals: []\n');
  fs.writeFileSync(path.join(dir, 'ornaments.yaml'), 'orchids: []\n');
  console.log(`已创建 works/${id}/（meta.yaml / text.yaml / seals.yaml / ornaments.yaml / assets/）`);
  console.log('下一步：校录文本 → text.yaml；npm run validate 校验；npm run build 构建');
}

/* ---------- font:register ---------- */
function cmdFontRegister(id) {
  if (!id) throw new Error('用法: font:register <id> --file=<路径> --family=<英文名> --license=A|B|C [--name=名称] [--author=作者] [--source=链接] [--familyLocal=中文名] [--allowEmbed=true|false] [--note=备注]');
  if (!flags.file || !flags.family || !flags.license) {
    throw new Error('必选项: --file --family --license（A/B/C）');
  }
  const doc = YAML.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  doc.fonts = doc.fonts || {};
  doc.fonts[id] = {
    name: flags.name || id,
    family: flags.family,
    ...(flags.familyLocal ? { familyLocal: flags.familyLocal } : {}),
    author: flags.author || '待补充',
    license: flags.license,
    licenseName: flags.licenseName || (flags.license === 'A' ? '开源协议（请补具体名称）' : flags.license === 'B' ? '作者声明免费商用（有限制）' : '付费授权'),
    source: flags.source || '',
    file: flags.file,
    allowEmbed: flags.allowEmbed != null ? flags.allowEmbed === 'true' : flags.license === 'A',
    status: '就绪',
    note: flags.note || '',
  };
  fs.writeFileSync(REGISTRY_PATH, YAML.stringify(doc, { lineWidth: 0 }));
  console.log(`已登记字体 ${id}（${flags.license} 级）→ src/fonts/fonts.yaml`);
  const problems = validateRegistry(doc.fonts);
  for (const p of problems) console.warn('  [提示]', p);
}

/* ---------- 入口 ---------- */
(async () => {
  try {
    if (cmd === 'validate') cmdValidate(flags.work);
    else if (cmd === 'build') await cmdBuild(flags.work, flags.only);
    else if (cmd === 'new') cmdNew(flags._ && flags._[0], flags.title);
    else if (cmd === 'font:register') cmdFontRegister(flags._ && flags._[0]);
    else {
      console.log('兰木 CLI 命令: build / validate / new / font:register');
      process.exit(cmd ? 1 : 0);
    }
  } catch (e) {
    console.error('出错:', e.message);
    process.exit(1);
  }
})();
