# 兰木桌面版（Windows）

## 概述
把兰木 Web 静态站点（`dist/`）用 Electron 包装成 Windows 桌面应用，离线双击运行。
**零改引擎**：主进程注册自定义协议 `lanmu://` 映射到 dist 目录，站点页绝对路径（`/works/<id>/index.html`、`/assets/fonts/...`）在桌面端天然解析，无需改 `src/site` 路径生成逻辑、无需内嵌 HTTP 服务器。

## 构建
```bash
npm run electron:build:win
```
产物：`release/win-unpacked/`（含 `Lanmu.exe` + `resources/dist`）。用 `dir` target（非 nsis），**无需 wine**，在 Linux/Windows 均可产出可直接运行的程序目录。

## 分发与运行
1. 把 `release/win-unpacked/` 整个目录拷到 Windows 机器。
2. 双击 `Lanmu.exe`。
3. 首次运行 Windows SmartScreen 可能拦截（未签名）→「更多信息」→「仍要运行」。

## 开发预览
```bash
npm run electron:dev   # 生成精简 dist（--if-missing）+ 启动 electron
```
需图形显示（headless 服务器用 `xvfb-run -a npm run electron:dev`）。

## 第一版范围与限制
- **精简内容**：不含出图大文件（JPG 长图 / PNG / PDF），仅 HTML + 字体子集 + `scan.jpg` 手卷底图 + 卷影图。精简 dist ≈ 78 MB，全包 ≈ 492 MB（含 Electron 运行时 225 MB）。
- **B 级字体**（英椎行书等）不内嵌（授权明确禁嵌入），自动落 A 级 woff2（霞鹜文楷 TC）+ 系统行楷回退栈。
- **未签名**：无代码签名，Windows 首次运行需手动信任。
- 出图（JPG/PNG/PDF）后续版本按需以 `extraResources` 全量加入（全量 dist 约 3.1 GB）。

## 关键文件
| 文件 | 职责 |
|---|---|
| `electron/main.js` | 主进程：`protocol.handle('lanmu', …)` 映射 dist、目录→`index.html`、MIME、防越界；`BrowserWindow` 加载 `lanmu://lanmu/index.html` |
| `electron/preload.js` | `contextBridge` 暴露 `window.lanmu.desktop` 标识 |
| `tools/electron-dist.js` | 从源 dist 复制精简版（排除 `*-Scroll-*`/`*-Songke-*` jpg/png + 全 pdf），`--if-missing` 支持 dev 快启 |
| `package.json` `build` | `files: ["electron/**","package.json"]`（asar 不含 node_modules）、`extraResources: dist→dist`、`win.target: dir` |
