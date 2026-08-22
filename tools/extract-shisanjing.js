/**
 * 十三经注疏通用抽取脚本：vol_XX.txt → works/{id}-juan{N}/text.yaml (j/z blocks)
 *
 * 适用：毛诗正义、周礼注疏、仪礼注疏、礼记正义、春秋左传正义、春秋公羊传注疏、孝经注疏、论语注疏、孟子注疏、尔雅注疏
 * 数据来源：十三经注疏 exe（IE DOM 提取 → merge → split）
 * 结构：[疏] 行 → z 块（疏文）；论语/孟子：（...）→ z 块（注），余 → j 块（经）
 *        其余各书：[疏] → z，其余 → j（经注混排）
 *
 * 用法：node tools/extract-shisanjing.js [bookId]（缺省处理全部）
 */
const fs = require('fs');
const path = require('path');
const OpenCC = require('opencc-js');

const BOOKS = {
  maoshi: { title: '毛詩正義', volTitle: '毛詩正義', shuAuthor: '孔穎達', zhuAuthor: '毛亨傳、鄭玄箋' },
  zhouli: { title: '周禮注疏', volTitle: '周禮注疏', shuAuthor: '賈公彥', zhuAuthor: '鄭玄注' },
  yili: { title: '儀禮注疏', volTitle: '儀禮注疏', shuAuthor: '賈公彥', zhuAuthor: '鄭玄注' },
  liji: { title: '禮記正義', volTitle: '禮記正義', shuAuthor: '孔穎達', zhuAuthor: '鄭玄注' },
  'chunqiu-zuozhuan': { title: '春秋左傳正義', volTitle: '春秋左傳正義', shuAuthor: '孔穎達', zhuAuthor: '杜預注', worksPrefix: 'zuozhuan' },
  'chunqiu-gongyang': { title: '春秋公羊傳注疏', volTitle: '春秋公羊傳注疏', shuAuthor: '徐彥', zhuAuthor: '何休解詁', worksPrefix: 'gongyang' },
  xiaojing: { title: '孝經注疏', volTitle: '孝經注疏', shuAuthor: '邢昺', zhuAuthor: '唐玄宗注' },
  lunyu: { title: '論語注疏', volTitle: '論語注疏', shuAuthor: '邢昺', zhuAuthor: '魏何晏集解', alreadyTraditional: true, hasInlineNotes: true },
  mengzi: { title: '孟子注疏', volTitle: '孟子注疏', shuAuthor: '孫奭', zhuAuthor: '漢趙岐注', alreadyTraditional: true, hasInlineNotes: true },
  erya: { title: '爾雅注疏', volTitle: '爾雅注疏', shuAuthor: '邢昺', zhuAuthor: '晉郭璞注', alreadyTraditional: true },
};

// ── opencc s2tw + 修正（沿用尚书正义方案）──
const s2tw = OpenCC.Converter({ from: 'cn', to: 'tw' });
const CORRECT = {
  '嘆': '歎', '遊': '游', '慾': '欲', '繫': '系', '弔': '吊', '慼': '戚', '裡': '裏',
};
const fixOpencc = (s) => s.replace(/嘆|遊|慾|繫|弔|慼|裡/g, (c) => CORRECT[c] || c);

// ── 单行清理 ──
function clean(line) {
  return line
    .replace(/^\s+/g, '')
    .replace(/\s+$/g, '')
    .replace(/\u3000/g, '')
    .trim();
}

// ── 噪声行判断（页头页脚、水印、导航、卷标题）──
function isNoise(t, bookTitle) {
  if (t === '') return true;
  if (t.startsWith('《' + bookTitle + '》')) return true;        // 书名行 / 《书名》－卷X 标记
  if (t.startsWith('□')) return true;                            // 水印/版权
  if (/^(目录页|上一页|下一页)/.test(t)) return true;             // 导航
  if (/^(URL:|Title:|===CONTENT===)/.test(t)) return true;       // 仪礼特殊头
  if (/^卷[一二三四五六七八九十百]+/.test(t)) return true;       // 卷标题行
  if (/^[隐桓庄闵僖文宣成襄昭哀定]公卷/.test(t)) return true;    // 公羊：隐公卷一（…）
  return false;
}

// ── 判断「（」是否为注文起始（前一个字符是汉字/句末标点/引号 → 注）──
function isNoteOpen(prevChar) {
  if (!prevChar) return false;
  if (/[\u4e00-\u9fff\u3000-\u303f。！？；\u201c\u201d\u2018\u2019]/u.test(prevChar)) return true;
  return false;
}

