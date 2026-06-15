import { baseHeaders, Networks } from '../../utils/index.js'
import amagi from '@ikenxuan/amagi'
import fetch from 'node-fetch'

/**
 * @typedef {Object.<string, any>} BilibiliId
 * @property {BilibiliDataTypes[keyof BilibiliDataTypes]} type - B站数据类型
 * @property {string} [Episode] - 集数（可选）
 */

/**
 * @typedef {object} BilibiliDataTypes
 * @property {'one_video'} one_video
 * @property {'nock_video'} nock_video
 * @property {'video_playurl'} video_playurl
 * @property {'work_comments'} work_comments
 * @property {'bangumi_video_info'} bangumi_video_info
 * @property {'bangumi_video_playurl'} bangumi_video_playurl
 * @property {'user_dynamic'} user_dynamic
 * @property {'dynamic_info'} dynamic_info
 * @property {'dynamic_card'} dynamic_card
 * @property {'user_profile'} user_profile
 * @property {'live_room_detail'} live_room_detail
 * @property {'liveroom_def'} liveroom_def
 * @property {'emoji_list'} emoji_list
 * @property {'new_login_qrcode'} new_login_qrcode
 * @property {'check_qrcode'} check_qrcode
 * @property {'login_basic_info'} login_basic_info
 * @property {'undefined'} undefined
 */

/**
 * return aweme_id
 * @param {string} url 分享连接
 * @param {boolean} [log=true] 是否记录日志
 * @returns {Promise<BilibiliId>}
 */
