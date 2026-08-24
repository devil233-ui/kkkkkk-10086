import { describe, expect, it } from 'vitest'

import { resolveCommentLimit } from '@/module/platform/common/commentLimit'

describe('resolveCommentLimit', () => {
  it('uses the modern value before the legacy value', () => {
    expect(resolveCommentLimit(3, 8)).toBe(3)
  })

  it('preserves zero as the explicit disabled value', () => {
    expect(resolveCommentLimit(0, 5)).toBe(0)
  })

  it('falls back to the legacy value and then the default', () => {
    expect(resolveCommentLimit(undefined, 4)).toBe(4)
    expect(resolveCommentLimit(undefined, undefined)).toBe(5)
  })

  it('normalizes positive values and disables invalid values', () => {
    expect(resolveCommentLimit(2.9, undefined)).toBe(2)
    expect(resolveCommentLimit(-1, undefined)).toBe(0)
    expect(resolveCommentLimit(Number.NaN, undefined)).toBe(0)
  })
})
