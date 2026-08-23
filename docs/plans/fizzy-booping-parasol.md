# 4 项修正：shuku 底本 + 目录页卷次 + 字体双轨 + 换页键

## Context

用户反映 4 个显示/交互问题（http://111.229.37.224:8125/shuku/）：
1. **shuku 底本**：A 类仍显当涂郡本（dev server 旧进程）、C 类未显示【宋当涂郡斋本】。
2. **目录页卷次**：C 类（论语/孟子）目录页全显统一"論語/集注"，无"第几卷"。
3. **字体双轨**：songke/songke-facsimile 单轨 faces，切简体仍用繁体字体（TC 适配差）；应照 scroll 双轨（faces 繁 + facesSc 简，独立三套）。
4. **换页键**：右键应往下页（后叶）、左键往上页（前叶），现相反。

## 问题1：shuku 底本（home.js BOOK_META）

shuku 卡片底本 = `BOOK_META[book.id].diben`（`aggregate.js:104` 按 book.id 查 + `render.js:77` 渲 `<span class="bi">`）。
- A 类（daxue/zhongyong/lunyu/mengzi）已改现代通行本，dist 静态已正确（4×现代通行本 0 当涂）。**dev server serve.js 旧进程 require cache 缓存旧 BOOK_META**——重启 serve.js 即刷新。
- **C/B 类 book.id 在 BOOK_META 无 key** → diben undefined 不显示底本（默认 collation AI整理）。

**修复**：`src/site/home.js` BOOK_META 加 key（仿 daxue 行）：
```js
'lunyu-songben':     { collation: '精校', diben: '宋当涂郡斋本' },
'mengzi-songben':    { collation: '精校', diben: '宋当涂郡斋本' },
'daxue-facsimile':   { collation: '精校', diben: '宋当涂郡斋本' },
'daxue-songben':     { collation: '初校', diben: '宋当涂郡斋本' },  // B类当涂试验
'zhongyong-songben':{ collation: '初校', diben: '宋当涂郡斋本' },
```

## 问题2：目录页卷次（改 24 C 类 meta entry）

`render.js` tocCols（L425-436）entry big=`v.entry.big` sub=`v.entry.sub`，不用 order。A 类 entry 已手写（`big:卷之一 sub:梁惠王章句上` / `學而第一　為政第二`）。C 类 entry 固定（big:孟子/論語 sub:集注）无卷次无篇名。

**修复**（用户确认改 meta entry，与 A 类一致）：脚本批量改 24 C 类 meta 的 `book.entry`：
- `big: 卷之{numCn(order)}`（order 1→卷之一，14→卷之十四；xushu order 0 → `big: 序`）
- `sub: 篇名`（从 subtitle 提：去前两段"宋当涂郡斋本·逐格还原·"，剩篇名段；多篇的 `·` → `　`全角空格，与 A 类 lunyu 一致）
  - mengzi-vol1: `big: 卷之一, sub: 梁惠王章句上`
  - lunyu-vol1: `big: 卷之一, sub: 學而第一　爲政第二`
  - daxue-facsimile: `big: 卷之一, sub: 大學章句`（单卷，从 subtitle 提）
  - mengzi-xushu: `big: 序, sub: 孟子集注序說`
- renderer 不动（tocCols 仍读 v.entry.big/sub，现在 C 类 entry 有卷次篇名）。

## 问题3：字体双轨（433 meta + 2 渲染器 + 2 viewer）

`load.js`/`fonts.js`/`subset.js` **已支持双轨**（`scRolesOf`/`resolveScFaces`/`scFallbackOf` 通用，不检查 layout；subset:79-82 已用 scRolesOf）。无需改。

### 3a. 批量补 433 meta facesSc + fallbackStacksSc + defaultSc
用户确认批量补（各作品独立三套，与 scroll 一致）。统一三套（kai/song/xing → SC 字体）：
```yaml
facesSc:
  kai: { label: 楷體 }                              # 系统 SC 楷回退
  song: { label: 宋體 }                             # 系统 SC 宋回退
  xing: { font: liushang-xingyi, label: 行書 }      # A级嵌入（fonts.yaml 已登记）
defaultSc: kai
fallbackStacksSc:
  kai: '"Kaiti SC","STKaiti","楷体","KaiTi","BiauKai","TW-Kai","Noto Serif CJK SC",serif'
  song: '"Songti SC","STSong","SimSun","宋体","NSimSun","Source Han Serif SC","Noto Serif CJK SC",serif'
  xing: '"Xingkai SC","STXingkai","华文行楷","Kaiti SC","STKaiti","楷体","KaiTi","Noto Serif CJK SC",serif'
```
脚本在 433 meta 的 `faces:` 块后插 `facesSc:`+`defaultSc:`，`fallbackStacks:` 后插 `fallbackStacksSc:`。

