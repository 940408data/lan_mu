#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { cleanEdition, splitInlineApparatus, stripFootnoteRefs } = require('../src/cleanup');
const { buildXiandaiText } = require('../src/punctuate');
const { suffixPrefixOverlap, evaluateAlignment } = require('../src/quality');

const work = { id: '大学章句', title: '大學章句' };
const modern = {
  id: 'fixture-modern', role: 'xiandai', level: 'B',
  pages: [
    {
      n: 1,
      raw: 'fixture-p1',
      isCover: false,
      lines: [
        '大學章句序',
        '正文甲。 $ ^{①} $正文乙。',
        '大學章句序',
        '時則有若孔子之聖，司禮監本、吴本有「矣」字。',
        '程子曰：「親，當作新。」○大學者，大人之學也。',
      ],
    },
    {
      n: 2,
      raw: 'fixture-p2',
      isCover: false,
      lines: ['正文丙。', '大', '學', '①「止」，原作「至」，據吴本改。'],
    },
  ],
};

const cleaned = cleanEdition(modern, work);
assert(cleaned.bodyText.includes('大學章句序'), '首次结构标题应保留');
assert.strictEqual((cleaned.bodyText.match(/大學章句序/g) || []).length, 1, '重复页眉不得进入正文');
assert(!cleaned.bodyText.includes('$'), 'LaTex 脚注标记不得进入正文');
assert(!cleaned.bodyText.split(/\n/).includes('大'), '拆分书题不得进入正文');
assert(!cleaned.bodyText.includes('司禮監本'), '明确版本校记不得进入正文');
assert(cleaned.bodyText.includes('程子曰：「親，當作新。」'), '原注中的“當作”不得误删');
assert.strictEqual(cleaned.stats.byKind.running_head, 2);
assert.strictEqual(cleaned.stats.byKind.footnote, 1);
assert.strictEqual(cleaned.stats.byKind.footnote_ref, 1);
assert.strictEqual(cleaned.stats.byKind.collation_note, 1);
assert.strictEqual(cleaned.quality.publishable, true);
assert.strictEqual(buildXiandaiText(cleaned), cleaned.bodyText, '现代本导出必须复用唯一清洗正文源');
assert.throws(() => buildXiandaiText(modern), /缺少 P1.5 清洗正文流/);

const inline = splitInlineApparatus('正文，司禮監本有「矣」字。');
assert.deepStrictEqual(inline, { body: '正文', note: '司禮監本有「矣」字。' });
assert.strictEqual(splitInlineApparatus('程子曰：「親，當作新。」').note, '');
assert.deepStrictEqual(stripFootnoteRefs('甲 $ ^{①} $乙'), { text: '甲 乙', refs: ['①'] });

const shanben = cleanEdition({
  id: 'fixture-shanben', role: 'shanben', level: 'A',
  pages: [
    { n: 1, raw: '宋本大學章句', lines: ['宋本大學章句'], isCover: true },
    { n: 2, raw: '大學章句序大學之書', lines: ['大學章句序大學之書'], isCover: false },
  ],
}, work);
assert(!shanben.bodyText.includes('宋本大學章句'), '善本封面不得进入正文');
assert(shanben.bodyText.includes('大學章句序大學之書'), '善本正文原字应保留');

assert.strictEqual(suffixPrefixOverlap('甲乙丙丁戊己庚辛', '丙丁戊己庚辛壬癸', 4), 6);
const alignmentQuality = evaluateAlignment({ segments: [
  { segId: 1, score: 0.75, orphan: false, shanben: { detail: [...'甲乙丙丁戊己庚辛'].map(ch => ({ sb: { ch } })) } },
  { segId: 2, score: 1, orphan: false, shanben: { detail: [...'丙丁戊己庚辛壬癸'].map(ch => ({ sb: { ch } })) } },
  { segId: 3, score: 0, orphan: true, shanben: { detail: [] } },
] });
assert.strictEqual(alignmentQuality.lowScore, 1);
assert.strictEqual(alignmentQuality.orphan, 1);
assert.strictEqual(alignmentQuality.adjacentOverlaps.length, 1);
assert.strictEqual(alignmentQuality.pass, false);

console.log('✓ cleanup.test：双本清洗、审计分流与防误删断言通过');
