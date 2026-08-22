/**
 * 十三经注疏作品文件批量生成：meta.yaml / seals.yaml / ornaments.yaml
 * 依赖：works/{prefix}-juanN/text.yaml（由 extract-shisanjing.js 生成）
 *
 * 流程：
 *  1. 从 vol_XX.txt 提取子标题（entry.sub）
 *  2. 生成 meta.yaml（暂不含 expect）+ seals.yaml + ornaments.yaml
 *  3. buildLayout 计算实际排版统计，回填 expect 基准
 *
 * 用法：node tools/gen-shisanjing-meta.js [bookId]
 */
const fs = require('fs');
const path = require('path');
const OpenCC = require('opencc-js');
const { loadWork } = require('../src/core/load');
const { buildLayout } = require('../src/core/model/scroll');

const s2tw = OpenCC.Converter({ from: 'cn', to: 'tw' });

// 中文数字（1-63）
function cnNum(n) {
  const D = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (n <= 10) return n === 10 ? '十' : D[n];
  if (n < 20) return '十' + D[n % 10];
  const tens = Math.floor(n / 10), ones = n % 10;
  return D[tens] + '十' + (ones ? D[ones] : '');
}

const BOOKS = {
  maoshi: {
    prefix: 'maoshi', bookId: 'maoshi', title: '毛詩正義', banxin: '毛詩',
    shuAuthor: '孔穎達', zhuDesc: '漢毛亨傳、鄭玄箋', era: '唐', seedBase: 21000,
    intro: '《毛詩正義》為唐孔穎達等奉敕撰，以毛傳、鄭箋為本，為十三經注疏之一。詩三百篇，風雅頌並具，此卷以宋刻本版式數字重刻，半葉八行、行十六字、注文雙行二十五字。',
    sourceUrl: 'https://zh.wikisource.org/zh-hant/毛詩正義', sourceLabel: '孔穎達《毛詩正義》',
  },
  zhouli: {
    prefix: 'zhouli', bookId: 'zhouli', title: '周禮注疏', banxin: '周禮',
    shuAuthor: '賈公彥', zhuDesc: '漢鄭玄注', era: '唐', seedBase: 22000,
    intro: '《周禮注疏》為唐賈公彥等奉敕撰，以漢鄭玄注為本，為十三經注疏之一。周禮設六官以統百職，此卷以宋刻本版式數字重刻，半葉八行、行十六字、注文雙行二十五字。',
    sourceUrl: 'https://zh.wikisource.org/zh-hant/周禮注疏', sourceLabel: '賈公彥《周禮注疏》',
  },
  yili: {
    prefix: 'yili', bookId: 'yili', title: '儀禮注疏', banxin: '儀禮',
    shuAuthor: '賈公彥', zhuDesc: '漢鄭玄注', era: '唐', seedBase: 23000,
    intro: '《儀禮注疏》為唐賈公彥等奉敕撰，以漢鄭玄注為本，為十三經注疏之一。儀禮十七篇，冠昏喪祭之制備焉，此卷以宋刻本版式數字重刻，半葉八行、行十六字、注文雙行二十五字。',
    sourceUrl: 'https://zh.wikisource.org/zh-hant/儀禮注疏', sourceLabel: '賈公彥《儀禮注疏》',
  },
  liji: {
    prefix: 'liji', bookId: 'liji', title: '禮記正義', banxin: '禮記',
    shuAuthor: '孔穎達', zhuDesc: '漢鄭玄注', era: '唐', seedBase: 24000,
    intro: '《禮記正義》為唐孔穎達等奉敕撰，以漢鄭玄注為本，為十三經注疏之一。禮記四十九篇，述禮之義理，此卷以宋刻本版式數字重刻，半葉八行、行十六字、注文雙行二十五字。',
    sourceUrl: 'https://zh.wikisource.org/zh-hant/禮記正義', sourceLabel: '孔穎達《禮記正義》',
  },
  'chunqiu-zuozhuan': {
    prefix: 'zuozhuan', bookId: 'zuozhuan', title: '春秋左傳正義', banxin: '左傳',
    shuAuthor: '孔穎達', zhuDesc: '晉杜預注', era: '唐', seedBase: 25000,
    intro: '《春秋左傳正義》為唐孔穎達等奉敕撰，以晉杜預注為本，為十三經注疏之一。左氏傳事詳而文贍，此卷以宋刻本版式數字重刻，半葉八行、行十六字、注文雙行二十五字。',
    sourceUrl: 'https://zh.wikisource.org/zh-hant/春秋左傳正義', sourceLabel: '孔穎達《春秋左傳正義》',
  },
  'chunqiu-gongyang': {
    prefix: 'gongyang', bookId: 'gongyang', title: '春秋公羊傳注疏', banxin: '公羊',
    shuAuthor: '徐彥', zhuDesc: '漢何休解詁', era: '唐', seedBase: 26000,
    intro: '《春秋公羊傳注疏》為唐徐彥疏，以漢何休解詁為本，為十三經注疏之一。公羊傳明經之大義，此卷以宋刻本版式數字重刻，半葉八行、行十六字、注文雙行二十五字。',
    sourceUrl: 'https://zh.wikisource.org/zh-hant/春秋公羊傳注疏', sourceLabel: '徐彥《春秋公羊傳注疏》',
  },
  xiaojing: {
    prefix: 'xiaojing', bookId: 'xiaojing', title: '孝經注疏', banxin: '孝經',
    shuAuthor: '邢昺', zhuDesc: '唐玄宗注', era: '宋', seedBase: 27000,
    intro: '《孝經注疏》為宋邢昺疏，以唐玄宗注為本，為十三經注疏之一。孝經十八章，言孝之始終，此卷以宋刻本版式數字重刻，半葉八行、行十六字、注文雙行二十五字。',
    sourceUrl: 'https://zh.wikisource.org/zh-hant/孝經注疏', sourceLabel: '邢昺《孝經注疏》',
  },
  lunyu: {
    prefix: 'lunyu', bookId: 'lunyu-zhushu', title: '論語注疏', banxin: '論語',
    shuAuthor: '邢昺', zhuDesc: '魏何晏集解', era: '宋', seedBase: 28000,
    intro: '《論語注疏》為宋邢昺疏，以魏何晏《論語集解》為本，為十三經注疏之一。論語二十篇，記孔子及門人言行，此卷以宋刻本版式數字重刻，半葉八行、行十六字、注文雙行二十五字。',
    sourceUrl: 'https://zh.wikisource.org/zh-hant/論語注疏', sourceLabel: '邢昺《論語注疏》',
  },
  mengzi: {
    prefix: 'mengzi', bookId: 'mengzi-zhushu', title: '孟子注疏', banxin: '孟子',
    shuAuthor: '孫奭', zhuDesc: '漢趙岐注', era: '宋', seedBase: 29000,
    intro: '《孟子注疏》為宋孫奭疏，以漢趙岐注為本，為十三經注疏之一。孟子七篇十四卷，記孟子遊說諸侯及與弟子問答之言，此卷以宋刻本版式數字重刻，半葉八行、行十六字、注文雙行二十五字。',
    sourceUrl: 'https://zh.wikisource.org/zh-hant/孟子注疏', sourceLabel: '孫奭《孟子注疏》',
  },
  erya: {
    prefix: 'erya', bookId: 'erya', title: '爾雅注疏', banxin: '爾雅',
    shuAuthor: '邢昺', zhuDesc: '晉郭璞注', era: '宋', seedBase: 30000,
    intro: '《爾雅注疏》為宋邢昺疏，以晉郭璞注為本，為十三經注疏之一。爾雅十九篇，為訓詁之祖、五經之通路，此卷以宋刻本版式數字重刻，半葉八行、行十六字、注文雙行二十五字。',
    sourceUrl: 'https://zh.wikisource.org/zh-hant/爾雅注疏', sourceLabel: '邢昺《爾雅注疏》',
  },
};

