import { createRequire } from 'node:module'
import Config from '@/module/utils/Config'
import { BilibiliMethodToFetcher, bilibiliErrorCodeMap } from '@/module/platform/common/amagiMethodMap'
import { buildUserAgentHeader } from '@/module/platform/common/userAgent'
import { DEFAULT_REQUEST_TIMEOUT_MS, runWithRequestGuard } from '@/module/utils/RequestGuard'

/** 旧版 amagi v5 使用的中文方法名 */
export type BilibiliMethodName = keyof typeof BilibiliMethodToFetcher

/** amagi fetcher 方法，参数在 wrapper 边界收窄 */
type BilibiliFetcherMethod = (
  options: Record<string, unknown>,
  cookie: string,
  requestConfig: BilibiliRequestConfig
) => Promise<unknown>

/** 传给 fetcher 的请求配置 */
export interface BilibiliRequestConfig {
  timeout: number
  headers: Record<string, string>
  signal?: AbortSignal
  proxy: false | {
    host: string
    port: number
    protocol: string
    auth: unknown
  }
}

/** api wrapper 的可注入依赖，仅用于测试替换真实 amagi */
export interface BilibiliApiDependencies {
  /** amagi v6 的中文方法名解析函数 */
  getEnglishMethodName: (platform: string, method: string) => string | undefined
  /** 解析失败时回退使用的静态映射表 */
  methodMap: Record<string, string | undefined>
  fetcher: Record<string, BilibiliFetcherMethod | undefined>
}

interface AmagiBilibiliModule {
  bilibiliFetcher: Record<string, BilibiliFetcherMethod | undefined>
}

const require = createRequire(import.meta.url)
let defaultDependencies: BilibiliApiDependencies | undefined

/** amagi 的 package exports 在 Vite 下解析失败，沿用 Base.ts 的 CommonJS 兜底 */
const getDefaultDependencies = (): BilibiliApiDependencies => {
  if (!defaultDependencies) {
    // amagi 7.0 删除了 BilibiliMethodToFetcher 与 getEnglishMethodName：
    // 映射表改用内联副本；英文名解析用「表值直查 + fetcher 同名兜底」等价实现。
    const amagi = require('@ikenxuan/amagi') as AmagiBilibiliModule
    defaultDependencies = {
      getEnglishMethodName: (_platform, method) => BilibiliMethodToFetcher[method],
      methodMap: BilibiliMethodToFetcher,
      fetcher: amagi.bilibiliFetcher
    }
  }
  return defaultDependencies
}

const buildRequestConfig = (): BilibiliRequestConfig => ({
  timeout: Config.request?.timeout || 15000,
  // 只在配置的 UA 明确比 amagi 内置的更新时才覆盖；否则交回给 amagi。
  // 直接写 `'User-Agent': Config.request?.['User-Agent']` 有两个坑：这个 key 一旦存在就会
  // 覆盖 amagi 随版本更新的 UA，而 amagi 的 Sec-Ch-Ua 是从 UA 派生的，UA 落后会让整组
  // 客户端提示自相矛盾（B站 gaia 风控正看这个）；值为 undefined 时更糟，spread 之后
  // headers['User-Agent'] 是显式 undefined，axios 会发自己的 UA 或不带 UA。
  headers: {
    ...buildUserAgentHeader('bilibili'),
    // gaia 风控会校验跨站请求提示：少了这一组，space 域的接口直接回 -352。
    // 实测同一 cookie 补上这 5 个头（外加 buvid3）后，原本必失败的主页也能拿到数据。
    Origin: 'https://space.bilibili.com',
    Referer: 'https://space.bilibili.com/',
    'Sec-Fetch-Site': 'same-site',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty'
  },
  proxy: Config.request?.proxy?.switch
    ? { host: Config.request.proxy.host, port: Number(Config.request.proxy.port), protocol: Config.request.proxy.protocol, auth: Config.request.proxy.auth }
    : false
})

/**
 * B站 gaia 风控还会看 `buvid3` 指纹，而配置里那份 cookie 通常只有 SESSDATA / bili_jct
 * 这几个键。这里按需向 spi 接口取一枚并缓存，只拼在请求用的副本上，不改用户配置。
 */
let cachedBuvid3: { value: string, fetchedAt: number } | undefined
const BUVID3_TTL_MS = 6 * 60 * 60 * 1000

const resolveBuvid3 = async (): Promise<string> => {
  if (cachedBuvid3 && Date.now() - cachedBuvid3.fetchedAt < BUVID3_TTL_MS) return cachedBuvid3.value
  try {
    const response = await fetch('https://api.bilibili.com/x/frontend/finger/spi', {
      headers: { ...buildUserAgentHeader('bilibili') }
    })
    const payload = await response.json() as { data?: { b_3?: string } }
    const value = payload?.data?.b_3
    if (value) {
      cachedBuvid3 = { value, fetchedAt: Date.now() }
      return value
    }
  } catch (error) {
    logger.warn(`[Bilibili] 获取 buvid3 指纹失败: ${String(error)}`)
  }
  return ''
}

