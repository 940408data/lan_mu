# 首页/书库页加载加速：aggregateSite 缓存 + 轻量 meta 装载

## Context

线上 `111.229.37.224:8125`（serve.js 预览端）进首页 `/` 与书库 `/shuku/` 缓慢。根因：`serve.js` 对 5 个站点动态路由（`/`、`/sanzang/`、`/shuku/`、`/topics/<id>`、`/books/<id>`）**每次请求都调 `aggregateSite()`**，而后者遍历全部 101 个作品、逐个 `loadWork()` 同步 `readFileSync`+`YAML.parse` **每个作品的全部数据文件**（meta + text + grid + seals + ornaments + orchids.json，grid 动辄数百 KB），但聚合**只用 `meta`**。无任何缓存，故每次请求都重算「101 × 全量 parse」。生产 nginx 托管静态 `dist/*.html`（`gen-index.js` 预生成，不调 aggregateSite），不受影响；优化目标仅 serve.js 动态预览（含线上）。

目标：首页/书库二次起访问从「秒级」降到「几十 ms 内」，且保留 dev 热重载（改 YAML 即时生效）。

## 方案：进程内 memo + mtime 指纹失效（核心两步）

### 1. `src/site/aggregate.js`：给 `aggregateSite()` 加 mtime 失效缓存

新增模块级缓存与指纹函数：

```js
let _cache = { fp: null, result: null };
function fingerprint() {
  // stat 101 个 meta.yaml 的 mtimeMs + listWorks() id 列表 → 拼指纹串
  // existsSync/stat 比 parse YAML 快数个数量级
  const ids = listWorks();
  const mtimes = ids.map(id => fs.statSync(path.join(ROOT,'works',id,'meta.yaml')).mtimeMs);
  return ids.join(',') + '|' + mtimes.join(',');
}
function aggregateSite() {
  const fp = fingerprint();
  if (_cache.fp === fp) return _cache.result;   // 命中：直接返回，跳过全量 parse
  // …原聚合逻辑（改为调 loadMeta，见下）…
  _cache = { fp, result: { books, warnings, catOrder: CAT_ORDER } };
  return _cache.result;
}
```

- 命中时**零 parse**，只 stat 101 文件（几 ms）；未命中才重算。
- 改 `meta.yaml` / 增删作品 → 指纹变 → 下次请求重算 → 热重载保留。
- `aggregate.js` 顶部需 `const fs = require('fs'); const path = require('path');` + 复用 `load.js` 的 `ROOT`（已 export）。
- 缓存为进程内内存：serve.js 重启后首次请求冷启一次（可接受）。

### 2. `src/core/load.js`：新增 `loadMeta(workId)`，聚合改用它

`loadWork()` 全量读 5+ 文件，聚合只需 meta。新增轻量装载器，供 aggregate 用：

```js
function loadMeta(workId) {
  const dir = path.join(ROOT, 'works', workId);
  if (!fs.existsSync(dir)) throw new Error(`作品不存在: works/${workId}`);
  const metaPath = path.join(dir, 'meta.yaml');
  if (!fs.existsSync(metaPath)) throw new Error(`作品 ${workId} 缺 meta.yaml`);
  // 保持与 loadWork 一致的「缺数据源」warning 语义：仅 existsSync 探测，不 parse 内容
  const hasSrc = fs.existsSync(path.join(dir,'text.yaml')) || fs.existsSync(path.join(dir,'grid.yaml'));
  return { id: workId, dir, meta: readYaml(metaPath), hasSrc };
}
// module.exports 增加 loadMeta
```

`aggregate.js` 的循环改为：
- `w = loadMeta(workId)`（替代 `loadWork`）；`if (!w.hasSrc) warnings.push(...缺数据源...)`；
- `const m = w.meta`（其余逻辑不变：`m.book`/`m.layout`/`m.category`/`m.songke.gong`/`m.stage` 全在 meta）。

**效果**：即便缓存未命中（冷启 / 改了 YAML），聚合也从「parse 101 个完整 WorkData（含大 grid）」降到「parse 101 个小 meta.yaml + stat 探测」——首次也快数倍。

## 关键文件

- `src/site/aggregate.js` — 加 `_cache`/`fingerprint()`/memo 逻辑（主改）
- `src/core/load.js` — 新增 `loadMeta`，导出（小改）
- 其余调用方（`tools/serve.js`、`src/site/render.js`、`tools/gen-index.js`）**无需改**——aggregateSite 签名不变，透明加速

## 暂不做（避免过度设计）

- **不做** serve.js 整页 HTML 缓存：aggregate 缓存后，`renderHome` 剩余开销（`searchIndex` OpenCC 遍历 + `SITE_CSS` 读 CSS）量级小（估 20–60ms），先不引入整页缓存及其额外失效管理；若实测仍慢再追加。
- **不改** `render.js` 的 `SITE_CSS()` 每请求读文件、`siteFaces()` 每请求重算：量级远小于 101×全量 parse，本方案聚焦最大杠杆；留作后续可选。

## 验证

1. 起本地预览：`node tools/serve.js 8125`
2. 冷启计时：`curl -o /dev/null -s -w "%{time_total}s\n" http://localhost:8125/`（首次，应快于改前；记录基线）
3. 热命中计时：再 curl `/` 与 `/shuku/` 各一次（应显著快于冷启，几十 ms 内）
4. 热重载：改某作品 `meta.yaml`（如 `works/mengzi/meta.yaml` 加一个空格）→ curl `/`，应触发重算（指纹变）且页面反映改动；再 curl 应命中新缓存
5. 增删作品：在 `works/` 临时加/删一个目录 → 指纹变 → 重算
6. `npm run validate` 确认数据校验不受影响（loadMeta 仅新增，loadWork 仍在、validate 路径不变）
7. 截图目检首页/书库渲染无回归（可选：元素级截图 `.shelf` 或 `.cabinet`）