// ── 子标题硬编码（论语/孟子/尔雅）──
const SUB_TITLES = {
  lunyu: [
    '學而第一', '為政第二', '八佾第三', '里仁第四', '公冶長第五',
    '雍也第六', '述而第七', '泰伯第八', '子罕第九', '鄉黨第十',
    '先進第十一', '顏淵第十二', '子路第十三', '憲問第十四', '衛靈公第十五',
    '季氏第十六', '陽貨第十七', '微子第十八', '子張第十九', '堯曰第二十',
  ],
  mengzi: [
    '序', '梁惠王章句上', '梁惠王章句下', '公孫丑章句上', '公孫丑章句下',
    '滕文公章句上', '滕文公章句下', '離婁章句上', '離婁章句下',
    '萬章章句上', '萬章章句下', '告子章句上', '告子章句下',
    '盡心章句上', '盡心章句下',
  ],
  erya: [
    '疏叙', '序', '釋詁第一', '釋詁下', '釋言第二', '釋訓第三', '釋親第四',
    '釋宮第五', '釋器第六', '釋樂第七', '釋天第八', '釋地第九', '釋丘第十',
    '釋山第十一', '釋水第十二', '釋草第十三', '釋木第十四', '釋蟲第十五',
    '釋魚第十六', '釋鳥第十七', '釋獸第十八', '釋畜第十九',
  ],
};

