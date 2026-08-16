---
name: songke-zhouyi-volume
description: 从十三经注疏 exe 制作周易正义宋版善刻卷（zhouyi-juanN）。exe 解包、DOM 提取、繁简转换、opencc 修正、校验构建的完整工作流。
---

# 周易正义宋版善刻卷制作

将《十三经注疏》exe 中的周易正义篇章转为 `works/zhouyi-juanN/` 宋版善刻数据。**先用 UPX 解包 exe → ComputerUse 提取 DOM → 抽取脚本生成草稿 → 校录 → 校验构建。**

## 数据源

`input_data/十三经注疏/01.《周易正义》.exe`（696KB，UPX 压缩的 Delphi PE，内嵌 IE WebBrowser 控件，HTML 资源以 `http://ebook/NNN.htm` 协议加载，编码 GB2312）。

十三经注疏 exe 系列由"淘书网"发布，整理明月奴、制作真如，各卷文件：

| 序号 | 书名 | 大小 |
|---|---|---|
| 01 | 周易正义 | 696KB |
| 02 | 尚书正义 | 1029KB |
| 03 | 毛诗正义 | 2471KB |
| 04 | 周礼注疏 | 1820KB |
| 05 | 仪礼注疏 | 1648KB |
| 06 | 礼记正义 | 2500KB |
| 07 | 春秋左传正义 | 2311KB |
| 08 | 春秋公羊传注疏 | 1087KB |
| 11 | 孝经注疏 | 600KB |

另有 `.txt` 文件：《论语注疏》《孟子注疏》、`.doc`：尔雅注疏。

## 周易正义卷次与 exe 页面映射

| 卷 | 名称 | URL | 约字数 |
|---|---|---|---|
| 一 | 上经乾传（乾坤屯蒙） | 000.htm | 39,007 |
| 二 | 上经需传 | 001.htm | 41,465 |
| 三 | 上经随传 | 002.htm | 43,391 |
| 四 | 下经咸传 | 003.htm | 36,102 |
| 五 | 下经夬传 | 004.htm | 38,471 |
| 六 | 下经丰传 | 005.htm | 28,194 |
| 七 | 系辞上 | 006.htm | 33,982 |
| 八 | 系辞下 | 007.htm | 25,462 |
| 九 | 说卦 | 008.htm | 9,142 |
| 十 | 序卦 | 009.htm | 3,378 |
| 十一 | 杂卦 | 010.htm | 1,078 |

## 工作流

### 1. 解包 exe（UPX）

exe 为 UPX 压缩的 PE。须先解包：

```bash
upx -d "input_data/十三经注疏/01.《周易正义》.exe" -o "input_data/十三经注疏/01_zhouyi_unpacked.exe"
```

解包后约 1.19MB（CODE/DATA/BSS/.idata/.rsrc 等节区展开）。UPX 可从 https://github.com/upx/upx/releases 下载 win64 版。

### 2. DOM 提取（ComputerUse）

exe 内嵌 Delphi IE WebBrowser 控件，以 `http://ebook/NNN.htm` 协议加载 HTML。右键/复制/拖拽被 JS 禁用，须通过 MSAA/IHTMLDocument2 接口提取：

1. 启动 exe（Start-Process）
2. 用 `EnumChildWindows` 找到 Internet Explorer_Server 控件
3. 发送 `WM_HTML_GETOBJECT` + `ObjectFromLresult` 获取 IHTMLDocument2
4. 导航到各页面 `document.parentWindow.navigate('http://ebook/NNN.htm')`
5. 提取 `document.documentElement.innerHTML`（HTML）和 `document.body.innerText`（纯文本）
6. 保存为 UTF-8 文件到 `zhouyi_extracted/`

### 3. 抽取草稿

```bash
node tools/extract-zhouyi.js zhouyi_extracted/vol01_shangjing_qianzhuan.txt --vol=一 --out=works/zhouyi-juan1/text.yaml
```