// ── 解析含行内注文的文本（论语/孟子）：逐字符分离经、注、疏 ──
function parseWithNotes(lines, bookTitle) {
  const blocks = [];
  let jBuf = '', zBuf = '';
  let inNote = false, noteDepth = 0;

  function flush(type, text) {
    text = text.trim();
    if (!text) return;
    if (blocks.length && blocks[blocks.length - 1].type === type) {
      blocks[blocks.length - 1].text += '\n' + text;
    } else {
      blocks.push({ type, text });
    }
  }

  for (const rawLn of lines) {
    const ln = clean(rawLn);
    if (isNoise(ln, bookTitle)) continue;

    // [疏] 行：先结算当前状态，再整行入 z
    if (ln.startsWith('[疏]')) {
      if (inNote) { flush('z', zBuf); zBuf = ''; inNote = false; noteDepth = 0; }
      if (jBuf) { flush('j', jBuf); jBuf = ''; }
      flush('z', ln.replace(/^\[疏\]/, '').trim());
      continue;
    }

    // 注内续行（跨行括号）
    if (inNote) {
      for (const ch of ln) {
        if (ch === '（') noteDepth++;
        else if (ch === '）') {
          noteDepth--;
          if (noteDepth <= 0) { inNote = false; noteDepth = 0; continue; }
        }
        zBuf += ch;
      }
      if (!inNote) { flush('z', zBuf); zBuf = ''; }
      continue;
    }

    // 逐字符扫描：分离经与注
    for (let i = 0; i < ln.length; i++) {
      const ch = ln[i];
      if (ch === '（' && (i === 0 || isNoteOpen(ln[i - 1]))) {
        if (jBuf) { flush('j', jBuf); jBuf = ''; }
        inNote = true; noteDepth = 1; zBuf = '';
      } else if (inNote) {
        if (ch === '（') noteDepth++;
        else if (ch === '）') {
          noteDepth--;
          if (noteDepth <= 0) { flush('z', zBuf); zBuf = ''; inNote = false; continue; }
        }
        zBuf += ch;
      } else {
        jBuf += ch;
      }
    }
    if (inNote) {
      zBuf += '\n';   // 注跨行保留换行
    } else {
      if (jBuf) { flush('j', jBuf); jBuf = ''; }
    }
  }
  if (jBuf) flush('j', jBuf);
  if (zBuf) flush('z', zBuf);
  return blocks;
}

// ── 解析单卷为 j/z 块 ──
function parseVol(raw, bookTitle, cfg) {
  const lines = raw.split(/\r?\n/);
  let blocks;
  if (cfg.hasInlineNotes) {
    blocks = parseWithNotes(lines, bookTitle);
  } else {
    blocks = [];
    for (const ln of lines) {
      const t = clean(ln);
      if (isNoise(t, bookTitle)) continue;
      if (t.startsWith('[疏]')) {
        const text = t.replace(/^\[疏\]/, '').trim();
        if (text) blocks.push({ type: 'z', text });
      } else {
        blocks.push({ type: 'j', text: t });
      }
    }
  }
  // s2tw + 修正（已是繁體的書跳過）
  for (const b of blocks) {
    b.text = cfg.alreadyTraditional ? b.text : fixOpencc(s2tw(b.text));
  }
  return blocks;
}

// ── 生成 text.yaml ──
function writeYaml(blocks, outPath, header, volNum) {
  const yamlLines = [];
  yamlLines.push(`# ${header}`);
  yamlLines.push(`sections:`);
  yamlLines.push(`  - id: juan${volNum}`);
  yamlLines.push(`    name: 正文`);
  yamlLines.push(`    blocks:`);
  for (const b of blocks) {
    const escaped = b.text
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/[\x00-\x1f]/g, '');
    yamlLines.push(`      - { type: ${b.type}, text: "${escaped}" }`);
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, yamlLines.join('\n') + '\n', 'utf8');
}

// ── 主流程 ──
const onlyBook = process.argv[2];
let totalVols = 0;

for (const [bookId, cfg] of Object.entries(BOOKS)) {
  if (onlyBook && onlyBook !== bookId) continue;
  const volsDir = path.join('input_data', '十三经注疏', `${bookId}_vols`);
  if (!fs.existsSync(volsDir)) {
    console.warn(`跳过 ${bookId}：${volsDir} 不存在`);
    continue;
  }
  const prefix = cfg.worksPrefix || bookId;
  const volFiles = fs.readdirSync(volsDir).filter((f) => /^vol_\d+\.txt$/.test(f)).sort();
  console.log(`\n=== ${cfg.title} (${volFiles.length} 卷) ===`);
  for (const vf of volFiles) {
    const volNum = parseInt(vf.match(/vol_(\d+)\.txt/)[1], 10);
    const raw = fs.readFileSync(path.join(volsDir, vf), 'utf8');
    const blocks = parseVol(raw, cfg.volTitle, cfg);
    const jChars = blocks.filter((b) => b.type === 'j').reduce((s, b) => s + b.text.length, 0);
    const zChars = blocks.filter((b) => b.type === 'z').reduce((s, b) => s + b.text.length, 0);
    const outPath = path.join('works', `${prefix}-juan${volNum}`, 'text.yaml');
    writeYaml(blocks, outPath, `${cfg.title}卷${volNum}（${cfg.shuAuthor}疏）：j 為經文，${cfg.zhuAuthor}為注，z 為疏文。`, volNum);
    console.log(`  卷${volNum}: j=${jChars} z=${zChars} → ${outPath}`);
    totalVols++;
  }
}

console.log(`\n完成：共生成 ${totalVols} 卷 text.yaml`);
