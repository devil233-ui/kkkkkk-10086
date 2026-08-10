/**
 * 规范化消息中的抖音链接文本，兼容JSON卡片里的转义斜杠和HTML实体。
 * @param {unknown} message 消息内容
 * @returns {string}
 */
export const normalizeDouyinMessage = (message) => {
  let text
  try {
    text = typeof message === 'string' ? message : JSON.stringify(message ?? '')
  } catch {
    text = String(message ?? '')
  }

  return text
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/&amp;/gi, '&')
}

/**
 * 从普通文本或引用卡片JSON中提取抖音链接。
 * @param {unknown} message 消息内容
 * @returns {string}
 */
export const extractDouyinUrl = (message) => {
  const normalized = normalizeDouyinMessage(message)
  const matches = [...normalized.matchAll(/https?:\/\/(?:www\.|v\.|jx\.|m\.|jingxuan\.)?(?:douyin\.com|iesdouyin\.com)\/[^\s"'<>\\}\]]+/gi)]
    .map(match => match[0].replace(/[),，。！？…]+$/, ''))

  if (matches.length === 0) return ''

  const getWorkIdLength = (url) => /\/(?:share\/)?(?:video|note|slides|article)\/(\d{15,})/i.exec(url)?.[1]?.length || 0
  return matches.sort((first, second) => getWorkIdLength(second) - getWorkIdLength(first) || second.length - first.length)[0]
}

/**
 * 直接从抖音长链接提取作品信息，避免已是note/video链接时再次请求重定向。
 * @param {unknown} url 抖音链接
 * @returns {{kind: string, aweme_id: string, is_mp4: boolean} | null}
 */
export const parseDirectDouyinWorkUrl = (url) => {
  const normalized = normalizeDouyinMessage(url)
  const match = /https?:\/\/(?:www\.|m\.)?(?:douyin\.com|iesdouyin\.com)\/(?:share\/)?(video|note|slides|article)\/(\d{15,})/i.exec(normalized)
  if (!match) return null

  return {
    kind: match[1].toLowerCase(),
    aweme_id: match[2],
    is_mp4: match[1].toLowerCase() === 'video'
  }
}

/**
 * 获取抖音作品音乐地址。常规地址为空时，回退到extra.original_song_url。
 * @param {any} music 抖音作品音乐数据
 * @returns {string}
 */
export const resolveDouyinMusicUrl = (music) => {
  if (!music) return ''

  const directUrlList = Array.isArray(music.play_url?.url_list) ? music.play_url.url_list : []
  const directCandidates = [music.play_url?.uri, ...directUrlList]
  const directUrl = directCandidates.find(url => typeof url === 'string' && /^https?:\/\//i.test(url))
  if (directUrl) return directUrl

  try {
    const extra = typeof music.extra === 'string' ? JSON.parse(music.extra) : music.extra
    const original = extra?.original_song_url
    const originalUrlList = Array.isArray(original?.url_list) ? original.url_list : []
    const fallbackCandidates = [
      original,
      original?.uri,
      ...originalUrlList
    ]
    return fallbackCandidates.find(url => typeof url === 'string' && /^https?:\/\//i.test(url)) || ''
  } catch {
    return ''
  }
}
