/** 小红书官方站点与分享短链域名。 */
export const XIAOHONGSHU_LINK_PATTERN = /(xiaohongshu\.com|xhslink\.(?:com|cn))/i

/** 判断文本是否包含小红书链接。 */
export const isXiaohongshuLink = (value: string): boolean => XIAOHONGSHU_LINK_PATTERN.test(value)

/** 构造可安全放入二维码的笔记分享链接。 */
export const buildXiaohongshuShareUrl = (noteId: string, xsecToken?: string): string => {
  const url = new URL(`https://www.xiaohongshu.com/discovery/item/${encodeURIComponent(noteId)}`)
  url.searchParams.set('source', 'webshare')
  url.searchParams.set('xhsshare', 'pc_web')
  if (xsecToken) url.searchParams.set('xsec_token', xsecToken)
  url.searchParams.set('xsec_source', 'pc_share')
  return url.toString()
}
