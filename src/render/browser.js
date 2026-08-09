/** 无头浏览器启动：优先 playwright 自带 chromium，未安装时回落系统 Chrome。 */
const { chromium } = require('playwright');

async function launchBrowser() {
  try {
    return await chromium.launch();
  } catch (e) {
    return await chromium.launch({ channel: 'chrome' });
  }
}

module.exports = { launchBrowser };
