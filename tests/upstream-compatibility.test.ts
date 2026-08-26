import { describe, expect, it } from 'vitest'

import { buildXiaohongshuShareUrl } from '@/module/platform/xiaohongshu/link'
import { getDouyinWorkCoverUrl } from '@/module/platform/douyin/workType'
import { normalizeCookieValue } from '@/module/utils/cookie'

describe('upstream compatibility fixes', () => {
  it('normalizes cookie values at the configuration boundary', () => {
    expect(normalizeCookieValue('  sid=abc  ')).toBe('sid=abc')
    expect(normalizeCookieValue(114514)).toBe('114514')
    expect(normalizeCookieValue(null)).toBe('')
    expect(normalizeCookieValue({})).toBe('')
  })

  it('skips low-resolution Douyin cover candidates when possible', () => {
    expect(getDouyinWorkCoverUrl({
      aweme_type: 0,
      video: {
        cover_original_scale: { url_list: ['https://cdn.example/a~tplv-x-360p.jpeg'] },
        cover: { url_list: ['https://cdn.example/full.jpeg'] }
      }
    })).toBe('https://cdn.example/full.jpeg')
  })

  it('builds the complete Xiaohongshu share query', () => {
    const url = new URL(buildXiaohongshuShareUrl('note-1', 'token-1'))
    expect(url.searchParams.get('source')).toBe('webshare')
    expect(url.searchParams.get('xhsshare')).toBe('pc_web')
    expect(url.searchParams.get('xsec_token')).toBe('token-1')
    expect(url.searchParams.get('xsec_source')).toBe('pc_share')
  })
})
