import type { Browser, HTTPResponse, Page } from 'puppeteer'
import { Config } from '@/module/utils/index'
import { QRCodeScanner } from '@/module/utils/QRCodeScanner.js'
import { scan } from '@ikenxuan/qrcode'

/** 登录流程使用的事件对象。浏览器由云崽运行时提供，不在插件内自行启动。 */
export interface DouyinLoginEvent {
  reply: (message: unknown, quote?: boolean) => Promise<unknown>
  bot?: {
    recallMsg?: (event: unknown, id: unknown) => Promise<unknown>
  }
  runtime?: {
    puppeteer?: {
      browserInit?: () => Promise<Browser>
    }
  }
}

export interface DouyinLoginOptions {
  waitForCode?: (prompt: string) => Promise<string>
}

interface LoginCookie {
  name: string
  value: string
  domain: string
  path: string
}

interface CookieResponse {
  cookies?: LoginCookie[]
}

const QR_CODE_SELECTOR = 'img[aria-label="二维码"], .web-login-scan-code__content__qrcode-wrapper img'
const LOGIN_TIMEOUT = 120 * 1000
let activeLoginTask: Promise<boolean> | null = null

const getMessageId = (message: unknown): unknown => {
  if (!message || typeof message !== 'object') return undefined
  const record = message as { message_id?: unknown, messageId?: unknown }
  return record.message_id || record.messageId
}

const recallMessages = async (event: DouyinLoginEvent, messageIds: unknown[]): Promise<void> => {
  await Promise.all(messageIds.filter(Boolean).map(async id => {
    try {
      await event.bot?.recallMsg?.(event, id)
    } catch {
      // 消息可能已撤回或超过可撤回时间，不影响登录结果。
    }
  }))
}

const getDouyinCookies = async (page: Page): Promise<{ cookies: LoginCookie[], cookieString: string }> => {
  // page.cookies() 只覆盖当前页面域名；登录确认后的 Cookie 可能写在多个抖音子域名。
  const client = (page as Page & { _client: { send: (method: string) => Promise<CookieResponse> } })._client
  const allCookies = await client.send('Network.getAllCookies')
  const rawCookies = (allCookies.cookies || []).filter(cookie => {
    const domain = cookie.domain.replace(/^\./, '')
    return domain === 'douyin.com' || domain.endsWith('.douyin.com')
  })
  const cookieMap = new Map(rawCookies.map(cookie => [cookie.name, cookie]))
  const cookies = [...cookieMap.values()]
  return {
    cookies,
    cookieString: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
  }
}

const hasLoginCookies = (cookies: LoginCookie[]): boolean => {
  const cookieNames = new Set(cookies.map(cookie => cookie.name))
  return cookieNames.has('sid_guard') && (cookieNames.has('sessionid_ss') || cookieNames.has('sessionid'))
}

const prepareDouyinPage = async (browser: Browser, page: Page): Promise<void> => {
  const userAgent = (await browser.userAgent())
    .replace('HeadlessChrome/', 'Chrome/')
    .replace('(X11; Linux x86_64)', '(Windows NT 10.0; Win64; x64)')

  await page.setUserAgent(userAgent)
  await page.setExtraHTTPHeaders({ 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' })
  await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 1 })
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] })
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' })
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] })
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 })
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 })
    Object.defineProperty(screen, 'width', { get: () => 1920 })
    Object.defineProperty(screen, 'height', { get: () => 1080 })
    Object.defineProperty(screen, 'availWidth', { get: () => 1920 })
    Object.defineProperty(screen, 'availHeight', { get: () => 1040 })
    const scope = globalThis as typeof globalThis & { chrome?: { runtime?: Record<string, unknown> } }
    scope.chrome ||= { runtime: {} }
  })

  const currentCookies = await getDouyinCookies(page)
  if (currentCookies.cookies.length > 0) {
    await page.deleteCookie(...currentCookies.cookies.map(cookie => ({
      name: cookie.name,
      domain: cookie.domain,
      path: cookie.path
    })))
  }
}

