/**
 * B站卡片发送超时的处置策略。
 *
 * 独立成文件是为了让决策逻辑可以脱离云崽运行时单测：这里不导入任何运行时依赖。
 *
 * 背景：NapCat/QQ 内核发消息偶发长时间不回执（实测 2026-09-21、09-27 各一轮，
 * NapCat 侧 `NodeIKernelMsgService/sendMsg` 超时 18~27 次），而回执超时 ≠ 未送达
 * ——群里出现重复本身就证明首条已送达。旧逻辑一律「保留进度下一轮继续」，
 * 于是同一动态被反复重推刷屏。
 */

/** 同一动态同一群连续发送超时几次后熔断（停止重推并告警主人） */
export const BILIBILI_TIMEOUT_BREAKER_THRESHOLD = 2

export type BilibiliTimeoutAction = 'treat-as-delivered' | 'retry' | 'breaker'

/**
 * 发送超时后的处置决策。
 *
 * 回执超时 ≠ 未送达：QQ 侧「超时」多数情况消息其实已经发出，所以连接仍在线
 * 时按已送达处理，避免重复刷屏；连接已断时消息不可能送达，保留页级进度下一轮
 * 重试，连续失败达到阈值则熔断。
 */
export const resolveBilibiliTimeoutAction = (
  connectionAlive: boolean,
  consecutiveFailures: number
): BilibiliTimeoutAction => {
  if (connectionAlive) return 'treat-as-delivered'
  return consecutiveFailures >= BILIBILI_TIMEOUT_BREAKER_THRESHOLD ? 'breaker' : 'retry'
}

/**
 * 连续超时计数：key = `${dynamicId}:${groupId}`。
 * 该动态整项成功、按已送达结案或熔断时都会清零，只保留正在重试中的条目。
 */
export const bilibiliTimeoutFailures = new Map<string, number>()
