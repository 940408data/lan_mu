/**
 * 一次性抽取脚本：把 Youlan-Scroll.html 中的内容资产拆分为 works/youlan/ 数据。
 * 产物：meta.yaml / text.yaml / seals.yaml / ornaments.yaml / assets/scan.jpg / assets/orchids.json
 * 仅迁移内容数据，不含任何表现层逻辑；表现层由 src/ 引擎重建。
 */
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'Youlan-Scroll.html');
const OUT = path.join(ROOT, 'works', 'youlan');

const html = fs.readFileSync(SRC, 'utf8');
const lines = html.split('\n');

/* ---------- 1. 正文列 ---------- */
const colRe = /^<i class="col ([^"]*)" style="--n:(\d+)" data-line="(\d+)" data-count="(\d+)" data-meta="([^"]*)" data-sec="([^"]*)" tabindex="0"><i class="t">(.*?)<\/i>(<b class="note".*?<\/b>)?<\/i>$/;
const glyphRe = /<i class="k(\d) j(\d) h(\d+)">(.)<\/i>|(　)/gu;
const noteRe = /<b class="note" style="--nt:([\d.]+)px;--nfs:([\d.]+)px;--nh:([\d.]+)px" title="夾注：([^"]*)">([^<]*)<\/b>/;

const SEC_ORDER = ['卷首題序', '譜題', '文字譜', '尾題', '曲名錄'];
const SEC_IDS = { 卷首題序: 'head', 譜題: 'score-title', 文字譜: 'score', 尾題: 'colophon', 曲名錄: 'catalog' };

const columns = [];
for (const line of lines) {
  if (!line.startsWith('<i class="col ')) continue;
  const m = line.match(colRe);
  if (!m) throw new Error('列解析失败: ' + line.slice(0, 120));
  const [, cls, , dataLine, dataCount, , sec, body, noteHtml] = m;

  // 拆出主文本与夹注
  const textPart = body;
  let note = null;
  if (noteHtml) {
    const nm = noteHtml.match(noteRe);
    if (!nm) throw new Error(`第 ${dataLine} 行夹注解析失败`);
    note = { at: parseFloat(nm[1]), fontSize: parseFloat(nm[2]), text: nm[4] };
    if (nm[4] !== nm[5]) throw new Error(`第 ${dataLine} 行夹注 title 与正文不一致`);
    if (Math.abs(parseFloat(nm[3]) - (616 - parseFloat(nm[1]))) > 0.01) {
      throw new Error(`第 ${dataLine} 行夹注 --nh 不符合「文本高 − 起始偏移」规律`);
    }
  }

  // 字形序列 → 纯文本（含全角间隔号　）+ 笔墨标记串；data-count 只计字形、不计 　
  // marks 紧凑编码：每字 3 位数字 k/j/h（值域 k≤5 j≤7 h≤9 均为个位数），全角间隔无标记
  let text = '';
  let marks = '';
  let glyphCount = 0;
  let g;
  glyphRe.lastIndex = 0;
  while ((g = glyphRe.exec(textPart))) {
    if (g[4]) {
      text += g[4]; glyphCount++;
      if (g[1].length > 1 || g[2].length > 1 || g[3].length > 1) {
        throw new Error(`第 ${dataLine} 行出现多位数笔墨标记：k${g[1]} j${g[2]} h${g[3]}`);
      }
      marks += g[1] + g[2] + g[3];
    } else { text += g[5]; }
  }

  if (glyphCount !== parseInt(dataCount, 10)) {
    throw new Error(`第 ${dataLine} 行字数不符：抽取 ${glyphCount} ≠ data-count ${dataCount}`);
  }
  const col = { line: parseInt(dataLine, 10), class: cls, text, marks };
  if (note) col.note = note;
  columns.push({ sec, col });
}

// 按 section 分组
const sections = SEC_ORDER.map((name) => ({
  id: SEC_IDS[name],
  name,
  columns: columns.filter((c) => c.sec === name).map((c) => c.col),
}));

const stats = {
  lines: columns.length,
  scoreLines: columns.filter((c) => ['譜題', '文字譜', '尾題'].includes(c.sec)).length,
  chars: columns.reduce((s, c) => s + [...c.col.text].filter((ch) => ch !== '\u3000').length, 0),
  notes: columns.filter((c) => c.col.note).length,
};
console.log('统计:', JSON.stringify(stats));
const expect = { lines: 242, scoreLines: 224, chars: 4758, notes: 56 };
for (const k of Object.keys(expect)) {
  if (stats[k] !== expect[k]) throw new Error(`校验失败 ${k}: ${stats[k]} ≠ ${expect[k]}`);
}
const secCounts = sections.map((s) => s.columns.length);
if (secCounts.join(',') !== '5,1,222,1,13') throw new Error('section 行数不符: ' + secCounts);