const waitForQrcodeSource = async (page: Page, timeout: number): Promise<string> => {
  await page.waitForFunction((selector: string) => {
    const markedQrcode = document.querySelector<HTMLImageElement>(selector)
    if (markedQrcode?.src) return true
    return [...document.querySelectorAll('img')].some(image =>
      image.src.startsWith('data:image/') && image.naturalWidth >= 120 && image.naturalHeight >= 120
    )
  }, { timeout }, QR_CODE_SELECTOR)

  return await page.evaluate((selector: string) => {
    const markedQrcode = document.querySelector<HTMLImageElement>(selector)
    if (markedQrcode?.src) return markedQrcode.src
    return [...document.querySelectorAll('img')].find(image =>
      image.src.startsWith('data:image/') && image.naturalWidth >= 120 && image.naturalHeight >= 120
    )?.src || ''
  }, QR_CODE_SELECTOR)
}

interface LoginPoint {
  x: number
  y: number
}

const findLoginButtonPoint = async (page: Page): Promise<LoginPoint | null> => await page.evaluate(() => {
  const button = [...document.querySelectorAll('button')].find(element => {
    if (element.textContent?.trim() !== '登录') return false
    const style = window.getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
  })
  if (!button) return null
  const rect = button.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
})

const openLoginDialog = async (page: Page): Promise<string> => {
  const deadline = Date.now() + LOGIN_TIMEOUT
  let clickAttempts = 0

  while (Date.now() < deadline) {
    try {
      const qrcode = await waitForQrcodeSource(page, 1000)
      if (qrcode) return qrcode
    } catch {
      // 二维码尚未出现，继续检查当前 DOM 中的登录按钮。
    }

    const point = await findLoginButtonPoint(page)
    if (point) {
      clickAttempts++
      await page.mouse.click(point.x, point.y)
      logger.debug(`[抖音登录] 已点击当前登录入口，第${clickAttempts}次`)
    }
    await new Promise(resolve => setTimeout(resolve, 1500))
  }

  const pageState = await page.evaluate(() => ({
    title: document.title,
    buttons: [...document.querySelectorAll('button')]
      .map(button => button.textContent?.trim())
      .filter(Boolean)
      .slice(0, 20),
    hasLoginText: document.body?.innerText?.includes('登录') || false,
    hasMineText: document.body?.innerText?.includes('我的') || false
  }))
  logger.warn('[抖音登录] 等待登录入口或二维码超时:', pageState)
  throw new Error('登录入口或二维码加载超时')
}

const handleSecondVerification = async (
  page: Page,
  event: DouyinLoginEvent,
  messageIds: unknown[],
  requestVerifyCode: DouyinLoginOptions['waitForCode']
): Promise<boolean> => {
  if (typeof requestVerifyCode !== 'function') throw new Error('当前指令环境不支持接收短信验证码')

  await page.waitForSelector('#uc-second-verify', { timeout: 10000 })
  const requested = await page.evaluate(() => {
    const elements = [...document.querySelectorAll<HTMLElement>('#uc-second-verify *')]
    const button = elements.find(element => element.textContent?.trim() === '接收短信验证码')
    if (!button) return false
    button.click()
    return true
  })
  if (!requested) throw new Error('未找到接收短信验证码按钮')

  const inputSelector = '#uc-second-verify input'
  await page.waitForSelector(inputSelector, { timeout: 10000, visible: true })
  const tipMessage = await event.reply('此次登录需要短信二次验证\n验证码已发送至抖音账号绑定的手机号，请在120秒内发送6位验证码', true)
  messageIds.push(getMessageId(tipMessage))

  for (let attempt = 1; attempt <= 2; attempt++) {
    const prompt = attempt === 1
      ? '此次验证需要进行短信 2FA。验证码已发送至扫码设备绑定的手机号，请在120秒内发送6位验证码。'
      : '验证码错误，请重新发送正确的6位验证码（剩余机会：1次）。'
    const code = String(await requestVerifyCode(prompt) || '').trim()
    if (!/^\d{6}$/.test(code)) {
      if (attempt < 2) {
        await event.reply('验证码应为6位数字，请重新发送（剩余1次）', true)
        continue
      }
      throw new Error('短信验证码格式错误或输入超时')
    }

    await page.focus(inputSelector)
    await page.keyboard.down('Control')
    await page.keyboard.press('A')
    await page.keyboard.up('Control')
    await page.type(inputSelector, code)

    const validateResponse = page.waitForResponse(
      response => response.url().includes('validate_code'),
      { timeout: 10000 }
    )
    const submitted = await page.evaluate(() => {
      const elements = [...document.querySelectorAll<HTMLElement>('#uc-second-verify *')]
      const button = elements.find(element => element.textContent?.trim() === '验证')
      if (!button) return false
      button.click()
      return true
    })
    if (!submitted) throw new Error('未找到短信验证码提交按钮')

    const response = await validateResponse
    const result = await response.json().catch(() => ({})) as { data?: { error_code?: number } }
    if (result.data?.error_code === 1202) {
      if (attempt < 2) {
        await event.reply('验证码错误，请重新发送（剩余1次）', true)
        continue
      }
      throw new Error('短信验证码错误次数过多')
    }

    logger.mark('[抖音登录] 短信二次验证通过，等待认证 Cookie')
    return true
  }
  return false
}

