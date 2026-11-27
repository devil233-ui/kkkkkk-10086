export const BILIBILI_FETCH_FAILURE_THRESHOLD = 3

/** 一轮 B站推送里订阅取数的成功/失败计数。 */
export interface BilibiliFetchOutcome {
  /** 本轮成功取到动态列表的 UP 数 */
  succeeded: number
  /** 本轮因接口报错被跳过的 UP 数 */
  failed: number
  /** 最近一条失败原因，用于告警正文 */
  reason?: string
}

export interface BilibiliFetchFailureDecision {
  consecutiveFailures: number
  shouldNotify: boolean
  failed: number
  reason?: string
}

/**
 * 统计「整轮订阅都没取到数据」的连续轮次，与抖音侧同一套语义。
 *
 * 为什么需要它：B站推送原有的告警只看「实际发送失败」，可一旦所有 UP 都卡在
 * 取数阶段（-352 风控、接口返回空、活动视频参数不符等），就没有任何作品进入
 * 发送阶段，那条通道永远不会触发；线上表现就是每轮只有几行 warn，主人什么也
 * 收不到。这里补上取数通道：一轮里没有任何 UP 取数成功、且至少有一个失败，
 * 就累计一轮；连续 N 轮后私聊主人一次，之后不再重复，直到有一轮恢复
 * （只要有一个 UP 成功就重置）。
 */
export class BilibiliFetchFailureTracker {
  private consecutiveFailures = 0
  private notified = false

  record (outcome: BilibiliFetchOutcome): BilibiliFetchFailureDecision {
    if (outcome.failed <= 0) {
      this.reset()
      return { consecutiveFailures: 0, shouldNotify: false, failed: 0, reason: outcome.reason }
    }
    // 只要有一个 UP 取数成功，就说明服务可用，按瞬时故障处理
    if (outcome.succeeded > 0) {
      this.reset()
      return { consecutiveFailures: 0, shouldNotify: false, failed: outcome.failed, reason: outcome.reason }
    }

    this.consecutiveFailures += 1
    const shouldNotify = this.consecutiveFailures >= BILIBILI_FETCH_FAILURE_THRESHOLD && !this.notified
    if (shouldNotify) this.notified = true

    return {
      consecutiveFailures: this.consecutiveFailures,
      shouldNotify,
      failed: outcome.failed,
      reason: outcome.reason
    }
  }

  reset (): void {
    this.consecutiveFailures = 0
    this.notified = false
  }
}
