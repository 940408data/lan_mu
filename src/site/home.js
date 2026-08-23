/** 首頁門戶配置：頂部導航 / 部類頁簽（經史子集頁 /sanzang/）/ 專題推薦 / 靜態文案。
 *  跨選性內容（非 works 數據）：虛擬典籍僅具題名，點入「敬請期待」。 */

const NAV = [
  { label: '幽蘭第五', href: '/works/youlan/index.html' },
  { label: '書庫', href: '/shuku/' },
  { label: '我是校書官', href: '/jiaoshu/' },
];

/* 部類頁簽（經史子集頁 /sanzang/，即 0327 版首頁遷存）：books 為聚合書 id（真書），
 * virtual 為虛擬典籍（敬請期待）。仿識典式編選：一次一部，不放全帙；全帙在「書庫」。 */
const TABS = [
  { key: '經選', books: [], virtual: ['詩經', '尚書', '周易', '春秋'] },
  { key: '史選', books: [], virtual: ['史記', '漢書', '後漢書', '三國志'] },
  { key: '子選', books: ['changwuzhi', 'zunshengbajian'], virtual: ['神奇秘譜', '閒情偶寄'] },
  { key: '集選', books: [], virtual: ['李太白文集', '杜工部集', '王右丞集'] },
];

/* 專題：首頁主/次視覺板塊與專題頁（/topics/<id>/）共用此配置。
 * 順序即首頁展示序：四時幽賞（文）置前、四書涵泳（質）次之 —— 先文後質。
 * marks：四時各部季節冠字（春蘭亭/夏山海/秋赤壁/冬湖心），首頁書影上方綴之。 */
const TOPICS = [
  {
    id: 'sishi-youshang', title: '四時幽賞',
    desc: '暮春蘭亭，仲夏山海，秋夜赤壁，雪夜湖心 —— 古人四時之樂',
    books: ['lanting', 'dushanjing', 'chibifu', 'huxinting'],
    marks: { lanting: '春', dushanjing: '夏', chibifu: '秋', huxinting: '冬' },
    virtual: [],
  },
  {
    id: 'sishu', title: '四書涵泳',
    desc: '大學 中庸 論語 孟子 —— 朱熹章句集注，經注相隨，宋刻重排',
    books: ['daxue', 'zhongyong', 'lunyu', 'mengzi'],
  },
];

/* 網盤共享文件夾（全量 PDF 兕底鏈接）：重要書在 BOOK_META 配獨立 netdisk 一書一鏈，
 * 其餘書一律指向此共享文件夾；留空則不顯示兕底鏈接。 */
const NETDISK_FOLDER = 'https://pan.baidu.com/s/1i3e4N9SLcnwJBhRD0LbQAw?pwd=6666';

/* 書卡詳情：點校類別 + 底本（集中配置；缺省 collation='AI整理'，無 diben 不顯底本行）。
 * bookId = songke 的 book.id（多卷聚合）或 scroll 單卷 work id。
 * netdisk：全量 PDF 網盤鏈接（一書一鏈）；留空/缺省則走 NETDISK_FOLDER 共享文件夾。 */
const BOOK_META = {
  daxue:      { collation: '精校', diben: '现代通行本', netdisk: '' },
  zhongyong:  { collation: '精校', diben: '现代通行本', netdisk: '' },
  lunyu:      { collation: '初校', diben: '现代通行本' },
  mengzi:     { collation: '初校', diben: '现代通行本' },
  'lunyu-songben':     { collation: '精校', diben: '宋当涂郡斋本' },
  'mengzi-songben':    { collation: '精校', diben: '宋当涂郡斋本' },
  'daxue-facsimile':   { collation: '精校', diben: '宋当涂郡斋本' },
  'daxue-songben':     { collation: '初校', diben: '宋当涂郡斋本' },
  'zhongyong-songben': { collation: '初校', diben: '宋当涂郡斋本' },
  xinjing:    { collation: '初校', diben: '乾隆本' },
  lanting:    { collation: '精校', diben: '神龍本' },
  chibifu:    { collation: 'AI整理', diben: '四庫本' },
  dushanjing: { collation: 'AI整理', diben: '四庫本' },
  huxinting:  { collation: 'AI整理' },
};

/* 固定文案（校書官招募 / 敬請期待頁），構建期一併入小字庫 */
const COPY = {
  soon: { title: '敬請期待', sub: '此書尚在選題校錄之列' },
  jiaoshu: {
    title: '我是校書官', sub: '點校招募',
    lines: [
      '蘭木諸書，以「寧缺毋濫」為則：未經細校之卷，僅示版式，正文不公。',
      '點校群第一階段僅招募三十人。群內共同點校，分享校錄資料與底本資源。',
      '聯絡方式待補。',
    ],
  },
  back: '回蘭木藏書',
  topicLabel: '專題',
  topicHead: '專題推薦',
  enterSanzang: '古典',
  sanzangSub: '經史子集選編',
};

module.exports = { NAV, TABS, TOPICS, COPY, BOOK_META, NETDISK_FOLDER };
