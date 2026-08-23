/**
 * 手卷版式模型：WorkData → LayoutTree（中间表示，三渲染器共用）。
 * 引首 / 正文 / 拖尾 / 绢边 / 卷轴的几何均来自 meta.scroll。
 */
const { typeset } = require('../typeset');
const { mountSeals, mountOrchids } = require('../mount');
const { buildSongke } = require('./songke');
const { buildSongkeFacsimile } = require('./songke-facsimile');
const { buildManuscript } = require('./manuscript');

function buildScroll(work) {
  const { meta } = work;
  if (meta.layout !== 'scroll') throw new Error(`作品 ${work.id} 的版式不是 scroll: ${meta.layout}`);
  const { columns, stats } = typeset(work);

  // 数据量校验（meta.expect 为校录基准）
  if (meta.expect) {
    for (const k of Object.keys(meta.expect)) {
      if (stats[k] !== meta.expect[k]) {
        throw new Error(`数据校验失败 ${k}: 实得 ${stats[k]} ≠ 基准 ${meta.expect[k]}（请核对 text.yaml 校录）`);
      }
    }
  }

  return {
    kind: 'scroll',
    meta,
    dims: meta.scroll,
    faces: meta.faces,
    fallbackStacks: meta.fallbackStacks,
    columns,
    seals: mountSeals(work.seals),
    orchids: mountOrchids(work.ornaments, work.orchidShapes),
    paperDecor: work.paperDecor || '',
    hasScan: !!work.scan,
    stats,
  };
}

const MODELS = { scroll: buildScroll, songke: buildSongke, 'songke-facsimile': buildSongkeFacsimile, manuscript: buildManuscript };

/** 按作品 meta.layout 选择版式模型构建 LayoutTree */
function buildLayout(work) {
  const model = MODELS[work.meta.layout];
  if (!model) throw new Error(`未知版式: ${work.meta.layout}（已支持：${Object.keys(MODELS).join(', ')}）`);
  return model(work);
}

module.exports = { buildLayout, buildScroll };