const waitForLogin = async (
  page: Page,
  event: DouyinLoginEvent,
  messageIds: unknown[],
  requestVerifyCode: DouyinLoginOptions['waitForCode']
): Promise<string> => {
  let expiresAt = Date.now() + LOGIN_TIMEOUT
  let scanned = false
  let loginConfirmed = false
  let secondVerifyRequired = false
  let secondVerifyHandled = false
  let lastResponseState = ''

  const responseHandler = async (response: HTTPResponse): Promise<void> => {
    if (!response.url().includes('check_qrconnect')) return
    try {
      const setCookieHeader = response.headers()['set-cookie'] || ''
      const setCookieNames = [...setCookieHeader.matchAll(/(?:^|,\s*)([A-Za-z0-9_.-]+)=/g)].map(match => match[1])
      if (setCookieHeader.includes('sid_guard')) {
        loginConfirmed = true
        logger.mark('[抖音登录] 登录响应已返回认证 Cookie')
      }

      const result = await response.json() as { data?: { status?: string, error_code?: number | string } }
      const status = result.data?.status ?? 'unknown'
      const errorCode = result.data?.error_code ?? 'none'
      const responseState = `${status}/${errorCode}/${setCookieNames.join(',')}`
      if (responseState !== lastResponseState) {
        lastResponseState = responseState
        logger.debug(`[抖音登录] status=${status} error_code=${errorCode} set-cookie=${setCookieNames.join(',') || 'none'}`)
      }
      if (errorCode === 2046) secondVerifyRequired = true
      if (status !== 'scanned' || scanned) return

      scanned = true
      logger.mark('[抖音登录] 二维码已扫描，等待手机端确认')
      await recallMessages(event, messageIds)
      messageIds.length = 0
      const message = await event.reply('二维码已扫描，请在手机端确认登录', true)
      messageIds.push(getMessageId(message))
    } catch {
      // 轮询响应不一定都是 JSON，Cookie 轮询仍会继续判断登录状态。
    }
  }

  page.on('response', responseHandler)
  try {
    while (Date.now() < expiresAt) {
      if (secondVerifyRequired && !secondVerifyHandled) {
        secondVerifyHandled = true
        logger.mark('[抖音登录] 检测到短信二次验证')
        await handleSecondVerification(page, event, messageIds, requestVerifyCode)
        expiresAt = Date.now() + LOGIN_TIMEOUT
      }

      const result = await getDouyinCookies(page)
      if (hasLoginCookies(result.cookies)) return result.cookieString
      await new Promise(resolve => setTimeout(resolve, loginConfirmed ? 500 : 1500))
    }
    return ''
  } finally {
    page.off('response', responseHandler)
  }
}

