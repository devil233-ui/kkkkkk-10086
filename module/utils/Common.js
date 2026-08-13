import { join, sep } from 'node:path'
import path from 'node:path'
import Version from './Version.js'
import Config from './Config.js'
import { Base } from './Base.js'
import { Networks } from './Networks.js'
import { scan } from '@ikenxuan/qrcode'
import { QRCodeScanner } from './QRCodeScanner.js'
import fs from 'node:fs'

const supportedLinkPatterns = [
  /(https?:\/\/)?(?:(www|v|jx|m|jingxuan|live)\.)?(douyin|iesdouyin)\.com/i,
  /https:\/\/aweme\.snssdk\.com\/aweme\/v1\/play/i,
  /(bilibili\.com|b23\.tv|t\.bilibili\.com|bili2233\.cn|\bBV[1-9a-zA-Z]{10}\b|\bav\d+\b)/i,
  /(快手.*快手|v\.kuaishou\.com|kuaishou\.com)/,
  /(xiaohongshu\.com|xhslink\.com)/i
]

const findSupportedLink = (value, depth = 0) => {
  if (depth > 8 || value === null || value === undefined) return ''
  if (typeof value === 'string') {
    const normalized = value.replace(/\\\//g, '/')
    try {
      const parsed = JSON.parse(normalized)
      if (parsed !== normalized) {
        const nestedLink = findSupportedLink(parsed, depth + 1)
        if (nestedLink) return nestedLink
      }
    } catch {
      // 普通文本不需要 JSON 解析
    }
    const links = normalized.match(/https?:\/\/[^\s"'<>\\]+/g) || []
    return links.find(link => supportedLinkPatterns.some(pattern => pattern.test(link))) || ''
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const link = findSupportedLink(item, depth + 1)
      if (link) return link
    }
    return ''
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) {
      const link = findSupportedLink(item, depth + 1)
      if (link) return link
    }
  }
  return ''
}

const hasSupportedLink = text => supportedLinkPatterns.some(pattern => pattern.test(text || ''))

const getMessageSegments = payload => {
  if (!payload) return []
  if (Array.isArray(payload)) return payload.flatMap(getMessageSegments)
  if (typeof payload !== 'object') return []
  if (typeof payload.type === 'string') return [payload]
  for (const container of [payload.message, payload.data?.message, payload.messages]) {
    if (container && (Array.isArray(container) || typeof container === 'object')) {
      const segments = getMessageSegments(container)
      if (segments.length) return segments
    }
  }
  return []
}

const getMessageSegmentText = msg => {
  const rawText = msg?.text ?? msg?.data?.text ?? msg?.data?.data ?? msg?.data ?? ''
  if (typeof rawText === 'string') return rawText
  if (rawText && typeof rawText === 'object') return JSON.stringify(rawText)
  return ''
}

const getMessageImageSource = msg => {
  const candidates = [msg?.url, msg?.data?.url, msg?.file, msg?.data?.file]
    .filter(value => typeof value === 'string' && value)
  return candidates.find(value => /^(https?:\/\/|base64:\/\/|data:image\/)/i.test(value) || fs.existsSync(value)) || candidates[0] || ''
}

/** 常用工具合集 */
class Tools {
  constructor() {
    // 初始化default路径
    const defaultPath = join(Version.clientPath, 'temp', Version.pluginName)
    this.tempDri = {
      /** 插件缓存目录 */
      default: defaultPath,
      /** 视频缓存文件 */
      video: join(defaultPath, 'kkkdownload', 'video') + sep,
      /** 图片缓存文件 */
      images: join(defaultPath, 'kkkdownload', 'images') + sep
    }
    this.videoPreviews = new Map()
  }

  /**
   * 注册可通过本地服务预览的视频文件。
   * @param {string} filePath 视频绝对路径
   * @param {boolean} [removeCache=Config.app.removeCache] 是否会自动删除
   * @param {number} [ttlMs=10 * 60 * 1000] 预览有效期
   * @returns {{ filename: string, filePath: string, removeCache: boolean, createdAt: number, expireAt?: number }}
   */
  registerVideoPreview(filePath, removeCache = Config.app.removeCache, ttlMs = 10 * 60 * 1000) {
    const filename = path.basename(filePath)
    const createdAt = Date.now()
    const info = {
      filename,
      filePath,
      removeCache: Boolean(removeCache),
      createdAt,
      expireAt: removeCache ? createdAt + ttlMs : undefined
    }
    this.videoPreviews.set(filename, info)
    return info
  }

  /**
   * 获取视频预览信息。
   * @param {string} filename 文件名
   * @returns {any}
   */
  getVideoPreview(filename) {
    return this.videoPreviews.get(path.basename(filename))
  }

  /**
   * 标记视频预览文件已删除。
   * @param {string} filename 文件名
   */
  markVideoPreviewRemoved(filename) {
    const safeName = path.basename(filename)
    const info = this.videoPreviews.get(safeName)
    if (info) {
      info.removedAt = Date.now()
      this.videoPreviews.set(safeName, info)
    }
  }

  /**
   * 校验视频请求文件名并返回安全路径。
   * @param {string} filename 请求文件名
   * @returns {string|null}
   */
  validateVideoRequest(filename) {
    if (!filename) return null
    const safeName = path.basename(filename)
    if (safeName !== filename || filename.includes('/') || filename.includes('\\')) return null

    const previewInfo = this.getVideoPreview(safeName)
    const videoPath = previewInfo?.filePath || path.join(this.tempDri.video, safeName)
    const resolvedVideoDir = path.resolve(this.tempDri.video)
    const resolvedPath = path.resolve(videoPath)
    if (!resolvedPath.startsWith(resolvedVideoDir + path.sep) && resolvedPath !== resolvedVideoDir) return null
    if (!fs.existsSync(resolvedPath)) return null
    return resolvedPath
  }

  /**
   * 从图片 URL 或 base64 图片识别支持的平台二维码链接
   * @param {string} image 图片 URL、本地路径或 base64 图片
   * @param {string} source 来源描述
   * @returns {Promise<string|null>} 识别到的平台链接
   */
  async tryScanImageQrCode(image, source = '消息图片') {
    if (!image) return null
    try {
      logger.debug(`检测到${source}，尝试识别二维码`)
      const buffer = await this.getImageBuffer(image)
      if (!buffer) return null
      let qrContent = scan(buffer)
      if (!qrContent || !hasSupportedLink(qrContent)) {
        qrContent = await QRCodeScanner.scanFromBuffer(buffer) || qrContent
      }
      if (qrContent && supportedLinkPatterns.some(pattern => pattern.test(qrContent))) {
        logger.debug(`从${source}二维码中识别到支持的平台链接: ${qrContent}`)
        return qrContent
      }
      if (qrContent) logger.debug(`识别到二维码内容但不是支持的平台: ${qrContent}`)
    } catch (error) {
      logger.warn(`识别${source}二维码失败: ${error instanceof Error ? error.message : String(error)}`)
    }
    return null
  }

  /**
   * 将图片输入转换为 Buffer
   * @param {string} image 图片 URL、本地路径或 base64 图片
   * @returns {Promise<Buffer|null>}
   */
  async getImageBuffer(image) {
    if (!image) return null
    if (image.startsWith('base64://')) {
      return Buffer.from(image.replace(/^base64:\/\//, ''), 'base64')
    }
    if (/^data:image\/\w+;base64,/.test(image)) {
      return Buffer.from(image.replace(/^data:image\/\w+;base64,/, ''), 'base64')
    }
    if (/^https?:\/\//i.test(image)) {
      const data = await new Networks({ url: image, type: 'arraybuffer' }).getData()
      return Buffer.from(data)
    }
    if (fs.existsSync(image)) return await fs.promises.readFile(image)
    return null
  }

  /**
   * 尝试从消息元素中提取文本或识别图片二维码
   * @param {Array<*>} messages 消息元素数组
   * @param {string} source 来源描述
   * @returns {Promise<string>}
   */
  async extractMessageText(messages, source = '消息') {
    const segments = getMessageSegments(messages)
    const textCandidates = []

    for (const msg of segments) {
      if (['text', 'json', 'xml', 'markdown'].includes(msg?.type)) {
        const text = getMessageSegmentText(msg)
        if (!text) continue
        const cardLink = findSupportedLink(text)
        if (cardLink) return cardLink
        if (hasSupportedLink(text)) return text
        textCandidates.push(text)
      }
    }

    for (const text of textCandidates) {
      const markdownText = await this.extractMarkdownText(text, source)
      if (!markdownText) continue
      const markdownLink = findSupportedLink(markdownText)
      if (markdownLink) return markdownLink
      if (hasSupportedLink(markdownText)) return markdownText
    }

    for (const msg of segments) {
      if (msg?.type !== 'image') continue
      const image = getMessageImageSource(msg)
      const qrResult = await this.tryScanImageQrCode(image, source)
      if (qrResult) return qrResult
    }

    const combinedText = textCandidates.join('')
    return hasSupportedLink(combinedText) ? combinedText : (textCandidates[0] || '')
  }

  /**
   * 解析 markdown/json 文本中的图片二维码
   * @param {string} text 文本
   * @param {string} source 来源描述
   * @returns {Promise<string>}
   */
  async extractMarkdownText(text, source) {
    if (!text || typeof text !== 'string') return ''
    let content = text
    try {
      const parsed = JSON.parse(text)
      const cardLink = findSupportedLink(parsed)
      if (cardLink) return cardLink
      if (parsed?.type === 'markdown' && parsed.data?.content) content = parsed.data.content
    } catch {
      // 普通文本不需要 JSON 解析
    }
    const imageRegex = /!\[.*?\]\((.*?)\)/g
    let match
    while ((match = imageRegex.exec(content)) !== null) {
      const qrResult = await this.tryScanImageQrCode(match[1], `${source}中的 markdown 图片`)
      if (qrResult) return qrResult
    }
    return content === text ? '' : content
  }

  /**
   * 获取回复消息的内容
   * @param {*} e 消息事件对象
   * @returns {Promise<string>} 回复消息的文本内容
   */
  async getReplyMessage(e) {
    const botAdapter = new Base(e).botadapter
    const originalMsg = e.msg || ''
    const currentMessageText = await this.extractMessageText(e.message, '当前消息')
    if (currentMessageText && hasSupportedLink(currentMessageText)) return currentMessageText

    const replySegment = (e.message || []).find((/** @type {{ type?: string }} */ msg) => msg?.type === 'reply')
    const replyId = e.reply_id ?? replySegment?.id ?? replySegment?.data?.id ?? replySegment?.data?.message_id
    const replyLoaders = []
    if (typeof e.getReply === 'function') {
      replyLoaders.push(['getReply', () => e.getReply()])
    } else if (replyId && typeof (e.group || e.friend)?.getMsg === 'function') {
      replyLoaders.push(['getMsg', () => (e.group || e.friend).getMsg(replyId)])
    }
    if (replyId && ['LagrangeCore', 'Lagrange.OneBot', 'OneBotv11'].includes(botAdapter) && typeof e.bot?.sendApi === 'function') {
      replyLoaders.push(['OneBot get_msg', () => e.bot.sendApi('get_msg', { message_id: replyId })])
    }

    let replyFallback = ''
    const replySegmentTypes = new Set()
    for (const [loaderName, loadReply] of replyLoaders) {
      try {
        const replyData = await loadReply()
        const segments = getMessageSegments(replyData)
        for (const segment of segments) replySegmentTypes.add(segment?.type || 'unknown')
        const replyText = await this.extractMessageText(segments, '引用消息')
        if (replyText && hasSupportedLink(replyText)) return replyText
        if (replyText && !replyFallback) replyFallback = replyText
      } catch (error) {
        logger.warn(`[引用解析] ${loaderName} 获取失败（id=${replyId || 'unknown'}）: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // ICQQ适配器处理
    if (botAdapter === 'ICQQ' && e.source) {
      const history = await (e.group || e.friend)?.getChatHistory(e.isGroup ? e.source.seq : e.source.time, 1)
      const message = history.pop()?.message
      const replyText = await this.extractMessageText(message, '引用消息')
      if (replyText && hasSupportedLink(replyText)) return replyText
      if (replyText && !replyFallback) replyFallback = replyText
    }

    if (replyId && replyLoaders.length) {
      logger.warn(`[引用解析] 未提取到支持的平台链接（id=${replyId}，adapter=${botAdapter}，消息段=${[...replySegmentTypes].join(',') || 'none'}）`)
    }
    return replyFallback || originalMsg
  }

  /**
   * 将中文数字转换为阿拉伯数字
   * @param {string} chineseNumber 中文数字字符串
   * @returns {number} 转换后的阿拉伯数字
   */
  chineseToArabic(chineseNumber) {
    const numbers = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
    const units = { 十: 10, 百: 100, 千: 1000, 万: 10000, 亿: 100000000 }

    let result = 0, temp = 0, unit = 1

    for (let i = chineseNumber.length - 1; i >= 0; i--) {
      const char = chineseNumber[i]

      if (char && char in units) {
        unit = /** @type {number} */ (units[/** @type {keyof typeof units} */ (char)])
        if (unit >= 10000) {
          result += temp * unit
          temp = 0
        }
      } else if (char && char in numbers) {
        temp += /** @type {number} */ (numbers[/** @type {keyof typeof numbers} */ (char)]) * (unit > 1 ? unit : 1)
        unit = 1
      }
    }

    return result + temp
  }

  /**
   * 格式化Cookie字符串
   * @param {string[]} cookies Cookie数组
   * @returns {string} 格式化后的Cookie字符串
   */
  formatCookies(cookies) {
    return cookies.map(cookie => {
      const [nameValue] = cookie.split(';').map(part => part.trim())
      const [name, value] = (nameValue || '').split('=')
      return `${name}=${value}`
    }).join('; ')
  }

  /**
   * 计算视频比特率
   * @param {number} targetSizeMB 目标文件大小(MB)
   * @param {number} duration 视频时长(秒)
   * @returns {number} 计算得到的比特率(kbps)
   */
  calculateBitrate(targetSizeMB, duration) {
    const targetSizeBytes = targetSizeMB * 1024 * 1024
    return (targetSizeBytes * 8) / duration / 1024
  }

  /**
   * 获取视频文件大小
   * @param {string} filePath 文件路径
   * @returns {Promise<number>} 文件大小(MB)
   */
  async getVideoFileSize(filePath) {
    try {
      const stats = await fs.promises.stat(filePath)
      const fileSizeInBytes = stats.size
      const fileSizeInMB = fileSizeInBytes / (1024 * 1024)
      return fileSizeInMB
    } catch (error) {
      logger.error('获取文件大小时发生错误:', error)
      throw error
    }
  }

  /**
   * 将数字转换为带"万"单位的字符串
   * @param {number} count 需要转换的数字
   * @returns {string} 转换后的字符串，超过1万的数字会转换为"xx万"的格式
   * @example
   * count(12345) // 返回 "1.2万"
   * count(999) // 返回 "999"
   * count(undefined) // 返回 "无法获取"
   */
  count(count) {
    if (count > 10000) {
      return (count / 10000).toFixed(1) + '万'
    } else {
      return count?.toString() || '无法获取'
    }
  }

  /**
   * 递归创建文件夹
   * @param {string} dirname 文件夹路径
   * @returns {Promise<boolean>} 返回布尔值 是否创建成功
   */
  async mkdir(dirname) {
    try {
      await fs.promises.mkdir(dirname, { recursive: true })
      return true
    } catch {
      return false
    }
  }

  /**
   * 删除文件
   * @param {string} dirname 文件路径
   * @param {boolean} force 是否强制删除
   * @returns {Promise<boolean>} 删除是否成功
   */
  async removeFile(dirname, force = false) {
    if (!Config.app.removeCache && !force) return true

    const normalizedPath = dirname.replace(/\\/g, '/')
    try {
      await fs.promises.unlink(normalizedPath)
      logger.mark(`缓存文件: ${normalizedPath} 删除成功！`)
      return true
    } catch (err) {
      logger.error(`缓存文件: ${normalizedPath} 删除失败！`, err)
      return false
    }
  }

  /**
   * 将时间戳转换为日期时间字符串
   * @param {number} timestamp Unix时间戳
   * @returns {string} 格式化的日期时间字符串 (YYYY-MM-DD HH:mm)
   */
  convertTimestampToDateTime(timestamp) {
    const date = new Date(timestamp * 1000)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    return `${year}-${month}-${day} ${hours}:${minutes}`
  }

  /**
   * 获取当前时间的格式化字符串
   * @returns {string} 格式化的当前时间字符串 (YYYY-MM-DD HH:mm:ss)
   */
  getCurrentTime() {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth() + 1
    const day = now.getDate()
    const hour = now.getHours()
    const minute = now.getMinutes()
    const second = now.getSeconds()

    const formattedMonth = month < 10 ? '0' + month : '' + month
    const formattedDay = day < 10 ? '0' + day : '' + day
    const formattedHour = hour < 10 ? '0' + hour : '' + hour
    const formattedMinute = minute < 10 ? '0' + minute : '' + minute
    const formattedSecond = second < 10 ? '0' + second : '' + second
    return `${year}-${formattedMonth}-${formattedDay} ${formattedHour}:${formattedMinute}:${formattedSecond}`
  }

  /**
   * 根据配置和时间判断是否使用深色主题
   * @returns {boolean} 是否使用深色主题
   */
  useDarkTheme() {
    let dark = true
    const configTheme = Config.app.Theme
    if (configTheme === 0) {
      const date = new Date().getHours()
      if (date >= 6 && date < 18) {
        dark = false
      }
    } else if (configTheme === 1) {
      dark = false
    } else if (configTheme === 2) {
      dark = true
    }
    return dark
  }

  /**
   * 计算从指定时间戳到现在经过的时间
   * @param {number} timestamp 起始时间戳
   * @returns {string} 格式化的经过时间字符串
   */
  timeSince(timestamp) {
    const now = Date.now()
    const elapsed = now - timestamp

    const seconds = Math.floor(elapsed / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)

    const remainingSeconds = seconds % 60
    const remainingMinutes = minutes % 60

    if (hours > 0) {
      return `${hours}小时${remainingMinutes}分钟${remainingSeconds}秒`
    } else if (minutes > 0) {
      return `${minutes}分钟${remainingSeconds}秒`
    } else {
      return `${seconds}秒`
    }
  }

  /**
   * 休眠函数
   * @param {number} ms 毫秒
   * @example
   * ```js
   * await Common.sleep(1000)
   * ```
   */
  async sleep(ms) {
    return await new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * 为异步操作设置最大等待时间。
   * @template T
   * @param {Promise<T> | (() => Promise<T>)} task
   * @param {number} timeoutMs
   * @param {string} label
   * @returns {Promise<T>}
   */
  async withTimeout(task, timeoutMs, label = '异步操作') {
    let timeoutId
    const operation = typeof task === 'function' ? Promise.resolve().then(task) : Promise.resolve(task)
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        const error = new Error(`${label} timeout after ${timeoutMs}ms`)
        error.code = 'ETIMEDOUT'
        reject(error)
      }, timeoutMs)
    })

    try {
      return await Promise.race([operation, timeout])
    } finally {
      clearTimeout(timeoutId)
    }
  }

}

export default new Tools()
