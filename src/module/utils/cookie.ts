/** 将配置中的 Cookie 值归一成下游请求库可安全处理的字符串。 */
export const normalizeCookieValue = (value: unknown): string => {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}
