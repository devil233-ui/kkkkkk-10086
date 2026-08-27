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
