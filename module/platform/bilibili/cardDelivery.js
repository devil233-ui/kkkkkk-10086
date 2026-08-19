export const getSendMessageId = status => status?.message_id ?? status?.messageId ?? status?.data?.message_id ?? ''

/**
 * 逐页发送B站卡片，并只持久化已获得成功响应的页面。
 * @param {Object} options 发送参数
 * @param {Array<*>|*} options.images 卡片页面
 * @param {string} options.dynamicId 动态ID
 * @param {number} options.hostMid UP主UID
 * @param {string} options.groupId 群组ID
 * @param {(page: *) => Promise<*>} options.sendPage 单页发送函数
 * @param {(task: () => Promise<*>, timeoutMs: number, label: string) => Promise<*>} options.withTimeout 超时包装器
 * @param {number} options.timeoutMs 单页超时
 * @param {*} options.progressStore 进度存储
 * @param {*} options.logger 日志实例
 * @returns {Promise<{status: *, messageId: string}>}
 */
export const sendBilibiliCard = async ({
  images,
  dynamicId,
  hostMid,
  groupId,
  sendPage,
  withTimeout,
  timeoutMs,
  progressStore,
  logger
}) => {
  const pages = Array.isArray(images) ? images : [images]
  const savedProgress = await progressStore?.getDynamicPushProgress(dynamicId, hostMid, groupId)
  let confirmedPages = Number(savedProgress?.confirmed_pages || 0)
  let lastMessageId = String(savedProgress?.last_message_id || '')
  let status = lastMessageId ? { message_id: lastMessageId } : undefined

  if (savedProgress && (Number(savedProgress.total_pages) !== pages.length || confirmedPages > pages.length)) {
    logger.warn(`[Bilibili Push] 动态${dynamicId}渲染页数已变化，重置卡片发送进度`)
    confirmedPages = 0
    lastMessageId = ''
    status = undefined
    await progressStore?.deleteDynamicPushProgress(dynamicId, hostMid, groupId)
  } else if (confirmedPages > 0) {
    logger.mark(`[Bilibili Push] 动态${dynamicId}已确认${confirmedPages}/${pages.length}页，从下一页继续`)
  }

  for (let index = confirmedPages; index < pages.length; index++) {
    const pageLabel = `${index + 1}/${pages.length}`
    logger.debug(`[Bilibili Push] 动态${dynamicId}发送卡片第${pageLabel}页`)
    status = await withTimeout(
      () => sendPage(pages[index]),
      timeoutMs,
      `B站动态卡片[${pageLabel}] sendMsg`
    )
    const messageId = getSendMessageId(status)
    if (messageId) lastMessageId = String(messageId)
    await progressStore?.saveDynamicPushProgress(dynamicId, hostMid, groupId, index + 1, pages.length, lastMessageId)
    if (!messageId) logger.warn(`[Bilibili Push] 动态${dynamicId}卡片第${pageLabel}页已成功返回，但没有 message_id`)
  }

  return { status, messageId: lastMessageId }
}
