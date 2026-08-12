# 門戶首頁方案與踩坑接力書

> 本檔為**接力文檔**。前序 Agent 製作門戶首頁時上下文爆炸（`API Error: 400 Exceeded limit on max bytes to request body : 6291456`，即 6 MiB 請求體上限），未及收尾提交。此處記錄需求、現狀、待辦與踩坑，供後續 Agent 接力優化。
>
- 所在分支：`engine/songke-home-portal`（worktree `songke-site-pages`，locked）
- 依託已合併入 dev 的「藏書首頁 + 書目目錄葉」基線（見 CLAUDE.md「站點頁」節）
- 全文簡體（基建文檔慣例），門戶面向用戶文案保留繁體（見 `home.js`）

---

## 一、需求（參考識典古籍首頁）

首頁改為三段式門戶，**只列「書」不列卷，不放全帙**（全帙在「書庫」）：

### 1. 頂部導航欄（三項）
- **幽蘭第五** → 作品頁 `/works/youlan/index.html`
- **書庫** → 全帙一覽 `/shuku/`
- **我是校書官** → `/jiaoshu/`，**先暫放點校招募介紹文案，後續豐富功能**

### 2. 核心搜索區域（目前核心功能）
- 檢索框：書名 / 卷次 / 篇名即輸即顯，繁簡雙軌（簡體串構建期 opencc 預轉入索引）
- 部類頁簽：**點儒家經典 → 列儒家幾部經典；點佛家 → 列佛家；點道家 → 列道家**
  - 佛家、道家**暫為虛擬典籍**，點入顯示「敬請期待」
  - 無 JS 時僅見首部（儒家經典），與「不放全帙」一致

### 3. 下部專題推薦（兩專題）
- **專題一 四書**：大學 / 中庸 / 論語 / 孟子（朱熹章句集注）
- **專題二 四時幽賞**：**含蘭亭集序（已有）**；**其他三部作品另外的 Agent 正在製作，先把關**（佔位為虛擬典籍，點入敬請期待）

---

## 二、現狀（worktree 未提交，功能基本完成）

門戶化代碼已寫就，尚處於 worktree 工作區未提交狀態（`git diff --stat`：build.js/render.js/site.css/serve.js +312 行，home.js 新增）。**不是斷點，是待驗收尾**。

| 文件 | 角色 | 實現 |
|---|---|---|
| `src/site/home.js` | **門戶配置（跨選內容，非 works 數據）** | `NAV`（三項導航）/ `TABS`（儒家/佛家/道家頁簽，books 真書 + virtual 虛擬）/ `TOPICS`（四書、四時幽賞）/ `COPY`（敬請期待、校書官文案） |
| `src/site/render.js` | 渲染（6 函數） | `renderHome`（檢索+頁簽+專題+導航）/ `renderShuku`（全帙）/ `renderTopic`（專題）/ `renderComingSoon`（敬請期待，`?t=` 換題）/ `renderJiaoshu`（校書官）/ `renderToc`（目錄葉，基線已有） |
| `tools/serve.js` | dev 動態路由 | `/`→renderHome、`/shuku/`→renderShuku、`/coming-soon/`→renderComingSoon、`/jiaoshu/`→renderJiaoshu、`/topics/<id>/`→renderTopic |
| `src/site/build.js` | 靜態產出 | `index.html` / `shuku/` / `coming-soon/` / `jiaoshu/` / `topics/<id>/` 全部 `put` |
| `src/site/site.css` | 樣式 | 門戶佈局 + 頁簽 + 專題卡 + 導航 |

home.js 配置摘要（與需求對照）：
```js
NAV    = [幽蘭第五, 書庫, 我是校書官]
TABS   = [儒家經典(daxue,zhongyong,lunyu,mengzi),
          佛家(xinjing 真書 + 金剛經/維摩詰經/妙法蓮華經 虛擬),
          道道(道德經/南華經/沖虛經 虛擬)]
TOPICS = [四書(daxue,zhongyong,lunyu,mengzi),
          四時幽賞(lanting 真書 + 陶潛讀山海經 虛擬)]
```

---

## 三、與需求差異 / 待補

| 項 | 現狀 | 需求 | 處置 |
|---|---|---|---|
| 佛家真書 | `xinjing`（心經）列為真書可點入 | 原話「暫時虛擬幾部」 | **保留為真書**——倉庫已有心經，列真書更合理；虛擬部維持敬請期待。記為設計決策。 |
| 四時幽賞虛擬部 | 僅 1 部「陶潛讀山海經」 | 「其他三部作品製作中」 | **待補 2 部題名**（用戶未給具體書名，需確認；四時幽賞原典含春蘭亭、夏廬山讀書等，可按秋/冬補題） |
| 校書官頁 | 僅招募文案幾行 | 「先放介紹，後續豐富」 | 符合，後續迭代 |
| `portal-shot.js` | 根目錄臨時截圖腳本 | 不應入庫 | **收尾時刪除**（或移出倉庫） |
| `src/fonts/src/` | 未跟蹤字體二進制 | `.gitignore` 已忽略 | 勿提交，勿 Read |

---

## 四、收尾步驟

