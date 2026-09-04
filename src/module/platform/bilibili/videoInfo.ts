/**
 * 「单个视频作品数据」取数策略。
 *
 * 独立成文件是为了让取数与校验逻辑可以脱离云崽运行时单测：这里不导入 Config、api 或 logger，
 * Cookie、请求方式和告警输出全部由调用方注入。
 */

/** amagi 取数失败时会把上游报文原样放进 `data.data`，里面只有 code / message，没有业务字段 */
interface BilibiliUpstreamFailure {
  code?: number | string
  message?: string
}

/** 取数所需的外部依赖，全部由调用方注入 */
export interface BilibiliVideoInfoDeps {
  /** 已配置的B站 Cookie，空串表示没配置 */
  cookie: string
  /** 按给定 Cookie 请求「单个视频作品数据」 */
  request: (cookie: string, bvid: string) => Promise<unknown>
  /** 单次尝试失败时的告警输出 */
  warn: (message: string) => void
}

/** 渲染视频卡片必需的两块业务字段都在，才算真的拿到了作品数据 */
const hasVideoInfoPayload = (response: unknown): boolean => {
  const payload = (response as { data?: { data?: { owner?: unknown, stat?: unknown } } })?.data?.data
  return Boolean(payload?.stat && payload.owner)
}

/** 把 amagi 失败响应里的上游错误码与文案整理成一句可读的告警 */
const describeFailure = (response: unknown): string => {
  const failure = (response as { data?: { data?: BilibiliUpstreamFailure } })?.data?.data
  return `code=${failure?.code ?? '未知'} message=${failure?.message ?? '未知'}`
}

/**
 * 取视频动态对应的作品数据，成功返回 amagi 原始响应，拿不到业务字段时返回 undefined。
 *
 * 这份数据原本只按匿名请求取，但 `/x/web-interface/view` 会对被风控的出口 IP 直接回
 * `-412 request was banned`：此时 amagi 把上游报文原样塞进 `data.data`，里面只有 `code`、
 * `message`、`ttl`，没有 `stat` 和 `owner`。调用方过去直接读 `.stat.like`，于是整轮推送抛
 * TypeError，同一批次里其他 UP 的动态也一起丢掉。
 *
 * 配了 Cookie 就先带 Cookie 请求（实测被风控的出口 IP 上只有带 Cookie 才拿得到数据），
 * 拿不到再退回匿名请求一次，避免 Cookie 失效反而卡住本来能成功的推送。请求本身抛错（超时、
 * 网络中断）同样按一次失败处理，不向上冒泡。
 */
export const fetchBilibiliVideoInfo = async (
  bvid: string,
  remark: string,
  { cookie, request, warn }: BilibiliVideoInfoDeps
): Promise<unknown> => {
  const attempts = cookie
    ? [{ cookie, label: '带 Cookie' }, { cookie: '', label: '匿名' }]
    : [{ cookie: '', label: '匿名' }]

  for (const attempt of attempts) {
    let reason: string
    try {
      const response = await request(attempt.cookie, bvid)
      if (hasVideoInfoPayload(response)) return response
      reason = describeFailure(response)
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error)
    }
    warn(`UP主：${remark} 的视频 ${bvid} 作品数据获取失败（${attempt.label}），${reason}`)
  }

  return undefined
}
