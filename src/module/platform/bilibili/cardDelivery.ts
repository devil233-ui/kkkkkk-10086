import type { ImageMessage } from '@/module/utils/Watermark'
import { classifyMessageSendResult, isSendTimeoutError } from '@/module/utils/messageSend'

interface DynamicPushProgressRow {
  confirmed_pages?: number
  total_pages?: number
  last_message_id?: string
}

interface ProgressStore {
  getDynamicPushProgress?: (
    dynamicId: string,
    hostMid: number,
    groupId: string
  ) => Promise<DynamicPushProgressRow | null>
  saveDynamicPushProgress?: (
    dynamicId: string,
    hostMid: number,
    groupId: string,
    confirmedPages: number,
    totalPages: number,
    lastMessageId?: string
  ) => Promise<unknown>
  deleteDynamicPushProgress?: (
    dynamicId: string,
    hostMid: number,
    groupId: string
  ) => Promise<unknown>
}

export interface BilibiliCardDeliveryResult {
  status: unknown
  messageId: string
}

const getSendMessageId = (status: unknown): string => {
  if (!status || typeof status !== 'object') return ''
  const value = status as {
    message_id?: unknown
    messageId?: unknown
    data?: { message_id?: unknown }
  }
  return String(value.message_id ?? value.messageId ?? value.data?.message_id ?? '')
}

export const withTimeout = async <T> (
  task: () => Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> => {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label} timeout after ${timeoutMs}ms`)
      Object.assign(error, { code: 'ETIMEDOUT' })
      reject(error)
    }, timeoutMs)
  })

  try {
    return await Promise.race([task(), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * 逐页发送 B 站卡片，并只持久化已确认的页面进度。
 * 超时不会写长期去重缓存，下一轮从最后一个已确认页面继续。
 */
export const sendBilibiliCard = async ({
  images,
  dynamicId,
  hostMid,
  groupId,
  sendPage,
  timeoutMs,
  progressStore,
  logger
}: {
  images: ImageMessage[]
  dynamicId: string
  hostMid: number
  groupId: string
  sendPage: (page: ImageMessage) => Promise<unknown>
  timeoutMs: number
  progressStore?: ProgressStore | null
  logger: { debug: (message: string) => unknown; mark: (message: string) => unknown; warn: (message: string) => unknown }
}): Promise<BilibiliCardDeliveryResult> => {
  const pages = images.length > 0 ? images : []
  const savedProgress = await progressStore?.getDynamicPushProgress?.(dynamicId, hostMid, groupId)
  let confirmedPages = Number(savedProgress?.confirmed_pages || 0)
  let lastMessageId = String(savedProgress?.last_message_id || '')
  let status: unknown = lastMessageId ? { message_id: lastMessageId } : undefined

  if (savedProgress && (Number(savedProgress.total_pages) !== pages.length || confirmedPages > pages.length)) {
    logger.warn(`[Bilibili Push] 动态${dynamicId}渲染页数已变化，重置卡片发送进度`)
    confirmedPages = 0
    lastMessageId = ''
    status = undefined
    await progressStore?.deleteDynamicPushProgress?.(dynamicId, hostMid, groupId)
  } else if (confirmedPages > 0) {
    logger.mark(`[Bilibili Push] 动态${dynamicId}已确认${confirmedPages}/${pages.length}页，从下一页继续`)
  }

  for (let index = confirmedPages; index < pages.length; index++) {
    const pageLabel = `${index + 1}/${pages.length}`
    const page = pages[index]
    if (!page) continue
    logger.debug(`[Bilibili Push] 动态${dynamicId}发送卡片第${pageLabel}页`)
    status = await withTimeout(
      () => sendPage(page),
      timeoutMs,
      `B站动态卡片[${pageLabel}] sendMsg`
    )
    if (isSendTimeoutError(status, true)) {
      throw Object.assign(
        new Error(`B站动态卡片[${pageLabel}] sendMsg returned timeout`),
        { code: 'ETIMEDOUT' }
      )
    }
    if (classifyMessageSendResult(status) === 'failed') {
      throw new Error(`B站动态卡片[${pageLabel}] sendMsg returned an explicit failure`)
    }
    const messageId = getSendMessageId(status)
    if (messageId) lastMessageId = messageId
    await progressStore?.saveDynamicPushProgress?.(
      dynamicId,
      hostMid,
      groupId,
      index + 1,
      pages.length,
      lastMessageId
    )
    if (!messageId) logger.warn(`[Bilibili Push] 动态${dynamicId}卡片第${pageLabel}页已返回，但没有 message_id`)
  }

  return { status, messageId: lastMessageId }
}
