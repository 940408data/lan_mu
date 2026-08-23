# 宋版版心刻工统一 + 页码汉字生效 + 书库合并 + 底本标记修正

## Context

三个关联问题：
1. **版心 gong（刻工位）+ 页码**：上一轮已改 numCn 百千位（songke-facsimile/songke/aggregate 三处源码）+ 孟子 14 卷 gong→蘭木，但 **viewer JS 内联进 HTML（`html-songke.js:16`/`html-songke-facsimile.js:14` readFileSync），须 rebuild 才生效**。且 gong 只改了孟子 14 卷，其余 380+ songke 作品仍是「牛山/某/空」占位。
2. **书库组织**：论语/孟子每卷 book.id 各异（`lunyu-songben-volN`）→ aggregate.js 按 book.id 分桶，每卷独立一条书影（共 24 条）。真实逻辑应只列书名，卷在目录页引用。
3. **底本标记**：B 类「善本底」系列（daxue-songben 等）subtitle 误标「当涂郡斋刊递修本」但 colophon 自承「通行本為據」；C 类 facsimile（真宋当涂郡斋本）title 含「（影刻直出）」须去，底本须标【宋当涂郡斋本】。

用户已确认范围：① gong **全部 songke（380+，含注疏「某」）统一蘭木**；② A 类排版本底本保持「宋刻本式樣」不改；③ 「书签」title 去后缀 + slip 核（已无）；④ 中庸 facsimile 待后新建，本次不涉及。

## 作品分类（已查证）

| 类 | 引擎 | 作品 | 底本 | 本次处理 |
|---|---|---|---|---|
| A 排版本 | songke | daxue/zhongyong/lunyu/mengzi + lunyu2-10/mengzi2-14 + daxuexu/zhongyongxu/lunyuxu/lunyudu/mengzixu | 现代通行本（subtitle「宋刻本式樣」是版式描述；底本 badge 在 home.js diben 误标当涂） | gong→蘭木；home.js diben→现代通行本 |
| B 善本底 | songke | daxue-songben/zhongyong-songben/daxue-songben-g5/zhongyong-songben-g5/zhongyongxu-songben | 真当涂郡本（songke 引擎非 facsimile，试验性） | gong→蘭木；title 善本底→【当涂试验】；subtitle 保留当涂 |
| C 影刻直出 | songke-facsimile | daxue-facsimile/lunyu-songben-vol{1,2,3,4,7,8,9,10}/mengzi-songben-vol{1..14}/mengzi-xushu | 真宋当涂郡斋本 | gong→蘭木（孟子14已改，余10待）；title 去「（影刻直出）」；subtitle→宋当涂郡斋本；book.id 统一 |
| D 注疏 | songke | lunyu-juan1-20/mengzi-juan1-15/liji-juan*/zuozhuan-juan*/zhouyi*/shangshu* 等 | 邢昺/孙奭等注疏 | gong「某/空」→蘭木；底本不改 |

## 任务 1：gong 全部统一蘭木 + numCn rebuild

### 1a. gong → 蘭木（node 批量脚本）
扫所有 `works/*/meta.yaml`，对 `layout: songke` 改 `meta.songke.gong` 数组首元素→蘭木（空数组 push 蘭木）；对 `layout: songke-facsimile` 改 `meta.facsimile.gong`。孟子 14 卷已改（脚本幂等跳过）。
- 字体：蘭木二字已在 `mark: 蘭木` 收入子集（`src/fonts/subset.js:62` metaChars 含 mark）。

### 1b. numCn rebuild 生效
源码已改三处（songke-facsimile.js:17 / songke.js:40 / aggregate.js:15）。rebuild：
- 全部 songke + facsimile 作品 `--only=html`（约 404 个）。脚本批量循环 `node tools/cli.js build --work=<id> --only=html`。
- 站点页 `node tools/gen-index.js` 重建（numCn + gong + 书目合并一并生效）。

## 任务 2：书库书目合并（25 个 meta book.id 统一）

`src/site/aggregate.js:72` 按 `meta.book.id` 分桶合并同书各卷。改 25 个 facsimile meta 的 book.id：
- `lunyu-songben-vol{1..10}` → `book.id: lunyu-songben`，`title: 論語集注`（去「（影刻直出）」与 work title 一致），order/entry 保持
- `mengzi-songben-vol{1..14}` + `mengzi-xushu` → `book.id: mengzi-songben`，`title: 孟子集注`，xushu `order: 0`（<1 自动「並序」caption）

合并后：`/shuku/` 各一条书影（凡十卷 / 凡十四卷並序）；`/books/lunyu-songben/`、`/books/mengzi-songben/` 目录页列各卷 entry。

配套：
- `src/site/home.js` BOOK_META 若按旧 id（`lunyu-songben-vol1`）配须更新为新 id（待查）。
- 清理旧 dist：`rm -rf dist/books/lunyu-songben-vol* dist/books/mengzi-songben-vol* dist/books/mengzi-xushu`。
- 首页 panel `BOOK_ORDER` 只含 `lunyu/mengzi`（旧排版本），影刻本是否上首页本次可选（用户未要求）。

## 任务 3：底本标记

