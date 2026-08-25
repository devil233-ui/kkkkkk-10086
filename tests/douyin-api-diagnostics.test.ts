import { describe, expect, it } from 'vitest'

import {
  attachDouyinApiDiagnostic,
  formatDouyinApiDiagnostic,
  getDouyinRequestFingerprint
} from '@/module/platform/douyin/apiDiagnostics'

describe('Douyin API diagnostics', () => {
  it('hashes request identifiers instead of exposing their values', () => {
    const fingerprint = getDouyinRequestFingerprint({ sec_uid: 'secret-sec-uid', aweme_id: '123456' })

    expect(fingerprint).toMatch(/^sec_uid#[a-f0-9]{12},aweme_id#[a-f0-9]{12}$/)
    expect(fingerprint).not.toContain('secret-sec-uid')
    expect(fingerprint).not.toContain('123456')
  })

  it('attaches the upstream status to the wrapped error response', () => {
    const result = attachDouyinApiDiagnostic(
      { code: 500, message: '抖音数据获取失败' },
      { methodType: 'userProfile', errorCode: 10203, errorMessage: '访问频繁', duration: 321 }
    ) as { error: Record<string, unknown> }

    expect(result.error.amagiStatusCode).toBe(10203)
    expect(result.error.message).toBe('访问频繁')
    expect(result.error.requestType).toBe('userProfile')
  })

  it('formats a bounded diagnostic log line', () => {
    const line = formatDouyinApiDiagnostic(
      '用户主页数据',
      { sec_uid: 'secret-sec-uid' },
      500,
      { methodType: 'userProfile', errorCode: 10203, errorMessage: '第一行\n第二行', duration: 10 }
    )

    expect(line).toContain('upstream_code=10203')
    expect(line).toContain('duration=10ms')
    expect(line).not.toContain('secret-sec-uid')
    expect(line).not.toContain('\n')
  })
})
