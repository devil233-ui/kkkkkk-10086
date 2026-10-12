import { createRequire } from 'node:module'
import Config from '@/module/utils/Config'
import { DouyinMethodToFetcher } from '@/module/platform/common/amagiMethodMap'
import { buildUserAgentHeader } from '@/module/platform/common/userAgent'
import { DEFAULT_REQUEST_TIMEOUT_MS, runWithRequestGuard } from '@/module/utils/RequestGuard'
import {
  attachDouyinApiDiagnostic,
  formatDouyinApiDiagnostic,
  type DouyinApiDiagnostic
} from './apiDiagnostics.js'

/** 旧版 amagi v5 使用的中文方法名 */
export type DouyinMethodName = keyof typeof DouyinMethodToFetcher

/** amagi fetcher 方法，参数在 wrapper 边界收窄 */
type DouyinFetcherMethod = (
  options: Record<string, unknown>,
  cookie: string,
  requestConfig: DouyinRequestConfig
) => Promise<unknown>

/** 传给 fetcher 的请求配置 */
export interface DouyinRequestConfig {
  timeout: number
  headers: { 'User-Agent'?: string }
  signal?: AbortSignal
  proxy: false | {
    host: string
    port: number
    protocol: string
    auth: unknown
  }
}

/** api wrapper 的可注入依赖，仅用于测试替换真实 amagi */
export interface DouyinApiDependencies {
  methodMap: Record<string, string | undefined>
  fetcher: Record<string, DouyinFetcherMethod | undefined>
  events?: AmagiEvents
}

interface AmagiEvents {
  on: (event: 'api:error', listener: (data: unknown) => void) => unknown
}

interface AmagiDouyinModule {
  douyinFetcher: Record<string, DouyinFetcherMethod | undefined>
  amagiEvents?: AmagiEvents
}

const require = createRequire(import.meta.url)
let defaultDependencies: DouyinApiDependencies | undefined

/** amagi 的 package exports 在 Vite 下解析失败，沿用 Base.ts 的 CommonJS 兜底 */
const getDefaultDependencies = (): DouyinApiDependencies => {
  if (!defaultDependencies) {
    // amagi 7.0 删除了 DouyinMethodToFetcher 导出：映射表改用内联副本（common/amagiMethodMap）
    const amagi = require('@ikenxuan/amagi') as AmagiDouyinModule
    defaultDependencies = {
      methodMap: DouyinMethodToFetcher,
      fetcher: amagi.douyinFetcher,
      events: amagi.amagiEvents
    }
  }
  return defaultDependencies
}

const recentApiErrors: Array<{ receivedAt: number, diagnostic: DouyinApiDiagnostic }> = []
let subscribedEvents: AmagiEvents | undefined

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/**
 * 把 amagi 7.0 的响应包归一化成 6.x 形态。
 *
 * 7.0 成功时返回 `{ success: true, data, ... }` 且**没有 `code` 字段**（实测
 * `code === undefined`），而插件全链路按 `code === 200` 判成功；失败时 7.0 仍带
 * `{ success: false, error: {...} }`。这里在 wrapper 边界统一补回 6.x 语义：
 * `success === true` ⇒ `code: 200`，其余原样透传，下游零改动。
 */
const normalizeLegacyResponse = (result: unknown): unknown => {
  if (!isRecord(result) || result.code !== undefined) return result
  if (result.success !== true) return result
  return { ...result, code: 200, message: typeof result.message === 'string' ? result.message : '获取成功' }
}

const toDiagnostic = (value: unknown): DouyinApiDiagnostic | undefined => {
  if (!isRecord(value) || value.platform !== 'douyin' || typeof value.methodType !== 'string') return undefined
  if (typeof value.errorMessage !== 'string') return undefined

  return {
    methodType: value.methodType,
    errorCode: typeof value.errorCode === 'string' || typeof value.errorCode === 'number' ? value.errorCode : undefined,
    errorMessage: value.errorMessage,
    duration: typeof value.duration === 'number' ? value.duration : undefined
  }
}

const ensureApiErrorListener = (events?: AmagiEvents): void => {
  if (!events || events === subscribedEvents) return

  events.on('api:error', value => {
    const diagnostic = toDiagnostic(value)
    if (!diagnostic) return
    recentApiErrors.push({ receivedAt: Date.now(), diagnostic })
    if (recentApiErrors.length > 32) recentApiErrors.splice(0, recentApiErrors.length - 32)
  })
  subscribedEvents = events
}

