import type { Browser } from 'puppeteer'

import { importHost } from './import-host.js'

/**
 * 云崽 Puppeteer 渲染器的 browserInit 获取桥。
 *
 * 为什么不直接用 `e.runtime?.puppeteer?.browserInit`：TRSS-Yunzai 的
 * `lib/puppeteer/puppeteer.js` 兼容垫片导出的是「当前激活渲染器」，当
 * `renderer.yaml` 的 `name` 留空（自动选择）时它是 loader 本身——只有
 * `render`/`screenshot`，没有 `browserInit`。抖音扫码登录与小红书评论
 * 需要真实浏览器页面，因此这里绕开选择配置，直取
 * `renderers/puppeteer` 渲染器实例（与出图共享同一浏览器实例，不会多开）。
 *
 * 兜底顺序：runtime.puppeteer.browserInit（若宿主提供了）→ 直取渲染器实例。
 */

interface YunzaiRenderer {
  id?: string
  browserInit?: () => Promise<Browser>
}

interface YunzaiRendererLoader {
  getRenderer?: (name?: string) => YunzaiRenderer | unknown
}

interface YunzaiRuntimeLike {
  puppeteer?: {
    browserInit?: () => Promise<Browser>
  }
}

let rendererBrowserInit: (() => Promise<Browser>) | undefined

/** 直取 renderers/puppeteer 渲染器实例的 browserInit（懒加载 + 缓存） */
const loadRendererBrowserInit = async (): Promise<(() => Promise<Browser>) | undefined> => {
  if (rendererBrowserInit) return rendererBrowserInit
  try {
    const host = await importHost<{ default?: YunzaiRendererLoader, getRenderer?: YunzaiRendererLoader['getRenderer'] }>(
      'lib', 'renderer', 'loader.js'
    )
    const loader = (typeof host?.getRenderer === 'function' ? host : host?.default) as YunzaiRendererLoader | undefined
    const renderer = loader?.getRenderer?.('puppeteer') as YunzaiRenderer | undefined
    if (renderer && typeof renderer.browserInit === 'function') {
      rendererBrowserInit = renderer.browserInit.bind(renderer)
    }
  } catch (error) {
    logger.warn(`[渲染器桥] 直取 puppeteer 渲染器失败: ${error instanceof Error ? error.message : String(error)}`)
  }
  return rendererBrowserInit
}

/**
 * 取得云崽共享浏览器的 browserInit。
 *
 * @param runtime 消息事件上的 runtime 对象（可能没有 puppeteer 字段）
 */
export const resolveHostBrowserInit = async (
  runtime?: YunzaiRuntimeLike
): Promise<(() => Promise<Browser>) | undefined> => {
  const fromRuntime = runtime?.puppeteer?.browserInit
  if (typeof fromRuntime === 'function') return fromRuntime
  return await loadRendererBrowserInit()
}