const runDouyinLogin = async (
  event: DouyinLoginEvent,
  requestVerifyCode: DouyinLoginOptions['waitForCode']
): Promise<boolean> => {
  const messageIds: unknown[] = []
  let page: Page | undefined

  try {
    const browserInit = event.runtime?.puppeteer?.browserInit
    if (!browserInit) throw new Error('无法取得云崽 Puppeteer 渲染器')
    const browser = await browserInit()
    if (!browser) throw new Error('云崽 Puppeteer 浏览器启动失败')

    page = await browser.newPage()
    await prepareDouyinPage(browser, page)

    const disclaimer = await event.reply('免责声明:\n您将通过扫码完成获取抖音网页端的用户登录凭证（ck），该ck将用于请求抖音WEB API接口。\n本Bot不会上传您的登录凭证到第三方，所配置的ck只用于请求官方API。\n我方仅提供视频解析及相关抖音内容服务，若您的账号封禁、被盗等处罚与我方无关。\n害怕风险请勿扫码 ~')
    messageIds.push(getMessageId(disclaimer))

    logger.mark('[抖音登录] 正在使用云崽浏览器加载登录二维码')
    await page.goto('https://www.douyin.com', { timeout: LOGIN_TIMEOUT, waitUntil: 'domcontentloaded' })

    const pageTitle = await page.title()
    const hasVerifyFrame = page.frames().some(frame => frame.url().includes('/verifycenter/'))
    if (pageTitle.includes('验证码') || hasVerifyFrame) throw new Error('抖音触发验证码中间页，请稍后重试')

    const qrCodeSource = await openLoginDialog(page)
    if (!qrCodeSource) throw new Error('未找到抖音登录二维码')
    if (!qrCodeSource.startsWith('data:image/')) throw new Error('抖音登录二维码不是可发送的图片数据')

    const qrCodeBuffer = Buffer.from(qrCodeSource.split(',')[1] || '', 'base64')
    const decoded = await scan(qrCodeBuffer) || await QRCodeScanner.scanFromBuffer(qrCodeBuffer) || ''
    const qrMessage = await event.reply([
      segment.image(`base64://${qrCodeBuffer.toString('base64')}`),
      `请在${LOGIN_TIMEOUT / 1000}秒内通过抖音APP扫码并确认登录${decoded ? `\n二维码内容：${decoded}` : ''}`
    ], true)
    messageIds.push(getMessageId(qrMessage))

    const cookieString = await waitForLogin(page, event, messageIds, requestVerifyCode)
    if (!cookieString) {
      await recallMessages(event, messageIds)
      await event.reply('登录超时！二维码已失效，请重新扫码', true)
      return true
    }

    if (!Config.modify('cookies', 'douyin', cookieString)) throw new Error('登录成功，但 Cookie 写入 cookies.yaml 失败')
    await recallMessages(event, messageIds)
    await event.reply('登录成功！用户登录凭证已保存至cookies.yaml', true)
    logger.mark('[抖音登录] Cookie已保存')
    return true
  } catch (error: unknown) {
    logger.error('[抖音登录] 登录失败:', error)
    await recallMessages(event, messageIds)
    await event.reply(`抖音扫码登录失败：${error instanceof Error ? error.message : String(error)}`, true)
    return true
  } finally {
    // 云崽浏览器是共享实例，只关闭本次登录创建的页面。
    if (page) await page.close().catch(error => logger.warn(`[抖音登录] 页面关闭失败: ${error instanceof Error ? error.message : String(error)}`))
  }
}

export const douyinLogin = async (
  event: DouyinLoginEvent,
  options: DouyinLoginOptions = {}
): Promise<boolean> => {
  if (activeLoginTask) {
    await event.reply('已有抖音扫码登录正在进行，请稍后再试', true)
    return true
  }

  activeLoginTask = runDouyinLogin(event, options.waitForCode)
  try {
    return await activeLoginTask
  } finally {
    activeLoginTask = null
  }
}

// 保留旧导出名称，兼容外部调用。
export const dylogin = douyinLogin
