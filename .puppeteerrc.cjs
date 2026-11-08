/**
 * 插件的 puppeteer 只被 `import type` 引用，运行时出图与登录都走云崽宿主的渲染器
 * （lib/runtime/host/puppeteer.js -> importHost('lib','puppeteer')）。
 * 所以安装时不需要下载浏览器：禁止 postinstall 再拉 headless shell。
 * 若将来确实需要独立启动浏览器，请在 launch({ executablePath }) 里显式指定
 * 系统已有的 /usr/bin/google-chrome 或 /usr/bin/chromium。
 */
module.exports = { skipDownload: true }
