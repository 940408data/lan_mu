/** 首頁門戶配置：頂部導航 / 部類頁簽 / 專題推薦 / 靜態文案。
 *  編選性內容（非 works 數據）：虛擬典籍僅具題名，點入「敬請期待」。 */

const NAV = [
  { label: '幽蘭第五', href: '/works/youlan/index.html' },
  { label: '書庫', href: '/shuku/' },
  { label: '我是校書官', href: '/jiaoshu/' },
];

/* 部類頁簽：books 為聚合書 id（真書），virtual 為虛擬典籍（敬請期待）。
 * 仿識典式編選：一次一部，不放全帙；全帙在「書庫」。 */
const TABS = [
  { key: '儒家經典', books: ['daxue', 'zhongyong', 'lunyu', 'mengzi'] },
  { key: '佛家', books: ['xinjing'], virtual: ['金剛經', '維摩詰經', '妙法蓮華經'] },
  { key: '道家', books: [], virtual: ['道德經', '南華經', '沖虛經'] },
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

/* 書卡詳情：點校類別 + 底本（集中配置；缺省 collation='AI整理'，無 diben 不顯底本行）。
 * bookId = songke 的 book.id（多卷聚合）或 scroll 單卷 work id。 */
const BOOK_META = {
  daxue:      { collation: '精校', diben: '當塗郡本' },
  zhongyong:  { collation: '精校', diben: '當塗郡本' },
  lunyu:      { collation: '初校', diben: '當塗郡本' },
  mengzi:     { collation: '初校', diben: '當塗郡本' },
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
};

module.exports = { NAV, TABS, TOPICS, COPY, BOOK_META };
