/**
 * 装帧层：印章与点缀（兰花）的数据规整，供各渲染器共用。
 * 数据在 works/<id>/seals.yaml、ornaments.yaml、assets/orchids.json 中，
 * 此处只做结构校验与派生几何计算，不改变设计值。
 */

/** 校验并规整印章数据（w/h 为印面宽高，非正方形印章如 30×76 竖长印） */
function mountSeals(seals) {
  return seals.map((s, i) => {
    if (!s.chars || !s.chars.length) throw new Error(`第 ${i + 1} 枚印章无印文`);
    if (!['朱文', '白文'].includes(s.style)) throw new Error(`第 ${i + 1} 枚印章 style 须为 朱文/白文`);
    if (!(s.w > 0) || !(s.h > 0)) throw new Error(`第 ${i + 1} 枚印章缺印面宽高 w/h`);
    return {
      x: s.x, y: s.y, rotate: s.rotate || 0,
      w: s.w, h: s.h, style: s.style, fontSize: s.fontSize,
      chars: s.chars.map((c) => ({ ch: c.ch, x: c.x, y: c.y })),
    };
  });
}

/** 校验并规整兰花点缀：placements 引用 shapes 的序号；shape 为原始 svg 片段，原样透传保真 */
function mountOrchids(ornaments, shapes) {
  return ornaments.map((o, i) => {
    if (o.shape < 0 || o.shape >= shapes.length) throw new Error(`第 ${i + 1} 处兰花引用了不存在的笔形 ${o.shape}`);
    return { x: o.x, y: o.y, sx: o.sx, sy: o.sy, opacity: o.opacity, svg: shapes[o.shape] };
  });
}

module.exports = { mountSeals, mountOrchids };
