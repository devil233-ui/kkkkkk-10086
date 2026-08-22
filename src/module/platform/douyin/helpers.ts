interface DouyinUrlLike {
  play_url?: {
    uri?: unknown
    url_list?: unknown
  }
  extra?: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isHttpUrl = (value: unknown): value is string =>
  typeof value === 'string' && /^https?:\/\//i.test(value)

/** 规范化文本中的转义斜杠、HTML实体，供抖音链接提取复用。 */
export const normalizeDouyinMessage = (message: unknown): string => {
  let text: string
  try {
    text = typeof message === 'string' ? message : JSON.stringify(message ?? '') || ''
  } catch {
    text = String(message ?? '')
  }

  return text
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/&amp;/gi, '&')
}

/** 从普通文本或引用卡片 JSON 中提取最可能的抖音作品链接。 */
export const extractDouyinUrl = (message: unknown): string => {
  const normalized = normalizeDouyinMessage(message)
  const matches = [...normalized.matchAll(
    /https?:\/\/(?:www\.|v\.|jx\.|m\.|jingxuan\.|live\.)?(?:douyin\.com|iesdouyin\.com)\/[^\s"'<>\\}\]]+/gi
  )].map(match => match[0].replace(/[),，。！？…]+$/u, ''))
  if (!matches.length) return ''

  const getWorkIdLength = (url: string): number =>
    /\/(?:share\/)?(?:video|note|slides|article)\/(\d{15,})/i.exec(url)?.[1]?.length || 0
  return matches.sort((first, second) =>
    getWorkIdLength(second) - getWorkIdLength(first) || second.length - first.length
  )[0] || ''
}

/** 已是完整作品链接时直接提取作品 ID，避免无意义的重定向请求。 */
export const parseDirectDouyinWorkUrl = (url: unknown): {
  kind: string
  aweme_id: string
  is_mp4: boolean
} | null => {
  const normalized = normalizeDouyinMessage(url)
  const match = /https?:\/\/(?:www\.|m\.)?(?:douyin\.com|iesdouyin\.com)\/(?:share\/)?(video|note|slides|article)\/(\d{15,})/i.exec(normalized)
  if (!match) return null

  const kind = match[1]?.toLowerCase() || 'video'
  return { kind, aweme_id: match[2] || '', is_mp4: kind === 'video' }
}

/** 获取抖音作品背景音乐地址，并回退到 extra.original_song_url。 */
export const resolveDouyinMusicUrl = (music: unknown): string => {
  if (!isRecord(music)) return ''
  const playUrl = isRecord(music.play_url) ? music.play_url : {}
  const directCandidates: unknown[] = [
    playUrl.uri,
    ...(Array.isArray(playUrl.url_list) ? playUrl.url_list : [])
  ]
  const directUrl = directCandidates.find(isHttpUrl)
  if (directUrl) return directUrl

  try {
    const parsedExtra: unknown = typeof music.extra === 'string'
      ? JSON.parse(music.extra)
      : music.extra
    if (!isRecord(parsedExtra)) return ''
    const original = parsedExtra.original_song_url
    const originalRecord = isRecord(original) ? original : undefined
    const fallbackCandidates: unknown[] = [
      original,
      originalRecord?.uri,
      ...(Array.isArray(originalRecord?.url_list) ? originalRecord.url_list : [])
    ]
    return fallbackCandidates.find(isHttpUrl) || ''
  } catch {
    return ''
  }
}

export type { DouyinUrlLike }
