import { describe, expect, it } from 'vitest'

import { isSendTimeoutError } from '@/module/utils/messageSend'
import { resolveBilibiliTimeoutAction } from '@/module/platform/bilibili/timeoutPolicy'

/**
 * B站推送里「熔断/按已送达处理」只应覆盖上传与发送环节；下载环节失败必须
 * 继续走 logger.error + 不写去重缓存 + 下一轮重试，不能被当成发送超时吞掉。
 *
 * push.ts 的 catch 分支结构是 `if (isSendTimeoutError(e)) { 三分支决策 }`,
 * 所以这里的关键断言是：下载类错误一律不满足 isSendTimeoutError。
 */

/** 下载/下载后处理环节可能抛出的真实错误形状 */
const downloadErrors: Array<[string, unknown]> = [
  ['分片下载超时（axios）', Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ETIMEDOUT' })],
  ['下载中途连接被重置', Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })],
  ['下载返回非 2xx', Object.assign(new Error('下载失败，状态码: 403'), { response: { status: 403 } })],
  ['分片校验器不一致', Object.assign(new Error('下载资源在分片期间发生变化'), { code: 'MULTIPART_RESOURCE_CHANGED' })],
  ['分片长度校验失败', Object.assign(new Error('分片长度校验失败: 123'), { code: 'MULTIPART_INVALID_LENGTH' })],
  ['取播放地址失败', new Error('取不到可用的视频下载地址')],
  ['视频音频合并失败', new Error('二合一（视频 + 音频）执行失败')],
  ['下载信息接口超时', Object.assign(new Error('请求超时'), { timeout: 60000 })]
]

/** 发送/上传环节可能抛出的真实错误形状 */
const sendErrors: Array<[string, unknown]> = [
  ['OneBot send_msg 回执超时', Object.assign(new Error('请求超时'), { request: { action: 'send_msg' }, timeout: 60000 })],
  ['B站卡片分页发送超时', Object.assign(new Error('B站动态卡片[1/3] sendMsg returned timeout'), { code: 'ETIMEDOUT' })],
  ['B站图集转发超时', new Error('B站图集 sendMsg timeout after 180000ms')],
  ['B站专栏转发超时', new Error('B站专栏内容 sendMsg timeout after 180000ms')],
  ['适配器 retcode 1200', Object.assign(new Error('超时'), { error: { retcode: 1200 } })]
]

describe('B站推送：下载失败与发送失败的判定边界', () => {
  it.each(downloadErrors)('下载类错误（%s）不算发送超时，因此会重试而不是熔断', (_label, error) => {
    expect(isSendTimeoutError(error)).toBe(false)
  })

  it.each(sendErrors)('发送类错误（%s）才算发送超时，进入三分支决策', (_label, error) => {
    expect(isSendTimeoutError(error)).toBe(true)
  })

  it('决策函数本身只区分连接状态与次数，不承担下载判定', () => {
    // 只有 isSendTimeoutError 为 true 的调用点才会问这三个结果
    expect(resolveBilibiliTimeoutAction(true, 1)).toBe('treat-as-delivered')
    expect(resolveBilibiliTimeoutAction(false, 1)).toBe('retry')
    expect(resolveBilibiliTimeoutAction(false, 2)).toBe('breaker')
  })
})
