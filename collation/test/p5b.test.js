#!/usr/bin/env node
'use strict';

const assert = require('assert');
const vm = require('vm');
const {
  rawPunctuationText,
  validatePunctuationMarks,
  applyPunctuationMarks,
  punctuationSourceHash,
} = require('../src/punctuate');
const { buildReview } = require('../src/full-review');
const review = require('../src/review');

function seg(segId, text, page = 1, regionId = 'p1-r001', score = 1) {
  return {
    segId,
    score,
    xiandai: { raw: text + '。', page },
    shanben: { detail: [...text].map(ch => ({ sb: { ch, page, line: 1, regionId, sourceHash: 'same' } })) },
  };
}

const marks = [{ at: 2, char: '，' }, { at: 5, char: '。' }];
assert.deepStrictEqual(rawPunctuationText('大學之道，明明德。'), '大學之道明明德');
assert.strictEqual(validatePunctuationMarks('大學之道明明德', marks).ok, true);
assert.strictEqual(applyPunctuationMarks('大學之道明明德', marks), '大學，之道明。明德');
assert.strictEqual(validatePunctuationMarks('大學', [{ at: 4, char: '。'}]).ok, false);
assert.strictEqual(punctuationSourceHash([{ segId: 1, raw: '甲乙' }]).length, 64);

const r = buildReview({
  work: { id: 'fixture' },
  cleaned: { shanben: { m2: { sha256: 'm2', pendingCount: 0 } } },
  segments: [seg(1, '甲乙丙丁戊己庚辛'), seg(2, '丙丁戊己庚辛壬癸')],
});
assert(r.findings.some(f => f.kind === 'duplicate-overlap' && f.severity === 'blocker'));
assert.strictEqual(r.scores.status, 'blocked');

const payload = review.buildPayload({ verdicts: [{
  diffId: 'v1', type: '真异文', shanben: '之', xiandai: '至', seg: '甲乙', verdict: 'suspended',
  opinions: [{ name: '校书官', adopt: 'shanben', confidence: 0.8, 线索: ['线索一', '线索二'] }],
}] }, 'fixture');
assert.strictEqual(payload.cases[0].opinions[0].clue, '线索一；线索二');
const html = review.buildReviewApp(payload, {});
const script = html.match(/<script>\n([\s\S]*?)\n<\/script>/)[1];
assert(!script.includes("c.sbPage']"), '精校台不得含游离单引号');
assert.doesNotThrow(() => new vm.Script(script), '生成的精校台脚本必须可解析');

console.log('✓ p5b.test：全篇审查、标点操作和精校台回归断言通过');