### 3a. home.js BOOK_META（A 类首页四书 panel 底本 badge）
`src/site/home.js:44` BOOK_META 的 daxue/zhongyong/lunyu/mengzi（A 类排版本）`diben: '當塗郡本'`→`'现代通行本'`（A 类底本实为现代通行本，误标当涂——badge 显示 [精校]【当涂郡本】→[精校]【现代通行本】）。collation 保持。
facsimile（真宋当涂郡斋本）不在 BOOK_META（首页 panel `books:['daxue','zhongyong','lunyu','mengzi']` 列 A 类旧排版本），其底本【宋当涂郡斋本】标在 meta subtitle/sources（见 3c）。若要首页改展示影刻本须加 BOOK_META facsimile 条目 + 改 panel books——本次可选，用户未要求。

### 3b. B 类善本底（5 个：底本真当涂郡本，songke 引擎非 facsimile，标【当涂试验】）
- `title: 大學章句（善本底）` → `大學章句【当涂试验】`（标当涂试验，示底本当涂但用 songke 引擎非影刻直出）；book.title 同步
- `subtitle: 当涂郡斋刊递修本 · 经注分栏` **保留**（B 类底本真当涂郡本，不改）
- `colophon` 措辞「文本以朱熹《四書章句集注》通行本為據，校錄重排，與宋本原刻容有出入」与当涂底矛盾，建议改「以当涂郡斋刊递修本为底，校录重排」（执行时定，或保留体现试验性）
- gong 牛山→蘭木（任务 1a）

### 3c. C 类 facsimile（24 个：真宋当涂郡斋本）
- `title: 大學章句（影刻直出）` → `大學章句`；`論語集注·卷一（影刻直出）` → `論語集注·卷一`；`孟子集注·序說（影刻直出）` → `孟子集注·序說`（去后缀）
- `subtitle: 当涂郡斋刊递修本 · 逐格还原` → `宋当涂郡斋本 · 逐格还原`
- `spec`/`colophon`/`aboutHtml` 的「當塗郡齋刊遞修本」→「宋当涂郡斋本」（统一简称）
- `sources.label` 统一为 `宋当涂郡斋本《四书章句集注》（中国国家图书馆藏）`（daxue-facsimile 当前是「朱熹《四書章句集注》」wikisource，须改；mengzi 已近，简化）
- `slip: 宋本XXX` 确认无「影刻直出」（已确认，不改）
- gong 牛山→蘭木（任务 1a，论语 8+大学 1+序 1 待改）
- book.title 去后缀与 work title 一致（任务 2）

### 3d. A 类排版本：保持「宋刻本式樣」不改

## 改动文件清单

**meta.yaml（批量）**：
- B 类 5 个：daxue-songben / zhongyong-songben / daxue-songben-g5 / zhongyong-songben-g5 / zhongyongxu-songben
- C 类 24 个：daxue-facsimile / lunyu-songben-vol{1,2,3,4,7,8,9,10} / mengzi-songben-vol{1..14} / mengzi-xushu
- A 类约 20 个 + D 类约 360 个：仅 gong→蘭木（node 脚本批量）

**源码**：src/viewer/songke-facsimile.js / songke.js / site/aggregate.js（numCn 已改）+ src/site/home.js（BOOK_META.diben 四书 当涂→当代流行本）

**重建**：全部 songke+facsimile HTML（--only=html）+ gen-index 站点页 + dist 旧 books 清理

## 执行顺序

1. node 脚本批量改 gong（全部 songke+facsimile → 蘭木）
2. node 脚本改 C 类 24 个 title 去后缀 + subtitle/sources→宋当涂郡斋本 + book.id 统一
3. node 脚本改 B 类 5 个 title→【当涂试验】（subtitle 保留当涂）；改 home.js BOOK_META.diben 四书 当涂→现代通行本
4. 批量 rebuild：四书相关（A+B+C+D 注疏四书）先 `--only=html`，再其他（zhouyi/shangshu/liji/zuozhuan/changwuzhi/zunshengbajian）
5. `node tools/gen-index.js` 重建站点页
6. 清理旧 dist/books
7. 验证

## 验证

1. **gong**：DOM 验证 facsimile（论语/大学/孟子）+ songke（注疏一卷）版心显示「蘭木」
2. **页码**：DOM 验证 numCn 百位（论语/孟子 p100+ → 汉字，如 p507→五百零七）
3. **书库**：`/shuku/` 论语/孟子影刻本各一条书影（凡十卷/凡十四卷並序）；`/books/lunyu-songben/` 目录页列 10 卷 entry
4. **底本**：facsimile title 无「（影刻直出）」，subtitle「宋当涂郡斋本」；B 类 subtitle「当代流行本」title「（通行本）」
5. `npm run validate` 全作品通过 + `npm run verify` 幽兰保真（改 songke viewer 不影响手卷）
6. pre-commit hook 自动跑 validate+verify（改 src/viewer 触发 verify）

## 风险

- **工作量大**：380+ 作品 rebuild HTML 耗时（每卷 ~10s，约 1 小时+）。分批执行，四书先验证。
- **dist 不入 git**（.gitignore）：只提交源码 meta 改动 + 源码 numCn；dist 由生产 CI 重建。但本地预览需 rebuild。
- **home.js BOOK_META**：若按旧 book.id 配置须同步（待执行时查 home.js 确认）。
- **注疏 gong「某」→蘭木**：注疏（邢昺/孙奭）非朱熹集注、非兰木主轴，用户确认全改蘭木（统一版心制者署名）。
