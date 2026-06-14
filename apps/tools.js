import { KuaiShou, GetKuaishouID, KuaishouData } from '../module/platform/kuaishou/index.js'
import { Bilibili, getBilibiliID } from '../module/platform/bilibili/index.js'
import { DouYin, getDouyinID } from '../module/platform/douyin/index.js'
import { Config, Common, UploadRecord } from '../module/utils/index.js'
import { getDouyinData } from '@ikenxuan/amagi'
import { QRCodeScanner } from '../module/utils/QRCodeScanner.js';

// 用户状态存储对象
const user = {}

const PLATFORM_CONFIG = [
  {
    reg: /.*((www|v|jx|jingxuan|m)\.(douyin|iesdouyin)\.com|douyin\.com\/(video|note)).*/,
    handler: 'douyin',
    enabled: Config.douyin?.douyintool
  },
  {
    reg: /(bilibili.com|b23.tv|t.bilibili.com|bili2233.cn|^BV[1-9a-zA-Z]{10}$|^av\d+$)/i,
    handler: 'bilibili',
    enabled: Config.bilibili?.bilibilitool
  },
  {
    reg: /^((.*)快手(.*)快手(.*)|(.*)v\.kuaishou(.*)|(.*)kuaishou\.com\/f\/[a-zA-Z0-9]+.*)$/,
    handler: 'kuaishou',
    enabled: Config.kuaishou?.kuaishoutool
  }
]

/**
 * 动态生成插件规则
 * @returns {Array} 返回启用的平台规则数组
 */
const generateRules = () => Config.app.videotool
  ? PLATFORM_CONFIG
    .filter(config => config.enabled)
    .map(({ reg, handler }) => ({ reg, fnc: handler }))
  : []

