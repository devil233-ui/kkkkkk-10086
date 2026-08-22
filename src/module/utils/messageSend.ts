export type MessageSendResult = 'sent' | 'failed' | 'uncertain'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const hasNonEmptyError = (value: unknown): boolean => {
  if (value === undefined || value === null) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'string') return value.length > 0
  if (isRecord(value)) return Object.keys(value).length > 0
  return true
}

interface SendErrorDetails {
  texts: string[]
  codes: string[]
  actions: string[]
  hasTimeoutField: boolean
}

/**
 * 读取发送错误的少量诊断字段。
 * 错误对象里可能携带完整消息和 base64，不能直接 JSON.stringify。
 */
const inspectSendError = (value: unknown, details: SendErrorDetails, depth = 0, seen = new Set<object>()): void => {
  if (depth > 4 || value === null || value === undefined) return

  if (typeof value === 'string') {
    details.texts.push(value.slice(0, 512))
    return
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    details.texts.push(String(value))
    return
  }

  if (typeof value !== 'object') return
  if (seen.has(value)) return
  seen.add(value)

  if (value instanceof Error) {
    details.texts.push(value.name, value.message.slice(0, 512))
  }

  if (Array.isArray(value)) {
    for (const item of value.slice(0, 8)) inspectSendError(item, details, depth + 1, seen)
    return
  }

  const record = value as Record<string, unknown>
  for (const key of ['name', 'message', 'description', 'code', 'errorCode', 'retcode', 'action', 'timeout']) {
    const item = record[key]
    if (item === undefined || item === null) continue
    if (key === 'action') details.actions.push(String(item).toLowerCase())
    if (key === 'code' || key === 'errorCode' || key === 'retcode') details.codes.push(String(item).toUpperCase())
    if (key === 'timeout') details.hasTimeoutField = item === true || (typeof item === 'number' && item > 0)
    inspectSendError(item, details, depth + 1, seen)
  }

  for (const key of ['error', 'request', 'response', 'data']) {
    const item = record[key]
    if (item !== undefined && item !== null) inspectSendError(item, details, depth + 1, seen)
  }
}

/** 判断发送异常是否来自消息发送超时，而不是普通网络下载超时。 */
export const isSendTimeoutError = (error: unknown, allowBareTimeoutCode = false): boolean => {
  const details: SendErrorDetails = { texts: [], codes: [], actions: [], hasTimeoutField: false }
  inspectSendError(error, details)

  const text = details.texts.join(' ').toLowerCase()
  const hasTimeout = details.hasTimeoutField ||
    details.codes.includes('ETIMEDOUT') ||
    details.codes.includes('1200') ||
    /timeout|timed out|超时|请求超时/i.test(text)
  if (!hasTimeout) return false

  const hasSendContext = details.actions.some(action => action === 'send_msg' || action === 'sendmsg') ||
    /send_msg|sendmsg/i.test(text)
  return hasSendContext || details.codes.includes('1200') ||
    (allowBareTimeoutCode && details.codes.includes('ETIMEDOUT'))
}

/**
 * 区分适配器返回的明确失败、明确成功和无法确认的结果。
 * 无错误字段但缺少 message_id 的对象属于不确定状态，应按已提交处理，避免重复发送。
 */
export const classifyMessageSendResult = (status: unknown): MessageSendResult => {
  if (status === undefined || status === null || status === false) return 'failed'
  if (status instanceof Error) return 'failed'
  if (!isRecord(status)) return 'sent'

  if (hasNonEmptyError(status.error)) return 'failed'
  if (typeof status.retcode === 'number' && status.retcode !== 0) return 'failed'

  const messageId = status.message_id ?? status.messageId ??
    (isRecord(status.data) ? status.data.message_id ?? status.data.messageId : undefined)
  if (typeof messageId === 'string' || typeof messageId === 'number') {
    return messageId ? 'sent' : 'uncertain'
  }
  if (Array.isArray(messageId)) return messageId.length > 0 ? 'sent' : 'uncertain'

  if (Array.isArray(status.data) && status.data.length > 0) return 'sent'
  return 'uncertain'
}
