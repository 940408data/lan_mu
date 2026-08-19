/** 预加载：当前 viewer 无需 Node API；仅暴露桌面端标识，供渲染页按需感知
 *  （如外链打开行为、下载菜单文案等可据此调整）。 */
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('lanmu', {
  desktop: true,
  platform: process.platform,
});