脚本处理流程：
1. 跳过文件头（书名、卷名）和尾（目录页、版权行）
2. 按行分类：`[疏]` 起始 → z 块（孔颖达疏文）；其余 → j 块（经文+王弼注）
3. opencc s2tw 繁简转换 + 周易特有修正
4. 输出 YAML blocks

### 4. 校录（关键，勿跳过）

**opencc 过度转换修正**（脚本已内置，校录时复查）：

| opencc 产出 | 正确 | 说明 |
|---|---|---|
| 雲 | 云 | 疏文中"X雲"均为"X云"（X说），非云雨之雲 |
| 矇 | 蒙 | 蒙卦名：蒙昧、童蒙，opencc 过度转为矇 |
| 禦 | 御 | 周易原文用"御寇"，非禦 |
| 繫 | 系 | 系辞（繫辭）保留为系辞 |

**周易正义文本结构**：
- 每卦 = 卦辞（j）+ 彖传（j）+ 象传（j）+ 疏（z）交替
- 爻辞中王弼注与经文合并在同一 j 行（如"九二：见龙在田，利见大人。出潜离隐..."）
- 孔颖达疏以 `[疏]` 标记，紧跟对应 j 行之后
- 乾卦、坤卦另含《文言》专节

**必查项**：
- 于/於：周易原文用"于"（如"龙战于野"），opencc s2tw 会转"于"→"於"，须保留"于"
- 卦名完整性：确认六十四卦名未被 opencc 误转（如 蒙→矇、乾→幹）
- 疏文中引经据典处：核对《系辞》《说卦》等书名中字符

### 5. meta.yaml / seals / ornaments

复制他卷 meta.yaml 改：`id`（zhouyi-juanN）、`title`（周易正義卷N）、`subtitle`、`docTitle`、`ariaLabel`、`seed`（新 5 位数）、`songke.banxinTitle`（周易卷N）、`songke.colophon`（本卷所收卦名）、`export.base`（Zhouyi-JuanN-Songke）、`aboutHtml`。`gong: 牛山`、faces/fallbackStacks/spec/sources 不变。

`seals.yaml`: `seals: []`；`ornaments.yaml`: `orchids: []`。

**expect 字段**：先留空（或注释），运行 `npm run validate` 获取实际统计值后填入：
```yaml
expect:
  jChars: 5359   # 经字（去标点后）
  zChars: 26279  # 注字（去标点后）
  columns: 913   # 总列数
  halves: 115    # 半葉数
  leaves: 58     # 葉数
```

注意：validator 的字数统计**去除标点**（`。，！？、；：` 合并入前字、`「」『』（）〈〉—·` 删除），故 expect 值 ≠ text.yaml 原始字符数。

### 6. 校验构建

```bash
npm run validate -- --work=zhouyi-juan1
npm run build -- --work=zhouyi-juan1 --only=html   # 快速验证
npm run build -- --work=zhouyi-juan1               # 出三体 PDF
```

### 7. 提交

分支命名 `zhouyi-juanN`（从 dev 切出）；提交信息用中文，写明：数据源（exe 解包 + DOM 提取）、校验数字（葉/半葉/行/經字/注字）、构建结果、opencc 修正明细、残留项。完成后 push。

## 参考基线

- zhouyi-juan1（卷一 上经乾传）：j 块 111 · z 块 109 · 經字 5359 · 注字 26279 · 913 行 / 115 半葉 / 58 葉
- 乾卦含彖传、大象、小象、用九、文言（6 节），为全卷最长卦
- 本卷收乾、坤、屯、蒙四卦

## 与四书章句集注制作之差异

| 项目 | 四书（论语/孟子） | 十三经注疏（周易正义） |
|---|---|---|
| 数据源 | CHM → htm（Easy CHM 抽取） | exe（UPX 解包 → IE DOM 提取） |
| 编码 | GB2312 | GB2312 |
| 文本层次 | 经(j) + 注(z) 二层 | 经+注(j) + 疏(z) 二层（注已嵌入经行） |
| 繁简方向 | opencc s2tw + 语境修正 | opencc s2tw + 云/蒙/御等周易特有修正 |
| 卷次单位 | 篇（学而/为政...） | 卦（乾/坤/屯...） |