const normalizeMethod = (value: string): string => value.replace(/^fetch/i, '').toLowerCase()

const findRecentApiError = (
  startedAt: number,
  completedAt: number,
  fetcherMethod: string
): DouyinApiDiagnostic | undefined => {
  const expectedMethod = normalizeMethod(fetcherMethod)
  for (let index = recentApiErrors.length - 1; index >= 0; index--) {
    const item = recentApiErrors[index]
    if (!item || item.receivedAt < startedAt - 50 || item.receivedAt > completedAt + 50) continue
    if (normalizeMethod(item.diagnostic.methodType) === expectedMethod) return item.diagnostic
  }
  return undefined
}

interface RuntimeLogger {
  warn?: (message: string) => unknown
}

const getLogger = (): RuntimeLogger | undefined =>
  (globalThis as unknown as { logger?: RuntimeLogger }).logger

const buildRequestConfig = (): DouyinRequestConfig => ({
  timeout: Config.request?.timeout || 15000,
  // 只在配置的 UA 明确比 amagi 内置的更新时才覆盖；否则交回给 amagi。
  // 直接写 `'User-Agent': Config.request?.['User-Agent']` 有两个坑：这个 key 一旦存在就会
  // 覆盖 amagi 随版本更新的 UA，而 amagi 的 Sec-Ch-Ua 是从 UA 派生的，UA 落后会让整组
  // 客户端提示自相矛盾（B站 gaia 风控正看这个）；值为 undefined 时更糟，spread 之后
  // headers['User-Agent'] 是显式 undefined，axios 会发自己的 UA 或不带 UA。
  headers: {
    ...buildUserAgentHeader('douyin')
  },
  proxy: Config.request?.proxy?.switch
    ? { host: Config.request.proxy.host, port: Number(Config.request.proxy.port), protocol: Config.request.proxy.protocol, auth: Config.request.proxy.auth }
    : false
})

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
    cookie: Config.cookies.douyin || '',
    options: arg1 || {}
  }
}

/**
 * 兼容已移除的 amagi v5 `getDouyinData` API。
 * 插件内部保留旧调用形态，内部改为分发到 v6 fetcher 方法。
 *
 * @param method 旧版 amagi 使用的中文方法名
 * @param arg1 Cookie 或请求参数
 * @param arg2 当 arg1 为 Cookie 时的请求参数
 * @param dependencies 可注入的方法映射与 fetcher，缺省使用真实 amagi
 */
export const getDouyinData = async (
  method: DouyinMethodName | string,
  arg1?: string | Record<string, unknown>,
  arg2?: Record<string, unknown>,
  dependencies: DouyinApiDependencies = getDefaultDependencies()
): Promise<unknown> => {
  ensureApiErrorListener(dependencies.events)
  const fetcherMethod = dependencies.methodMap[method] ??
    (typeof dependencies.fetcher[method] === 'function' ? method : undefined)
  const fetcher = fetcherMethod ? dependencies.fetcher[fetcherMethod] : undefined
  if (!fetcherMethod || typeof fetcher !== 'function') {
    throw new Error(`Unsupported Douyin API method: ${method}`)
  }

  const { cookie, options } = normalizeArgs(arg1, arg2)
  const startedAt = Date.now()
  const requestFetcher = fetcher
  try {
    const result = await runWithRequestGuard(
      async signal => {
        const requestConfig: DouyinRequestConfig = {
          ...buildRequestConfig(),
          signal
        }
        return await requestFetcher(options, cookie, requestConfig)
      },
      {
        timeoutMs: Math.min(Config.request?.amagiTimeout ?? DEFAULT_REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS),
        maxRetries: Config.request?.amagiMaxRetries
      }
    )
    const completedAt = Date.now()
    const diagnostic = findRecentApiError(startedAt, completedAt, fetcherMethod)
    const normalized = normalizeLegacyResponse(result)
    const resultCode = isRecord(normalized) ? normalized.code : undefined
    if (resultCode !== 200) {
      getLogger()?.warn?.(formatDouyinApiDiagnostic(method, options, resultCode, diagnostic))
      return diagnostic ? attachDouyinApiDiagnostic(normalized, diagnostic) : normalized
    }
    return normalized
  } catch (error) {
    const completedAt = Date.now()
    const diagnostic = findRecentApiError(startedAt, completedAt, fetcherMethod)
    getLogger()?.warn?.(formatDouyinApiDiagnostic(method, options, undefined, diagnostic))
    throw error
  }
}
