import { createHash } from 'node:crypto'

export interface DouyinApiDiagnostic {
  methodType: string
  errorCode?: string | number
  errorMessage: string
  duration?: number
}

const IDENTIFIER_KEYS = ['sec_uid', 'aweme_id', 'room_id', 'music_id', 'query'] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const asText = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : ''

const hashIdentifier = (key: string, value: string): string =>
  createHash('sha256').update(`${key}:${value}`).digest('hex').slice(0, 12)

/** 返回可用于串联日志的请求标识，不暴露 sec_uid、作品 ID 或搜索词原文。 */
export const getDouyinRequestFingerprint = (options: Record<string, unknown>): string => {
  const identifiers = IDENTIFIER_KEYS.flatMap(key => {
    const value = asText(options[key]).trim()
    return value ? [`${key}#${hashIdentifier(key, value)}`] : []
  })
  return identifiers.join(',') || 'none'
}

/** 将 Amagi 事件中的真实错误补充到统一错误响应，供错误卡和调用栈使用。 */
export const attachDouyinApiDiagnostic = (
  result: unknown,
  diagnostic: DouyinApiDiagnostic
): unknown => {
  if (!isRecord(result)) return result

  const currentError = isRecord(result.error) ? result.error : {}
  return {
    ...result,
    error: {
      ...currentError,
      name: currentError.name || 'DouyinAPIError',
      message: currentError.message || diagnostic.errorMessage,
      requestType: currentError.requestType || diagnostic.methodType,
      amagiStatusCode: diagnostic.errorCode,
      amagiDuration: diagnostic.duration
    }
  }
}

export const formatDouyinApiDiagnostic = (
  method: string,
  options: Record<string, unknown>,
  resultCode: unknown,
  diagnostic?: DouyinApiDiagnostic
): string => {
  const code = diagnostic?.errorCode ?? resultCode ?? 'unknown'
  const message = (diagnostic?.errorMessage || '未提供错误描述').replace(/[\r\n]+/g, ' ').slice(0, 240)
  const duration = typeof diagnostic?.duration === 'number' ? ` duration=${diagnostic.duration}ms` : ''
  return `[抖音API] ${method} request=${getDouyinRequestFingerprint(options)} upstream_code=${code}${duration} message=${message}`
}