export const getBilibiliID = async (url, log = true) => {
  /** @type {BilibiliId} */
  let result = { type: "undefined" }
  let longLink = ""

  try {
    // 利用正则精准提取真实的 HTTP/HTTPS 链接，过滤掉 "链接: " 等多余干扰字符
    const urlMatch = url.match(/(https?:\/\/[^\s]+)/)
    if (urlMatch) {
      longLink = urlMatch[1]
    } else {
      if (log) logger.warn(`[B站链接] 未找到有效的网址: ${url}`)
      return result
    }

    // 🚨 核心修复 1：短链判断开关，含有 BV/av 号或常规域名的，直接跳过重定向！
    const isShortLink = longLink.includes('b23.tv') || longLink.includes('bili2233.cn') || longLink.includes('m.bilibili.com/dynamic');

    if (isShortLink) {
      try {
        // 🚨 核心修复 2：伪装 UA 为苹果手机浏览器，完美绕过 412 盾
        const customHeaders = {
          ...baseHeaders,
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
        }

        let tempLink = await new Networks({
          url: longLink,
          headers: customHeaders
        }).getLongLink()

        if (!tempLink || tempLink === longLink) {
          const response = await fetch(longLink, { redirect: 'follow', headers: customHeaders, timeout: 5000 }).catch(() => null)
          if (response && response.url && response.url !== longLink) {
            tempLink = response.url
          }
        }
        
        if (tempLink) longLink = tempLink
      } catch (error) {
        logger.warn(`[B站短链解析] 重定向超时或被拦截，尝试强行提取：${error.message}`)
      }
    }

    /**
     * 统一的URL模式匹配表 [类型名称, 匹配函数, 提取函数]
     * @typedef {[string, (url: string) => boolean, (url: string) => BilibiliId | Promise<BilibiliId>]} UrlPattern
     * @type {UrlPattern[]}
     */
    const urlPatterns = [
      // 视频链接
      [
        "video",
        (url) => /(?:video[\/-]|bilibili\.com\/)(BV[A-Za-z0-9]+|av\d+)/i.test(url) || /bvid=(BV[A-Za-z0-9]+)/i.test(url),
        async (url) => {
          const match1 = /(?:video[\/-]|bilibili\.com\/)(BV[A-Za-z0-9]+|av\d+)/i.exec(url);
          const match2 = /bvid=(BV[A-Za-z0-9]+)/i.exec(url);
          let bvid = match1 ? match1[1] : (match2 ? match2[1] : undefined);
          
          let pValue = undefined;
          try {
            const pParam = new URL(url).searchParams.get("p");
            if (pParam) pValue = parseInt(pParam, 10);
          } catch(e) {}
          
          if (bvid && bvid.toLowerCase().startsWith("av")) {
            const avid = parseInt(bvid.replace(/^av/i, ""));
            try {
              const convertResult = await amagi.bilibiliFetcher.convertAvToBv({ avid, typeMode: "strict" });
              bvid = convertResult.data.data.bvid;
            } catch (e) {
              logger.error("[B站解析] AV转BV失败", e);
            }
          }
          return {
            type: "one_video",
            bvid,
            ...(pValue !== undefined && { p: pValue })
          };
        }
      ],
      // 活动视频链接
      [
        'festival',
        (url) => /festival\/([A-Za-z0-9]+)/.test(url),
        (url) => {
          const festivalMatch = /festival\/([A-Za-z0-9]+)\?bvid=([A-Za-z0-9]+)/.exec(url)
          return {
            type: 'one_video',
            id: festivalMatch ? festivalMatch[2] : undefined
          }
        }
      ],
      // 番剧链接
      [
        'bangumi',
        (url) => /\/bangumi\/play\/(\w+)/.test(url) || /play\/(\S+?)\??/.test(url),
        (url) => {
          const isBangumiPlayFormat = /\/bangumi\/play\/(\w+)/.test(url)
          let id = ''
          let realid = ''
          let isEpid = false

          const playMatch = /(?:\/bangumi)?\/play\/(\w+)/.exec(url)
          id = playMatch?.[1] ?? ''

          if (id) {
            if (id.startsWith('ss')) {
              realid = isBangumiPlayFormat ? id : 'season_id'
            } else if (id.startsWith('ep')) {
              realid = isBangumiPlayFormat ? id : 'ep_id'
              isEpid = true
            }
          }

          return {
            type: 'bangumi_video_info',
            isEpid,
            realid
          }
        }
      ],
      // 动态链接
      [
        'dynamic',
        (url) => {
          try {
            const parsedUrl = new URL(url)
            const { hostname, pathname } = parsedUrl
            return (
              /^https:\/\/(?:t|www)\.bilibili\.com\/(?:opus\/)?(\d+)/.test(url) ||
              (hostname === 't.bilibili.com' && /^\/\d+/.test(pathname)) ||
              (hostname === 'www.bilibili.com' && /^\/opus\/\d+/.test(pathname))
            )
          } catch(e) { return false }
        },
        (url) => {
          try {
            const parsedUrl = new URL(url)
            const { hostname, pathname } = parsedUrl
            const match = /^https:\/\/(?:t|www)\.bilibili\.com\/(?:opus\/)?(\d+)/.exec(url) ||
              (hostname === 't.bilibili.com' && pathname.match(/^\/(\d+)/)) ||
              (hostname === 'www.bilibili.com' && pathname.match(/^\/opus\/(\d+)/))

            return {
              type: 'dynamic_info',
              dynamic_id: match ? match[1] : undefined
            }
          } catch(e) { return { type: 'undefined' } }
        }
      ],
      // 直播间链接
      [
        'live',
        (url) => url.includes('live.bilibili.com'),
        (url) => {
          const match = /https?:\/\/live\.bilibili\.com\/(\d+)/.exec(url)
          return {
            type: 'live_room_detail',
            room_id: match ? match[1] : undefined
          }
        }
      ]
    ]

    // 统一的链接处理逻辑
    for (const [name, test, extract] of urlPatterns) {
      if (test(longLink)) {
        const extractResult = extract(longLink)
        result = extractResult instanceof Promise ? await extractResult : extractResult
        if (log) logger.info(`[B站链接] 类型: ${name}`, result)
        break
      }
    }
  } catch (error) {
    logger.error(`[B站链接] 解析失败:`, error)
  }
  
  if (result.type === 'undefined' && log) {
    logger.warn('[B站链接] 无法识别的链接:', longLink)
  }
  
  return result
}