const withFingerprintCookie = async (cookie: string): Promise<string> => {
  if (cookie.includes('buvid3=')) return cookie
  const buvid3 = await resolveBuvid3()
  if (!buvid3) return cookie
  return cookie ? `${cookie}; buvid3=${buvid3}` : `buvid3=${buvid3}`
}

const normalizeArgs = (
  arg1?: string | Record<string, unknown>,
  arg2?: Record<string, unknown>
): { cookie: string, options: Record<string, unknown> } => {
  if (typeof arg1 === 'string') {
    return {
      cookie: arg1,
      options: arg2 || {}
    }
  }

  return {
    cookie: Config.cookies.bilibili || '',
    options: arg1 || {}
  }
}

/**
 * 兼容已移除的 amagi v5 `getBilibiliData` API。
 * 插件内部保留旧调用形态，内部改为分发到 v6 fetcher 方法。
 *
 * @param method 旧版 amagi 使用的中文方法名
 * @param arg1 Cookie 或请求参数
 * @param arg2 当 arg1 为 Cookie 时的请求参数
 * @param dependencies 可注入的方法解析、映射与 fetcher，缺省使用真实 amagi
 */
export const getBilibiliData = async (
  method: BilibiliMethodName | string,
  arg1?: string | Record<string, unknown>,
  arg2?: Record<string, unknown>,
  dependencies: BilibiliApiDependencies = getDefaultDependencies()
): Promise<unknown> => {
  const fetcherMethod = dependencies.getEnglishMethodName('bilibili', method) ??
    dependencies.methodMap[method] ??
    (typeof dependencies.fetcher[method] === 'function' ? method : undefined)
  const fetcher = fetcherMethod ? dependencies.fetcher[fetcherMethod] : undefined
  if (!fetcherMethod || typeof fetcher !== 'function') {
    throw new Error(`Unsupported Bilibili API method: ${method}`)
  }

  const { cookie, options } = normalizeArgs(arg1, arg2)
  // gaia 风控要求带 buvid3 指纹；只影响本次请求，用户的 cookie 配置保持不变
  const requestCookie = await withFingerprintCookie(cookie)
  const requestOnce = async (): Promise<unknown> => await runWithRequestGuard(
    async signal => await fetcher(options, requestCookie, {
      ...buildRequestConfig(),
      signal
    }),
    {
      timeoutMs: Math.min(Config.request?.amagiTimeout ?? DEFAULT_REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS),
      maxRetries: Config.request?.amagiMaxRetries
    }
  )
  let result = await requestOnce()
  // -352 是 B站 的风控（UA 或 wbi 参数不合法），实测多为瞬时：同一请求隔一会儿再打就过
  // （连发 6 个 mid 全 -352，拉开 2s 间隔后 4/6 成功）。推送一轮要连查好几个 UP主，
  // 撞上就整轮跳过太亏，所以这里做两次带退避的重试。
  for (const backoffMs of [1200, 3000]) {
    if (!(isPlainRecord(result) && result.success === false && String(result.message) === '-352')) break
    await new Promise(resolve => setTimeout(resolve, backoffMs))
    result = await requestOnce()
  }
  // amagi 7.0 成功响应是 {success:true,...} 且无 code 字段，补回 6.x 的 code:200 语义
  if (isPlainRecord(result) && result.code === undefined && result.success === true) {
    return { ...result, code: 200, message: typeof result.message === 'string' ? result.message : '获取成功' }
  }
  // amagi 7.0 失败响应是 {success:false, error, message:"-352"}：既没有 code 也没有 data。
  // 原样往上返，调用方会死在 `xxx.data.data` 上抛 TypeError，把真正的原因（风控/参数错误）盖掉。
  // 这里补回 6.x 的失败形态：code 归一成 B 站错误码数字，message 走错误码表。
  if (isPlainRecord(result) && result.success === false) {
    const parsed = Number.parseInt(String(result.message ?? ''), 10)
    const code = Number.isFinite(parsed) ? parsed : -1
    const mapped = bilibiliErrorCodeMap[String(code) as keyof typeof bilibiliErrorCodeMap]
    const errorField = result.error as { message?: string } | string | undefined
    const detail = typeof errorField === 'string'
      ? errorField
      : (errorField?.message ?? '')
    return {
      ...result,
      code,
      message: mapped ? `${mapped}（${code}）` : (detail || `B站接口返回失败（${code}）`)
    }
  }
  return result
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
