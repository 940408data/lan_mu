/**
 * 生成 works/shiji-wudibenji/ 全数据（meta/text/seals/ornaments/book）。
 * 录文据《史记》传姜立纲抄本（新加坡国立大学藏）卷首三叶书影逐行迁出；
 * 行款严守原书：半叶八行、行二十字；短行仅现于段落块末（段末留空）。
 * 用法：node tools/gen-shiji-work.js
 */
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'works', 'shiji-wudibenji');

const TITLE = '五帝本紀';
/* 段落块：每块内连续流布（20 字/行），块末允许短行（段末行下留空） */
const PARAS = [
  [ // 叶1左行2-8 + 叶2全 + 叶3右行1-2
    '黃帝者少典之子姓公孫名曰軒轅生而神靈弱而',
    '能言幼而徇齊長而敦敏成而聰明軒轅之時神農',
    '氏世衰諸侯相侵伐暴虐百姓而神農氏弗能征於',
    '是軒轅乃習用干戈以征不享諸侯咸來賓從而蚩',
    '尤最為暴莫能伐炎帝欲侵陵諸侯諸侯咸歸軒轅',
    '軒轅乃修德振兵治五氣藝五種撫萬民度四方教',
    '熊羆貔貅貙虎以與炎帝戰於阪泉之野三戰然後',
    '得其志蚩尤作亂不用帝命於是黃帝乃徵師諸侯',
    '與蚩尤戰於涿鹿之野遂禽殺蚩尤而諸侯咸尊軒',
    '轅為天子代神農氏是為黃帝天下有不順者黃帝',
    '從而征之平者去之披山通道未嘗寧居東至于海',
    '登丸山及岱宗西至于空桐登雞頭南至于江登熊',
    '湘北逐葷粥合符釜山而邑于涿鹿之阿遷徙往來',
    '無常處以師兵為營衛官名皆以雲命為雲師置左',
    '右大監監于萬國萬國和而鬼神山川封禪與為多',
    '焉獲寶鼎迎日推筴舉風后力牧常先大鴻以治民',
    '順天地之紀幽明之占死生之說存亡之難時播百',
    '穀草木淳化鳥獸蟲蛾旁羅日月星辰水波土石金',
    '玉勞勤心力耳目節用水火材物有土德之瑞故號',
    '黃帝黃帝二十五子其得姓者十四人黃帝居軒轅',
    '之丘而娶於西陵之女是為嫘祖嫘祖為黃帝正妃',
    '生二子其後皆有天下其一曰玄囂是為青陽青陽',
    '降居江水其二曰昌意降居若水昌意娶蜀山氏女',
    '曰昌僕生高陽高陽有聖德焉黃帝崩葬橋山其孫',
    '昌意之子高陽立是為帝顓頊也',
  ],
  [ // 叶3右行3-8
    '帝顓頊高陽者黃帝之孫而昌意之子也靜淵以有',
    '謀疏通知知事養材以任地載時以象天依鬼神以',
    '制義治氣以教化潔誠以祭祀北至于幽陵南至于',
    '交趾西至于流沙東至于蟠木動靜之物小大之神',
    '日月所照莫不砥屬帝顓頊生子曰窮蟬顓頊崩而',
    '玄囂之孫高辛立是為帝嚳',
  ],
  [ // 叶3左
    '帝嚳高辛者黃帝之曾孫也高辛父曰蟜極蟜極父',
    '曰玄囂玄囂父曰黃帝自玄囂與蟜極皆不得在位',
    '至高辛即帝位高辛於顓頊為族子高辛生而神靈',
    '自言其名普施利物不於其身聰以知遠明以察微',
    '順天之義知民之急仁而威惠而信修身而天下服',
    '取地之財而節用之撫教萬民而利誨之曆日月而',
    '迎送之明鬼神而敬事之其色郁郁其德嶷嶷其動',
    '也時其服也士帝嚳溉執中而徧天下日月所照風',
  ],
];

const PER = 20;
// 行款校验：非块末行须满 20 字
for (const para of PARAS) {
  para.forEach((ln, i) => {
    if (i < para.length - 1 && ln.length !== PER) throw new Error(`行长≠${PER}：${ln}`);
  });
}

const rows = 1 + PARAS.reduce((s, p) => s + p.length, 0);
const chars = TITLE.length + PARAS.reduce((s, p) => s + p.join('').length, 0);
const halves = Math.ceil(rows / 8) + 1; // +1 卷首空白右半叶
const leaves = Math.ceil(halves / 2);

/* ---------- text.yaml ---------- */
const blocks = [`      - { type: title, text: "${TITLE}" }`]
  .concat(PARAS.map((p) => `      - { type: j, text: "${p.join('')}" }`));
const textYaml = [
  '# 史記卷一·五帝本紀（傳姜立綱寫本）：j 為經文大字單行；行款依書影（半葉八行行二十字）。',
  'sections:',
  '  - id: wudi',
  '    name: 五帝本紀',
  '    blocks:',
  ...blocks,
  '',
].join('\n');

