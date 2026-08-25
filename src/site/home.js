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
    desc: '大學 中庸 論語 孟子 —— 朱熹章句集注，底本宋當塗郡齋本',
    books: ['daxue-facsimile', 'zhongyong-facsimile', 'lunyu-songben', 'mengzi-songben'],
    /* 版本源流:按時代列四書版本。status: kept=在庋(本站已有,不鏈——書影即在上方)、
     * soon=待訪(鏈「敬請期待」,後續填充時改 kept 並去 href)、lost=亡佚(靜態)。 */
    editions: [
      { era: '漢唐', blurb: '大學、中庸，《禮記》之篇；論語，傳記之屬；孟子，廁於諸子——四書之名未立，皆在五經羽翼之間。' },
      {
        era: '宋', blurb: '二程表章於前，朱熹畢生章句集注於後——四書遂為一體，越五經而行於世。',
        items: [
          { name: '寶婺本', note: '朱熹在世時婺州所刻，四書最早之本，今已亡佚', status: 'lost' },
          { name: '宋當塗郡齋本', note: '現存最要之本，中國國家圖書館藏一級古籍。本站四書，悉據此本', status: 'kept' },
        ],
      },
      { era: '元', items: [{ name: '書院本', note: '書院刻書盛於一代，四書課士，遂為常經', status: 'soon' }] },
      { era: '明', items: [{ name: '經廠本', note: '內府經廠刊刻，大字疏行，官學定本', status: 'soon' }] },
      { era: '清', items: [{ name: '武英殿本', note: '殿版精鐫，紙墨精良，內府之藏', status: 'soon' }] },
      { era: '現代', items: [{ name: '儒藏點校本', note: '《儒藏》精華編所收，當世點校整理之本', status: 'soon' }] },
      { era: '其他', items: [{ name: '姜立綱手書四書白文', note: '明館閣體書家手錄白文，無注，別具一格', status: 'soon' }] },
    ],
    /* extras：專題附屬獨立頁入口（自包含頁，不經模板/子集字庫；置於版本源流區段之下） */
    extras: [{ label: '版本源流圖', href: '/topics/sishu/lineage.html', note: '據徐德明《四書章句集注版本考略》' }],
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
  'zhongyong-facsimile': { collation: '精校', diben: '宋当涂郡斋本' },
  'zhongyong-songben': { collation: '初校', diben: '宋当涂郡斋本' },
  xinjing:    { collation: '初校', diben: '乾隆本' },
  lanting:    { collation: '精校', diben: '神龍本' },
  chibifu:    { collation: 'AI整理', diben: '四庫本' },
  dushanjing: { collation: 'AI整理', diben: '四庫本' },
  huxinting:  { collation: 'AI整理' },
  shiji:      { collation: 'G1逐格', diben: '傳姜立綱寫本' },
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
