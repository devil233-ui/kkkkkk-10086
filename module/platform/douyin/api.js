import { DouyinMethodToFetcher, douyinFetcher } from '@ikenxuan/amagi'
import Config from '../../utils/Config.js'

const buildRequestConfig = () => ({
  timeout: Config.request?.timeout || 15000,
  headers: {
    'User-Agent': Config.request?.['User-Agent']
  },
  proxy: Config.request?.proxy?.switch
    ? {
      host: Config.request.proxy.host,
      port: Number(Config.request.proxy.port),
      protocol: Config.request.proxy.protocol,
      auth: Config.request.proxy.auth
    }
    : false
})

const normalizeArgs = (arg1, arg2) => {
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
 * 兼容插件内旧版 getDouyinData 调用形式，并转发到 Amagi v6 fetcher。
 *
 * @param {string} method 旧版中文方法名
 * @param {string | Record<string, any>} [arg1] Cookie 或请求参数
 * @param {Record<string, any>} [arg2] arg1 为 Cookie 时的请求参数
 * @returns {Promise<any>}
 */
export const getDouyinData = async (method, arg1, arg2) => {
  const fetcherMethod = DouyinMethodToFetcher[method]
  if (!fetcherMethod || typeof douyinFetcher[fetcherMethod] !== 'function') {
    throw new Error(`Unsupported Douyin API method: ${method}`)
  }

  const { cookie, options } = normalizeArgs(arg1, arg2)
  return await douyinFetcher[fetcherMethod](options, cookie, buildRequestConfig())
}
