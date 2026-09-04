import { describe, expect, it, vi } from 'vitest'

import { fetchBilibiliVideoInfo } from '@/module/platform/bilibili/videoInfo'

/** 被风控的出口 IP 上 amagi 的真实返回：data.data 里只有上游报文，没有 stat / owner */
const bannedResponse = {
  code: -412,
  message: 'B站数据获取失败',
  data: { code: -412, data: { code: -412, message: 'request was banned', ttl: 1 } }
}

const okResponse = {
  code: 200,
  data: { code: 0, data: { bvid: 'BV1xx', owner: { face: '', name: 'UP' }, stat: { like: 1, reply: 2, share: 3, view: 4, coin: 5 } } }
}

describe('fetchBilibiliVideoInfo', () => {
  it('带 Cookie 能取到数据时不再发匿名请求', async () => {
    const request = vi.fn().mockResolvedValue(okResponse)
    const warn = vi.fn()

    const result = await fetchBilibiliVideoInfo('BV1xx', '三姐', { cookie: 'SESSDATA=x', request, warn })

    expect(result).toBe(okResponse)
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith('SESSDATA=x', 'BV1xx')
    expect(warn).not.toHaveBeenCalled()
  })

  it('Cookie 失效时退回匿名请求', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(bannedResponse)
      .mockResolvedValueOnce(okResponse)
    const warn = vi.fn()

    const result = await fetchBilibiliVideoInfo('BV1xx', '三姐', { cookie: 'SESSDATA=x', request, warn })

    expect(result).toBe(okResponse)
    expect(request).toHaveBeenNthCalledWith(2, '', 'BV1xx')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('request was banned')
  })

  it('未配置 Cookie 时只发一次匿名请求', async () => {
    const request = vi.fn().mockResolvedValue(bannedResponse)
    const warn = vi.fn()

    const result = await fetchBilibiliVideoInfo('BV1xx', '三姐', { cookie: '', request, warn })

    expect(result).toBeUndefined()
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith('', 'BV1xx')
  })

  it('两次都被风控时返回 undefined 而不是抛错', async () => {
    const request = vi.fn().mockResolvedValue(bannedResponse)
    const warn = vi.fn()

    await expect(fetchBilibiliVideoInfo('BV1xx', '三姐', { cookie: 'SESSDATA=x', request, warn })).resolves.toBeUndefined()
    expect(request).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('请求抛错（超时）按一次失败处理并继续下一次尝试', async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new Error('请求超时'))
      .mockResolvedValueOnce(okResponse)
    const warn = vi.fn()

    const result = await fetchBilibiliVideoInfo('BV1xx', '三姐', { cookie: 'SESSDATA=x', request, warn })

    expect(result).toBe(okResponse)
    expect(warn.mock.calls[0]?.[0]).toContain('请求超时')
  })

  it('响应缺少 stat 或 owner 都算取数失败', async () => {
    const warn = vi.fn()
    const onlyStat = { data: { data: { stat: { like: 1 } } } }
    const onlyOwner = { data: { data: { owner: { name: 'UP' } } } }

    await expect(fetchBilibiliVideoInfo('BV1xx', '三姐', { cookie: '', request: async () => onlyStat, warn })).resolves.toBeUndefined()
    await expect(fetchBilibiliVideoInfo('BV1xx', '三姐', { cookie: '', request: async () => onlyOwner, warn })).resolves.toBeUndefined()
  })
})