### 3b. html-songke.js + html-songke-facsimile.js 加双轨（仿 scroll html.js:96-115）
- require 加 `resolveScFaces`（`src/fonts/fonts.js`）
- 简体轨解析：`const sc = resolveScFaces(meta, registry, distWorkDir);`
- CSS：`--fsc-{id}` 变量 + `.fsc-{id}{--face:var(--fsc-{id})}` 切换规则（注入 faceCss）
- `:root` 加 `--fsc-*` 变量
- payload 加 `facesSc: sc.roles.map(r=>({role:r.id,label:r.label}))`, `defaultSc: sc.def`, `defaultScript: meta.defaultScript||'tc'`
- `<script>` 烘焙 `FACES={tc:[...],sc:[...],def:defaultSc,defScript:defaultScript}`（仿 scroll html.js:232）

### 3c. songke.js + songke-facsimile.js viewer 双轨（仿 scroll viewer.js:32-76）
- state 加 `tcFace:0, scFace:FACES.def||0, simpOn:FACES.defScript==='sc'`（替代单一 face）
- `applyFace()`：`simpOn ? --fsc-{scRole} : --{tcRole}` 设 `--face`
- `rebuildSel()`：按 simpOn 从 FACES.sc/tc 重建字面下拉
- `btnZh.onclick`：切 simpOn + rebuildSel + applyFace + render
- `faceSel.onchange`：区分 simpOn 存 scFace/tcFace
- CSS 无需改（`--face` 变量机制，渲染器注入 `--fsc-*`+`.fsc-*` 自动生效）

## 问题4：换页键（对调 ArrowLeft/Right）

agent 确认：两 viewer 无鼠标换页（仅键盘+按钮），ArrowLeft/Right 映射反了（古书右→左读直觉，但用户要顺序轴）。
- `songke.js:308-309`：`ArrowLeft→go(-1)` 前叶，`ArrowRight→go(1)` 后叶（原 ArrowLeft→go(1)/ArrowRight→go(-1)）
- `songke-facsimile.js:285-286`：`ArrowLeft→btnPrev.click()`，`ArrowRight→btnNext.click()`（原反）
- 删/改注释"左箭头=向更左（阅读前进）"

## 改动文件清单

- `src/site/home.js`（BOOK_META 加 5 key）
- 24 C 类 meta（entry 卷次篇名 + facesSc/fallbackStacksSc/defaultSc）
- 409 A/B/D meta（仅 facesSc/fallbackStacksSc/defaultSc）
- `src/render/html-songke.js` + `src/render/html-songke-facsimile.js`（双轨注入）
- `src/viewer/songke.js` + `src/viewer/songke-facsimile.js`（双轨切换 + 换页键对调）

## 执行顺序

1. home.js BOOK_META 加 key（问题1）
2. 脚本改 24 C 类 meta entry（问题2）+ 脚本补 433 meta facesSc（问题3a，24 C 类一并）
3. html-songke.js/html-songke-facsimile.js 双轨（问题3b）
4. songke.js/songke-facsimile.js 双轨+换页键（问题3c+问题4）
5. 批量 rebuild songke+facsimile HTML（--only=html）+ gen-index
6. 验证 + 提交

## 验证

1. **shuku**：C 类书影显示"宋当涂郡斋本"badge（gen-index 后 grep dist/shuku）
2. **目录页**：`/books/mengzi-songben/` 各卷"卷之一/梁惠王章句上"…（grep dist/books）
3. **字体双轨**：DOM 切简体→ `--face` 切 `--fsc-*`，字面下拉重建为 SC 列表；繁简独立记忆
4. **换页键**：ArrowLeft→前叶(leaf-1)、ArrowRight→后叶(leaf+1)
5. `npm run validate` + `npm run verify`（改 src/viewer 触发 verify，numCn/双轨不影响手卷）
6. pre-commit validate+verify

## 风险

- **433 meta facesSc 批量**：脚本幂等插入，统一三套（个别作品可后补覆盖）；liushang-xingyi A 级子集覆盖率需验证（songke 用字比 scroll 多）。
- **dev server 缓存**：home.js 改后 serve.js 旧进程 require cache 旧 BOOK_META，需重启 serve.js（或用户硬刷新无效，因 module cache 在进程）。
- **双轨 viewer 改动大**：songke/songke-facsimile viewer 仿 scroll，需测试繁简切换+字面选择独立记忆。