export class kkkTools extends plugin {
  constructor() {
    super({
      name: 'kkkkkk-10086-视频功能',
      dsc: '视频',
      event: 'message',
      priority: Config.app.defaulttool ? -Infinity : Config.app.priority,
      rule: [
        ...generateRules(), // 动态生成的平台规则
        { reg: /^#?(解析|kkk解析)/, fnc: 'prefix' }, // 解析功能规则
        { reg: /#?BGM(\d+)/, fnc: 'uploadRecord' }, // BGM上传功能规则
        { reg: /^#?第(\d{1,3})集$/, fnc: 'next' } // 选集功能规则
      ]
    })
  }

  /**
   * 统一处理不同平台的链接解析
   * @param {any} e 事件对象
   * @returns {Promise<boolean>} 处理结果
   */
  async prefix(e) {
    try {
      // ====== 1. 先尝试获取文本内容 ======
      e.msg = await Common.getReplyMessage(e) || e.msg;

      // ====== 2. 检查文本中是否已经包含有效链接 ======
      let matchedConfig = PLATFORM_CONFIG.find(config => config.reg.test(e.msg));
      
      if (matchedConfig) {
        logger.mark(`[引用解析] 消息中已包含有效链接，跳过二维码扫描`);
        await this[matchedConfig.handler](e);
        return true; // 直接结束，不浪费时间扫码
      }

      // ====== 3. 如果文本没链接，再去找图片扫码 ======
      let imageUrl = "";

      if (e.message && Array.isArray(e.message)) {
        for (const item of e.message) {
          if (item.type === "image" || item.type === "Image") {
            imageUrl = item.url || item.file || item.data?.url || item.data?.file;
            break;
          }
        }
      }

      if (!imageUrl && (e.source || e.hasReply || e.reply_id || (e.message && e.message.some(m => m.type === "reply")))) {
        let replyMsg = null;
        if (typeof e.getReply === "function") {
          try { replyMsg = await e.getReply(); } catch (err) {}
        }
        if (!replyMsg || !replyMsg.message) {
          let replyId = e.reply_id;
          if (!replyId && e.source) replyId = e.source.message_id || e.source.id || e.source.seq;
          if (!replyId && e.message) {
            const replySeg = e.message.find(m => m.type === "reply");
            if (replySeg) replyId = replySeg.id;
          }
          if (replyId && e.bot && typeof e.bot.getMsg === "function") {
            try { replyMsg = await e.bot.getMsg(replyId); } catch (err) {}
          }
        }
        if (!replyMsg) replyMsg = e.source;

        const extractFromReply = (msg) => {
          if (!msg) return "";
          if (typeof msg === "string") {
            const cqMatch = msg.match(/\[CQ:image,.*?url=([^,\]]+)/);
            return cqMatch ? cqMatch[1].replace(/&amp;/g, "&") : "";
          } 
          if (Array.isArray(msg)) {
            for (const item of msg) {
              if (item.type === "image" || item.type === "Image") {
                return item.url || item.file || item.data?.url || item.data?.file;
              }
              const nested = extractFromReply(item);
              if (nested) return nested;
            }
          } 
          if (typeof msg === "object") {
            if (msg.type === "image" || msg.type === "Image") {
              return msg.url || msg.file || msg.data?.url || msg.data?.file;
            }
            return extractFromReply(msg.message) || extractFromReply(msg.elements);
          }
          return "";
        };
        imageUrl = extractFromReply(replyMsg);
      }

      if (imageUrl) {
        if (!imageUrl.startsWith("http")) {
          logger.warn(`[引用解析] 提取到了图片名但没有直链，无法扫描: ${imageUrl}`);
        } else {
          logger.mark(`[引用解析] 成功提取到图片直链，开始扫描二维码...`);
          const qrContent = await QRCodeScanner.scanFromUrl(imageUrl);
          
          if (qrContent && QRCodeScanner.isSupportedPlatform(qrContent)) {
            logger.mark(`[引用解析] 二维码识别成功: ${qrContent}`);
            e.msg = qrContent;
            
            // 扫码成功后，重新匹配平台配置并执行
            matchedConfig = PLATFORM_CONFIG.find(config => config.reg.test(e.msg));
            if (matchedConfig) {
              await this[matchedConfig.handler](e);
              return true;
            }
          } else if (qrContent) {
            logger.warn(`[引用解析] 识别到二维码，但不支持该平台: ${qrContent}`);
          } else {
            logger.warn(`[引用解析] 未识别到二维码或图片被过度压缩`);
          }
        }
      }

      logger.debug("[kkk解析] 未匹配到支持的解析链接");
      
    } catch (error) {
      logger.error("kkk解析链接失败", error);
      return false;
    }
    return true;
  }

  /**
   * 处理抖音链接解析
   * @param {any} e 事件对象
   * @returns {Promise<boolean>} 处理结果
   */
  async douyin(e) {
    const urlMatch = e.msg.match(/https?:\/\/(?:www\.|v\.|jx\.|m\.|jingxuan\.)?(douyin\.com|iesdouyin\.com)\/[^\s]+/g)
    if (urlMatch && urlMatch[0]) {
      const iddata = await getDouyinID(urlMatch[0])
      await new DouYin(e, iddata).RESOURCES(iddata)
    }
    return true
  }

  /**
   * 处理B站链接解析
   * @param {any} e 事件对象
   * @returns {Promise<boolean>} 处理结果
   */
  async bilibili(e) {
    let url = (e.msg || (e.message?.[0]?.data || '')).replaceAll('\\', '').trim()

    // 处理不同类型的B站链接
    if (url.includes('b23.tv')) {
      url = url.match(/(http:|https:)\/\/b23.tv\/[A-Za-z\d._?%&+\-=\/#]*/)?.[0] || url
    } else if (/bilibili\.com|bili2233\.cn/.test(url)) {
      url = url.match(/(?:https?:\/\/)?(?:www\.bilibili\.com|m\.bilibili\.com|bili2233\.cn)\/[A-Za-z\d._?%&+\-=\/#]*/)?.[0] || url
    } else if (/^BV[1-9a-zA-Z]{10}$/i.test(url) || /^av\d+$/i.test(url)) {
      url = `https://www.bilibili.com/video/${url}`
    }

    if (!url) {
      logger.warn(`未能在消息中找到有效的B站分享链接、BV号或av号: ${url}`)
      return true
    }

    const iddata = await getBilibiliID(url)
    await new Bilibili(e, iddata).RESOURCES(iddata)

    // 记录用户操作状态，用于选集功能
    user[e.user_id] = 'bilib'
    setTimeout(() => delete user[e.user_id], 60000)
    return true
  }

  /**
   * 处理快手链接解析
   * @param {any} e 事件对象
   * @returns {Promise<boolean>} 处理结果
   */
  async kuaishou(e) {
    const url = e.msg.replaceAll('\\', '').match(/(https:\/\/v\.kuaishou\.com\/\w+|https:\/\/www\.kuaishou\.com\/f\/[a-zA-Z0-9]+)/g)
    const Iddata = await GetKuaishouID(url)
    const WorkData = await new KuaishouData(Iddata.type).GetData({ photoId: Iddata.id })
    await new KuaiShou(e, Iddata).Action(WorkData)
    return true
  }

  /**
   * 处理BGM音频上传功能
   * @param {any} e 事件对象
   * @returns {Promise<boolean>} 处理结果
   */
  async uploadRecord(e) {
    try {
      // 获取音乐ID并验证
      const musicIdMatch = e.msg.match(/BGM(\d+)/)
      if (!musicIdMatch) {
        await e.reply('未找到有效的音乐ID')
        return false
      }

      // 获取音乐数据
      const data = await getDouyinData('音乐数据', Config.cookies.douyin, {
        music_id: musicIdMatch[1],
        typeMode: 'strict'
      })

      // 验证音乐数据
      if (!data?.data?.music_info) {
        await e.reply('获取音乐数据失败，可能是音乐ID错误或网络问题')
        return false
      }

      // 提取音乐信息
      const { title, play_url } = data.data.music_info
      const music_url = play_url.uri
      const musicInfo = `《${title}》\n${music_url}`

      await e.reply(`正在上传: ${musicInfo}`)
      await e.reply(await UploadRecord(e, music_url, 0, Config.douyin.sendHDrecord ? false : true))
      return true
    } catch (error) {
      logger.error('上传音乐记录时发生错误:', error)
      await e.reply('处理音乐时发生错误，请稍后重试')
      return false
    }
  }

  /**
   * 处理B站番剧选集功能
   * @param {any} e 事件对象
   * @returns {Promise<boolean>} 处理结果
   */
  async next(e) {
    if (user[e.user_id] === 'bilib') {
      const episode = e.msg.match(/第(\d+)集/)[1]
      global.BILIBILIOBJECT.Episode = episode
      await new Bilibili(e, global.BILIBILIOBJECT).RESOURCES(global.BILIBILIOBJECT, true)
    }
    return true
  }
}