// ── 从 vol_XX.txt 提取子标题 ──
function extractSub(raw, bookId, volNum) {
  // 硬编码优先
  if (SUB_TITLES[bookId] && SUB_TITLES[bookId][volNum - 1]) {
    return SUB_TITLES[bookId][volNum - 1];
  }
  const lines = raw.split(/\r?\n/).map((l) => l.replace(/\u3000/g, '').trim()).filter(Boolean);
  for (const l of lines.slice(0, 30)) {
    if (bookId === 'chunqiu-gongyang') {
      const m = l.match(/^[隐桓庄闵僖文宣成襄昭哀定]公/);
      if (m) return m[0];
    } else if (bookId === 'zhouli') {
      const m = l.match(/^◎(.+)/);
      if (m) return m[1];
    } else {
      const m = l.match(/^卷[一二三四五六七八九十百]+[上下]?\s+(.+)/);
      if (m) {
        let sub = m[1];
        if (bookId === 'chunqiu-zuozhuan') sub = sub.split(/[，,]/)[0];
        return sub;
      }
    }
  }
  return '正文';
}

// ── 生成单卷 meta.yaml 文本 ──
function renderMeta(cfg, volNum, sub, expectBlock) {
  const cn = cnNum(volNum);
  const id = `${cfg.prefix}-juan${volNum}`;
  const title = `${cfg.title}卷${cn}`;
  const exportBase = cfg.prefix.charAt(0).toUpperCase() + cfg.prefix.slice(1);
  const colophon =
    `依<b>宋刻本</b>版式排比：一版兩個半葉，中縫為版心。經文大字單行，注文小字雙行；疏隨經注而下，與經注列網格對齊，本列不敷乃另起列；雙行並進，長短相差不過一字。` +
    `<br>版心上下留白口，上鐫單黑魚尾，次書名卷次、葉次，末署刻工姓名。` +
    `<br>注文之制，備疏朗、雅正、宋槧三版，可於欄內遞轉；疏朗字大易誦，宋槧嚴守舊觀。` +
    `<br>句讀以朱筆點之，附於字之右下，不占字位，點之斜正輕重因字而變，以仿手批氣韻。` +
    `<br>本卷錄《${cfg.title}》卷${cn}${sub === '正文' ? '' : ' ' + sub}，經文據${cfg.zhuDesc}，疏文為${cfg.era === '宋' ? '宋' : '唐'}${cfg.shuAuthor}撰。`;
  return `id: ${id}
title: ${title}
subtitle: 宋刻本式樣 · ${cfg.shuAuthor}疏 · ${sub}
docTitle: ${title} — 宋版善刻
mark: 蘭木
ariaLabel: ${title}，宋刻本版式，自右向左讀
category: 經
era: ${cfg.era}
layout: songke
book:
  id: ${cfg.bookId}
  title: ${cfg.title}
  order: ${volNum}
  entry:
    big: 卷${cn}
    sub: ${sub}
seed: ${cfg.seedBase + volNum}
${expectBlock}songke:
  bigPerCol: 16
  subPerCol: 25
  colsPerHalf: 8
  banxinTitle: ${cfg.banxin}卷${cn}
  gong:
    - 某
  spec: 半葉八行 行十六字 注文雙行二十五字 白口 左右雙邊 單黑魚尾
  colophon: |-
    ${colophon}
faces:
  kai:
    font: lxgw-wenkai-tc
    label: 楷體
  song:
    font: zhuque-fangsong
    label: 宋體
  xing:
    font: ac-gyosyo
    label: 英雄行楷
fallbackStacks:
  kai: '"Kaiti TC","Kaiti SC","STKaiti","楷体","KaiTi","BiauKai","標楷體","TW-Kai","AR PL UKai TW","Noto Serif CJK TC",serif'
  song: '"Songti TC","Songti SC","STSong","SimSun","宋体","NSimSun","Source Han Serif TC","Noto Serif CJK TC","Noto Serif CJK SC",serif'
  xing: '"Xingkai SC","STXingkai","华文行楷","Kaiti TC","Kaiti SC","STKaiti","楷体","KaiTi","BiauKai","標楷體","TW-Kai","Noto Serif CJK TC",serif'
export:
  base: ${exportBase}-Juan${volNum}-Songke
  faces:
    kai: Kai
    song: Song
    xing: Xingkai
  scale: 1.6
  quality: 88
sources:
  - label: ${cfg.sourceLabel}
    url: ${cfg.sourceUrl}
aboutHtml: |-
  <h2>關於此卷</h2>
  <p>${cfg.intro}</p>
  <p>卷${cn}收${sub}，經注疏全帙。</p>
`;
}