/* ---------- meta.yaml ---------- */
const meta = {
  id: 'shiji-wudibenji',
  title: '史記·五帝本紀',
  subtitle: '传姜立纲写本 · 明',
  docTitle: '史記五帝本紀 — 姜立綱寫本',
  mark: '蘭木',
  ariaLabel: '史記五帝本紀，明人寫本雙葉，自右向左讀',
  category: '史',
  era: '明',
  layout: 'manuscript',
  book: { id: 'shiji-wudibenji', title: '史記（姜立綱寫本）', order: 1, entry: { big: '史記', sub: '寫本' } },
  seed: 31001,
  expect: { chars, rows, leaves },
  manuscript: {
    rowsPerHalf: 8,
    charsPerRow: PER,
    titleDrop: 2,
    openBlank: true,
    foreEdge: 'right',
    spec: '半葉八行　行二十字　大字單行　無界格　朱筆句讀',
    colophon: '傳姜立綱抄本。台閣體楷書，行疏字密，無界格；朱筆句讀點於字之右下。紙色逐葉微異，水漬、蟲蛀、霉斑、透背皆以種子程序化復現；書口見疊層紙邊，中縫作折葉陰影，以存寫本神韻。',
  },
  faces: {
    kai: { font: 'lxgw-wenkai-tc', label: '楷體' },
    xing: { font: 'ac-gyosyo', label: '行書' },
  },
  fallbackStacks: {
    kai: '"Kaiti TC","Kaiti SC","STKaiti","楷体","KaiTi","BiauKai","標楷體","TW-Kai","AR PL UKai TW","Noto Serif CJK TC",serif',
    xing: '"Xingkai SC","STXingkai","华文行楷","Kaiti TC","STKaiti","楷体","KaiTi","Noto Serif CJK TC",serif',
  },
  export: { base: 'Shiji-Manuscript', faces: { kai: 'Kai' }, scale: 1.6, quality: 88 },
  sources: [{ label: '新加坡國立大學藏傳姜立綱抄本（數字化書影）', url: 'https://www.nus.edu.sg/' }],
  aboutHtml: '<h2>關於此卷</h2>\n<p>《史記》傳姜立綱抄本，明人台閣體楷書精抄，現藏新加坡國立大學。此卷以數字化書影為據，復刻卷首三葉（五帝本紀開卷），無界格、行疏字密、朱筆句讀之寫本神韻，並程序化重現紙張紋理與書葉疊壓之感。</p>',
};

/* ---------- seals.yaml（卷首左半葉下方：方印+橢圓印） ---------- */
const seals = {
  seals: [
    { shape: 'square', chars: '鼎臣珍藏', x: 41.5, y: 68.5, w: 4.6, h: 4.6, rotate: -2 },
    { shape: 'oval', chars: '金樓', x: 41.6, y: 76.0, w: 4.2, h: 8.2, rotate: 1.5 },
  ],
};

/* ---------- ornaments.yaml ---------- */
const ornaments = {
  orchids: [],
  paperDecor: { stain: 1, holes: 4, fox: 14, trails: 0, bleed: true },
};

/* ---------- book.yaml（整册页序） ---------- */
const book = {
  pages: [
    { type: 'cover', side: 'front' },
    { type: 'flyleaf' },
    { type: 'colophon' },
    { type: 'leaves' },
    { type: 'flyleaf', end: true },
    { type: 'cover', side: 'back' },
  ],
  colophon: {
    text: '此書相傳為元人所抄故又謂姜立綱筆予反覆展視自勞詫尾十數萬言無一訛字無一落字無一補綴字其字之點畫波磔以不昜為宗至小變處更見銖兩悉稱如搆淩雲臺一一衡劑而成者其為善書無疑此近代藏書家所罕有歲乙未偶得之於庶古士趙大洲館中共計二十有四本吾子孫真當以法物珍藏勿僅目為書籍已也嘉靖丁酉二月鼎臣記',
    charsPerRow: 17,
  },
};

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'text.yaml'), textYaml, 'utf8');
fs.writeFileSync(path.join(OUT, 'meta.yaml'), YAML.stringify(meta, { lineWidth: 0 }), 'utf8');
fs.writeFileSync(path.join(OUT, 'seals.yaml'), YAML.stringify(seals, { lineWidth: 0 }), 'utf8');
fs.writeFileSync(path.join(OUT, 'ornaments.yaml'), YAML.stringify(ornaments, { lineWidth: 0 }), 'utf8');
fs.writeFileSync(path.join(OUT, 'book.yaml'), YAML.stringify(book, { lineWidth: 0 }), 'utf8');
console.log(`✓ works/shiji-wudibenji：chars=${chars} rows=${rows} leaves=${leaves}`);
