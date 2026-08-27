import { describe, expect, it } from 'vitest'

import { DouyinPushFailureTracker } from '@/module/platform/douyin/pushFailure'

const failedRun = (reason = '发送失败') => ({
  attempted: 1,
  failed: 1,
  reasons: [reason]
})

describe('DouyinPushFailureTracker', () => {
  it('only notifies on the third consecutive real failure', () => {
    const tracker = new DouyinPushFailureTracker()

    expect(tracker.record(failedRun()).shouldNotify).toBe(false)
    expect(tracker.record(failedRun()).shouldNotify).toBe(false)
    expect(tracker.record(failedRun()).shouldNotify).toBe(true)
    expect(tracker.record(failedRun()).shouldNotify).toBe(false)
  })

  it('resets after a successful or empty push run', () => {
    const tracker = new DouyinPushFailureTracker()

    tracker.record(failedRun())
    tracker.record(failedRun())
    expect(tracker.record({ attempted: 1, failed: 0, reasons: [] }).consecutiveFailures).toBe(0)
    expect(tracker.record(failedRun()).shouldNotify).toBe(false)

    tracker.record(failedRun())
    expect(tracker.record({ attempted: 0, failed: 0, reasons: [] }).consecutiveFailures).toBe(0)
    expect(tracker.record(failedRun()).shouldNotify).toBe(false)
  })
})