// ── 主流程 ──
const onlyBook = process.argv[2];

for (const [bookId, cfg] of Object.entries(BOOKS)) {
  if (onlyBook && onlyBook !== bookId) continue;
  const volsDir = path.join('input_data', '十三经注疏', `${bookId}_vols`);
  if (!fs.existsSync(volsDir)) { console.warn(`跳过 ${bookId}：无 ${volsDir}`); continue; }
  const volFiles = fs.readdirSync(volsDir).filter((f) => /^vol_\d+\.txt$/.test(f)).sort();
  console.log(`\n=== ${cfg.title} (${volFiles.length} 卷) ===`);

  for (const vf of volFiles) {
    const volNum = parseInt(vf.match(/vol_(\d+)\.txt/)[1], 10);
    const workDir = path.join('works', `${cfg.prefix}-juan${volNum}`);
    const metaPath = path.join(workDir, 'meta.yaml');
    fs.mkdirSync(workDir, { recursive: true });

    // 阶段1：seals / ornaments / meta（无 expect）
    if (!fs.existsSync(path.join(workDir, 'seals.yaml'))) {
      fs.writeFileSync(path.join(workDir, 'seals.yaml'), '\uFEFFseals: []\r\n\r\n', 'utf8');
    }
    if (!fs.existsSync(path.join(workDir, 'ornaments.yaml'))) {
      fs.writeFileSync(path.join(workDir, 'ornaments.yaml'), '\uFEFForchids: []\r\n\r\n', 'utf8');
    }

    const raw = fs.readFileSync(path.join(volsDir, vf), 'utf8');
    const sub = SUB_TITLES[bookId] ? extractSub(raw, bookId, volNum) : s2tw(extractSub(raw, bookId));
    fs.writeFileSync(metaPath, renderMeta(cfg, volNum, sub, ''), 'utf8');

    // 阶段2：buildLayout 计算统计 → 回填 expect
    try {
      const tree = buildLayout(loadWork(`${cfg.prefix}-juan${volNum}`));
      const s = tree.stats;
      const expectBlock = `expect:\n  jChars: ${s.jChars}\n  zChars: ${s.zChars}\n  columns: ${s.columns}\n  halves: ${s.halves}\n  leaves: ${s.leaves}\n`;
      fs.writeFileSync(metaPath, renderMeta(cfg, volNum, sub, expectBlock), 'utf8');
      console.log(`  卷${volNum}（${sub}）：${s.leaves} 葉 / j=${s.jChars} z=${s.zChars}`);
    } catch (e) {
      console.error(`  ✗ 卷${volNum}：${e.message}`);
    }
  }
}

console.log('\n完成。');
