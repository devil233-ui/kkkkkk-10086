/** 一轮抖音推送中实际需要发送的作品数量与失败数量。 */
export interface DouyinPushRunSummary {
  attempted: number
  failed: number
  reasons: string[]
}

export interface DouyinPushFailureDecision extends DouyinPushRunSummary {
  consecutiveFailures: number
  shouldNotify: boolean
}

export const DOUYIN_PUSH_FAILURE_THRESHOLD = 3

/** 只统计有实际待发送内容的连续推送轮次，避免 API 空结果触发主人告警。 */
export class DouyinPushFailureTracker {
  private consecutiveFailures = 0
  private notified = false

  record (summary: DouyinPushRunSummary): DouyinPushFailureDecision {
    if (summary.attempted <= 0 || summary.failed <= 0) {
      this.reset()
      return {
        ...summary,
        consecutiveFailures: 0,
        shouldNotify: false,
        reasons: [...summary.reasons]
      }
    }

    this.consecutiveFailures += 1
    const shouldNotify = this.consecutiveFailures >= DOUYIN_PUSH_FAILURE_THRESHOLD && !this.notified
    if (shouldNotify) this.notified = true

    return {
      attempted: summary.attempted,
      failed: summary.failed,
      reasons: [...summary.reasons],
      consecutiveFailures: this.consecutiveFailures,
      shouldNotify
    }
  }

  reset (): void {
    this.consecutiveFailures = 0
    this.notified = false
  }
}

export const DOUYIN_FETCH_FAILURE_THRESHOLD = 3

/** 一轮订阅取数的成功/失败计数。 */
export interface DouyinFetchOutcome {
  /** 本轮成功取到主页数据的订阅数 */
  succeeded: number
  /** 本轮因接口报错被跳过的订阅数 */
  failed: number
  /** 最近一条失败原因，用于告警正文 */
  reason?: string
}

export interface DouyinFetchFailureDecision {
  consecutiveFailures: number
  shouldNotify: boolean
  failed: number
  reason?: string
}

/**
 * 统计「整轮订阅都没取到数据」的连续轮次。
 *
 * 与 {@link DouyinPushFailureTracker} 的分工：后者只看**实际发送**失败，
 * 而取数阶段全军覆没时（例如 2026-10 抖音 Argus 风控期间全部订阅 code=500）
 * 根本没有作品进入发送阶段，`attempted` 恒为 0，那条通道永远不会告警——
 * 这正是当时连续一周零私聊的原因。这里补上取数通道：一轮里没有任何订阅
 * 取数成功、且至少有一个失败，就累计一轮；连续 N 轮后私聊主人一次，
 * 之后不再重复，直到有一轮恢复（只要有一个订阅成功就重置）。
 */
export class DouyinFetchFailureTracker {
  private consecutiveFailures = 0
  private notified = false

  record (outcome: DouyinFetchOutcome): DouyinFetchFailureDecision {
    if (outcome.failed <= 0) {
      this.reset()
      return { consecutiveFailures: 0, shouldNotify: false, failed: 0, reason: outcome.reason }
    }
    // 只要有一个订阅取数成功，就说明服务可用，按瞬时故障处理
    if (outcome.succeeded > 0) {
      this.reset()
      return { consecutiveFailures: 0, shouldNotify: false, failed: outcome.failed, reason: outcome.reason }
    }

    this.consecutiveFailures += 1
    const shouldNotify = this.consecutiveFailures >= DOUYIN_FETCH_FAILURE_THRESHOLD && !this.notified
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