1. **預覽驗證**：worktree 內 `npm run dev`，逐頁審 `/`、`/shuku/`、`/jiaoshu/`、`/topics/sishu/`、`/topics/sishi-youshang/`、`/coming-soon/?t=金剛經`、頁簽切換、檢索即顯。
2. **構建驗證**：`npm run build`（全量末尾產出站點頁）或 `node tools/gen-index.js`，確認靜態頁落地、站點小字庫子集生成。
3. **補四時幽賞題名**（待用戶確認 2 部虛擬典籍書名）→ 改 `home.js` `TOPICS[1].virtual`。
4. **清理** `portal-shot.js`。
5. **提交**（觸及 `src/render|fonts|viewer/`、`css/` → pre-commit 跑 validate + 幽蘭 verify；門戶改動不影響幽蘭，應通過）：
   ```
   git add src/site/home.js src/site/render.js src/site/build.js src/site/site.css tools/serve.js
   git commit -m "feat(songke): 門戶首頁——導航/部類頁簽/專題推薦/校書官頁（參識典古籍）"
   ```
6. **合併 push**：主工作區 `git -C /root/lan_mu merge --no-ff engine/songke-home-portal` → push origin dev。

---

## 五、踩坑經驗（核心，後續 Agent 必讀）

### 5.1 `API Error: 400 Exceeded limit on max bytes to request body : 6291456`
- **含義**：單次請求體 > 6 MiB（6×1024×1024=6291456）即被拒。前序 Agent 在**截圖驗證階段**爆掉，最可能把大體積內容塞進了上下文。
- **規避**：
  - **勿 `Read` dist 產物**：站點/作品 HTML 可達數百 KB~MB 級，讀一個就吃掉大片配額。需查結構時 `grep -n` 定位再局部 Read 片段。
  - **勿 `Read` 字體二進制**（`src/fonts/src/`，.gitignore 已忽略）。
  - **勿 `Read` 截圖 PNG**（`portal-shot.js` 的 fullPage PNG 尤甚）——截圖存盤後用 `ls -l` 看大小即可，不拉進上下文。
  - **勿一次性 `cat` 大文件**：`render.js`（410 行）、`serve.js` 等可用 `wc -l` 估體量、`grep -n` 定位後 `Read` 帶 offset/limit。
  - **小步提交**：worktree 攢太多未提交工作會推高 diff 體量；每完成一塊即提交，縮小單次 diff 規模。
  - **長輸出截尾**：`node tools/cli.js build` 全量輸出很長，管 `tail` 或 `2>&1 | tail -20`，莫全量回讀。

### 5.2 worktree 會話的 cwd 陷阱（本輪親歷）
- `EnterWorktree` 後，**當前 shell cwd 停在 worktree**（`/root/lan_mu/.claude/worktrees/songke-site-pages`），裸 `git`/`npm` 命令默認作用於 **worktree** 而非主工作區 `/root/lan_mu`。
- **症狀**：`git status` 顯示 worktree 的未提交改動與分支，`git merge <分支>` 在分支自身上 merge 自己 → "Already up to date"；`npm run dev` 在 worktree 跑讀到門戶化進行中版本而非主工作區 dev 合併後版本。
- **規避**：
  - 操作主工作區 dev 時**一律 `git -C /root/lan_mu ...`**（或 `cd /root/lan_mu &&`，但複合命令 cd 可能觸發權限提示，`-C` 更穩）。
  - 啟 dev 審 dev 狀態時，顯式 `cd /root/lan_mu && npm run dev`，並 `readlink /proc/$(pgrep -f serve.js)/cwd` 核實進程工作目錄。
  - `pwd` 先確認當前 cwd 再下命令，尤其在 worktree 會話裡。

### 5.3 截圖驗證的輕量做法
- 門戶首頁多頁面，逐頁 fullPage 截圖易爆。改為：serve 預覽 + 人眼審（用戶自審或 `curl -s localhost:port/ | grep -oE '特徵詞'` 抽驗頁面特徵字串），非必要不產 PNG。
- 若必須截圖：`viewport` 固定尺寸、不用 fullPage、截後**只看文件大小不 Read 內容**。

### 5.4 門戶化不影響幽蘭保真
- 門戶改動集中在 `src/site/`（站點頁）+ `src/fonts/subset.js`（站點用字集合加「目錄藏書」）+ `src/render/html-songke.js`（宋版 UI 用字）。**均不觸幽蘭手卷路徑**（`src/core/model/scroll.js` / `html.js` / youlan 數據）。
- 故 pre-commit 的幽蘭 verify 應順利通過（本輪合併基線已驗：242 列差異 0、退出碼 0）。若 verify 報紅，先查是否誤改幽蘭路徑，而非門戶代碼本身。

---

## 六、文件地圖（接力速覽）

```
src/site/
  home.js        ← 門戶配置：NAV / TABS / TOPICS / COPY（改這裡調內容）
  render.js      ← 6 渲染函數（改這裡調佈局/HTML）
  build.js       ← 靜態產出 + 站點小字庫子集
  aggregate.js   ← works 書目聚合（book 塊），基線已有
  site.css       ← 門戶樣式
tools/
  serve.js        ← dev 動態路由（/ /shuku/ /jiaoshu/ /topics/ /coming-soon/）
  cli.js          ← build 入口，全量末尾產站點頁
  gen-index.js    ← 靜態首頁產出（生產）
```
