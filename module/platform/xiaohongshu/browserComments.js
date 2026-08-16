const COMMENT_API_PATH = '/api/sns/web/v2/comment/page'
const PAGE_TIMEOUT = 60 * 1000
const COMMENT_TIMEOUT = 30 * 1000

const parseCookies = cookie => String(cookie || '')
  .split(';')
  .map(item => item.trim())
  .filter(Boolean)
  .map(item => {
    const separator = item.indexOf('=')
    if (separator <= 0) return null
    return {
      name: item.slice(0, separator),
      value: item.slice(separator + 1),
      domain: '.xiaohongshu.com',
      path: '/'
    }
  })
  .filter(Boolean)

const preparePage = async (browser, page, cookie) => {
  const userAgent = (await browser.userAgent())
    .replace('HeadlessChrome/', 'Chrome/')
    .replace('(X11; Linux x86_64)', '(Windows NT 10.0; Win64; x64)')

  await page.setUserAgent(userAgent)
  await page.setExtraHTTPHeaders({ 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' })
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] })
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' })
  })

  const cookies = parseCookies(cookie)
  if (cookies.length) await page.setCookie(...cookies)
}

const isTargetCommentResponse = (response, noteId) => {
  if (response.request().method() !== 'GET') return false
  try {
    const url = new URL(response.url())
    return url.pathname === COMMENT_API_PATH && url.searchParams.get('note_id') === noteId
  } catch {
    return false
  }
}

export const fetchXiaohongshuCommentsWithBrowser = async ({ renderer, cookie, noteId, xsecToken }) => {
  if (!renderer?.browserInit) throw new Error('无法取得云崽 Puppeteer 渲染器')

  const browser = await renderer.browserInit()
  if (!browser) throw new Error('云崽 Puppeteer 浏览器启动失败')

  let page
  try {
    page = await browser.newPage()
    await preparePage(browser, page, cookie)

    const responsePromise = page.waitForResponse(
      response => isTargetCommentResponse(response, noteId),
      { timeout: COMMENT_TIMEOUT }
    )
    const query = new URLSearchParams({
      xsec_token: xsecToken || '',
      xsec_source: 'pc_feed'
    })
    await page.goto(`https://www.xiaohongshu.com/explore/${noteId}?${query}`, {
      timeout: PAGE_TIMEOUT,
      waitUntil: 'domcontentloaded'
    })

    const response = await responsePromise
    const result = await response.json().catch(() => null)
    if (!response.ok() || Number(result?.code) !== 0 || result?.success !== true) {
      throw new Error(result?.msg || `评论接口返回 HTTP ${response.status()}`)
    }
    if (!Array.isArray(result?.data?.comments)) throw new Error('评论接口响应缺少 comments 数组')
    return result.data.comments
  } finally {
    if (page) await page.close().catch(() => {})
  }
}