/* ---------- 2. 印章 ---------- */
const sealsLine = lines.find((l) => l.includes('class="seals"'));
const sealRe = /<g transform="translate\(([\d.]+),([\d.]+)\) rotate\(([-\d.]+)\)" class="seal-mark">(.*?)<\/g>/g;
const sealTextRe = /<text x="([\d.]+)" y="([\d.]+)" font-size="(\d+)" fill="(#[0-9a-f]+)"[^>]*>(.)<\/text>/g;
const seals = [];
let sm;
while ((sm = sealRe.exec(sealsLine))) {
  const rect = sm[4].match(/<rect x="0" y="0" width="([\d.]+)" height="([\d.]+)" rx="[\d.]+" fill="(none|#[0-9a-f]+)"/);
  const chars = [];
  let tm;
  sealTextRe.lastIndex = 0;
  while ((tm = sealTextRe.exec(sm[4]))) {
    chars.push({ ch: tm[5], x: parseFloat(tm[1]), y: parseFloat(tm[2]) });
  }
  seals.push({
    x: parseFloat(sm[1]), y: parseFloat(sm[2]), rotate: parseFloat(sm[3]),
    w: parseFloat(rect[1]), h: parseFloat(rect[2]),
    style: rect[3] === 'none' ? '白文' : '朱文',
    fontSize: parseInt(chars[0] ? sm[4].match(/font-size="(\d+)"/)[1] : '0', 10),
    chars,
  });
}
console.log('印章:', seals.length, '枚');

/* ---------- 3. 兰花装饰 ---------- */
// 笔形内含 path（部分带描边）/circle/rect/ellipse 等混合元素，
// 不再逐项结构化，直接保留原始 svg 片段以保证完全保真。
const texLine = lines.find((l) => l.includes('class="tex"'));
const lanRe = /<g transform="translate\(([-\d.]+),([-\d.]+)\) scale\(([-\d.]+),([-\d.]+)\)" opacity="([\d.]+)">(.*?)<\/g>/g;
const shapes = [];
const shapeIdx = new Map();
const placements = [];
let lm;
let lanLastEnd = 0;
while ((lm = lanRe.exec(texLine))) {
  lanLastEnd = lanRe.lastIndex;
  const svg = lm[6];
  if (!shapeIdx.has(svg)) {
    shapeIdx.set(svg, shapes.length);
    shapes.push(svg);
  }
  placements.push({
    x: parseFloat(lm[1]), y: parseFloat(lm[2]),
    sx: parseFloat(lm[3]), sy: parseFloat(lm[4]),
    opacity: parseFloat(lm[5]),
    shape: shapeIdx.get(svg),
  });
}
console.log('兰花:', placements.length, '处 /', shapes.length, '种笔形');

// tex svg 尾部：lan 组闭合后的纸面装饰（缂丝缝线 / 包首等 rect·path·ellipse 群），原样保真
const tailM = texLine.slice(lanLastEnd).match(/^<\/g>([\s\S]*?)<\/svg>/);
const paperDecor = tailM ? tailM[1] : '';
if (!paperDecor) throw new Error('未抽到 tex svg 尾部纸面装饰');
console.log('纸面装饰:', paperDecor.length, '字符');

/* ---------- 4. 原卷扫描图 ---------- */
const scanM = html.match(/src="data:image\/jpeg;base64,([^"]+)"/);
if (!scanM) throw new Error('未找到扫描图');
fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'assets', 'scan.jpg'), Buffer.from(scanM[1], 'base64'));
console.log('扫描图:', Math.round(Buffer.from(scanM[1], 'base64').length / 1024), 'KB');

/* ---------- 5. 说明面板内容 ---------- */
const panelM = html.match(/<aside class="panel" id="panel"[^>]*>([\s\S]*?)<\/aside>/);
const aboutHtml = panelM[1].split('\n').map((s) => s.trimEnd()).join('\n').trim();

/* ---------- 6. 写出数据 ---------- */
const yamlOpt = { lineWidth: 0 };

const meta = {
  id: 'youlan',
  title: '碣石調 · 幽蘭第五',
  subtitle: '唐人寫本 · 文字譜 · 數字復刻',
  docTitle: '碣石調·幽蘭第五 — 唐人寫本數字復刻',
  export: { base: 'Youlan-Scroll', faces: { song: 'Song', xing: 'Xingkai' }, scale: 1.6, quality: 88 },
  mark: '國寶',
  ariaLabel: '碣石調幽蘭第五 橫卷，自右向左讀',
  category: '禮樂',
  era: '唐',
  layout: 'scroll',
  repository: '東京國立博物館（TB-1393）',
  physical: { heightCm: 27.4, lengthCm: 423.1 },
  seed: 42231,
  expect: { lines: 242, scoreLines: 224, chars: 4758, notes: 56 },
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
  sources: [
    { label: 'e-Museum 原卷', url: 'https://emuseum.nich.go.jp/detail/100229' },
    { label: '維基文庫底本', url: 'https://zh.wikisource.org/zh-hant/碣石調·幽蘭' },
  ],
  aboutHtml,
};

fs.writeFileSync(path.join(OUT, 'meta.yaml'), YAML.stringify(meta, yamlOpt));
fs.writeFileSync(path.join(OUT, 'text.yaml'), YAML.stringify({ sections }, yamlOpt));
fs.writeFileSync(path.join(OUT, 'seals.yaml'), YAML.stringify({ seals }, yamlOpt));
fs.writeFileSync(path.join(OUT, 'ornaments.yaml'), YAML.stringify({ orchids: placements, paperDecor }, yamlOpt));
fs.writeFileSync(path.join(OUT, 'assets', 'orchids.json'), JSON.stringify({ shapes }));
console.log('已写出 works/youlan/ 全部数据');
