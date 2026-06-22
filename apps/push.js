import { Bilibilipush } from '../module/platform/bilibili/index.js'
import { DouYinpush } from '../module/platform/douyin/index.js'
import { Config } from '../module/utils/index.js'

export class kkkPush extends plugin {
  constructor() {
    super({
      name: 'kkkkkk-10086-推送功能',
      dsc: '推送',
      event: 'message',
      priority: Config.app.defaulttool ? -Infinity : Config.app.priority,
      rule: [
        { reg: /^#设置抖音推送/, fnc: 'setdyPush', permission: Config.douyin.push.permission },
        { reg: /^#设置[bB]站推送(?:[Uu][Ii][Dd]:)?(\d+)$/, fnc: 'setbiliPush', permission: Config.bilibili.push.permission },
        { reg: /^#(抖音|[bB]站)(全部)?强制推送/, fnc: 'forcePush', permission: 'master' },
        { reg: /^#(抖音|[bB]站)推送列表$/, fnc: 'pushlist' },
        { reg: /^#kkk设置推送机器人/, fnc: 'changeBotID', permission: 'master' }
      ]
    })

    this.task = [
      ...(Config.bilibili.push.switch ? [{
        cron: Config.bilibili.push.cron,
        name: '哔哩哔哩更新推送',
        fnc: () => this.bilibiliPush(),
        log: Config.bilibili.push.log
      }] : []),
      ...(Config.douyin.push.switch ? [{
        cron: Config.douyin.push.cron,
        name: '抖音更新推送',
        fnc: () => this.douyinPush(),
        log: Config.douyin.push.log
      }] : [])
    ]
  }

  /**
   * 抖音推送方法
   * 这是一个异步方法，用于执行抖音推送操作
   * @returns {Promise<boolean>}
   */
  async douyinPush() {
    // 创建DouYinpush实例并执行action方法
    await new DouYinpush().action()
    return true
  }

  /**
   * 执行B站推送功能的方法
   * 这是一个异步方法，用于调用B站推送类的action方法
   * @returns {Promise<boolean>}
   */
  async bilibiliPush() {
    await new Bilibilipush().action()  // 创建B站推送实例并执行action方法
    return true
  }

  /**
   * 强制推送方法，根据消息内容判断并执行相应的推送操作
   * @param {Object} e - 包含消息信息的对象
   * @returns {Promise<boolean>} 返回一个Promise，解析为true表示操作成功
   */
  async forcePush(e) {
    if (e.msg.includes('抖音')) {
      await new DouYinpush().action()
      return true
    } else if (/[bB]站/.test(e.msg)) {
      await new Bilibilipush().action()
      return true
    }
    return true
  }

  /**
   * 设置抖音推送功能的方法
   * @param {Object} e - 事件对象，包含消息相关信息
   * @returns {Promise<boolean>}
   */
  async setdyPush(e) {
    if (e.isPrivate) return true
    
    const dy = new DouYinpush(e)
    let input = e.msg.replace(/^#设置抖音推送/, '').trim()
    let sec_uid = ""

    // 1. 智能匹配：主页链接提取
    const urlMatch = input.match(/user\/([A-Za-z0-9_-]+)/)
    if (urlMatch) {
      sec_uid = urlMatch[1]
    } 
    // 2. 智能匹配：纯长段 sec_uid 提取 (MS4w开头)
    else if (input.startsWith('MS4w')) {
      sec_uid = input
    } 
    // 3. 智能匹配：短号/昵称 走搜索接口
    else {
      const data = await dy.amagi.douyin.fetcher.searchContent({ 
        query: input, 
        type: "user", 
        typeMode: 'strict' 
      }).catch(err => {
        logger.error('获取抖音用户数据失败:', err)
        return null
      })

      if (!data || !data.data) {
        await e.reply('搜索抖音用户失败，请检查 Cookie 配置或稍后再试', { reply: true })
        return true
      }

      // 🚨 终极提取大法：无视结构变化，深度遍历查找返回体里的 sec_uid
      const findSecUid = (obj) => {
        if (!obj || typeof obj !== 'object') return null
        if (obj.sec_uid && typeof obj.sec_uid === 'string' && obj.sec_uid.startsWith('MS4w')) return obj.sec_uid
        for (let key in obj) {
          if (typeof obj[key] === 'object') {
            let res = findSecUid(obj[key])
            if (res) return res
          }
        }
        return null
      }

      sec_uid = findSecUid(data.data)
    }

    if (!sec_uid) {
      await e.reply('未能解析到该用户的 sec_uid，请尝试直接发送带有 user/ 的主页链接', { reply: true })
      return true
    }

    // 将提取出的 sec_uid 极简传入
    try {
      await dy.setting(sec_uid)
    } catch (error) {
      await e.reply(`设置失败: ${error.message || error}`)
    }
    return true
  }

  /**
   * 设置B站推送的异步方法
   * @param {Object} e - 包含消息信息的对象
   * @returns {Promise<boolean>}
   */
  async setbiliPush(e) {
    if (e.isPrivate) return true
    if (!Config.cookies.bilibili) {
      await e.reply('\n请先配置B站Cookie', { at: true })
      return true
    }
    
    const match = /^#设置[bB]站推送(?:[Uu][Ii][Dd]:)?(\d+)$/.exec(e.msg)
    if (match && match[1]) {
      // 实例化带 B站 Cookie 的推送对象
      const bili = new Bilibilipush(e)
      
      const data = await bili.amagi.bilibili.fetcher.fetchUserCard({ 
        host_mid: String(match[1]), 
        typeMode: 'strict' 
      }).catch(err => {
        logger.error('获取B站用户数据失败:', err)
        return null
      })

      if (!data || !data.data) {
        await e.reply('获取B站用户数据失败，请检查 UID 或 Cookie 配置', { reply: true })
        return true
      }

      await bili.setting(data.data)
    }
    return true
  }

  /**
   * 根据消息内容显示不同平台的推送列表
   * @param {Object} e - 消息事件对象
   * @returns {Promise<boolean>} 返回一个Promise，解析为true表示操作成功
   */
  async pushlist(e) {
    // 根据消息内容判断显示哪个平台的推送列表
    const platform = e.msg.includes('抖音') ? 'douyin' : 'bilibili'
    if (platform === 'douyin') {
      // 如果是抖音平台，则创建DouYinpush实例并渲染推送列表
      await new DouYinpush(e).renderPushList()
    } else {
      // 如果是哔哩哔哩平台，则创建Bilibilipush实例并渲染推送列表
      await new Bilibilipush(e).renderPushList()
    }
    return true
  }

  /**
   * 更改推送机器人ID的方法
   * @param {Object} e - 事件对象，包含消息等信息
   * @returns {Promise<boolean>} 返回一个Promise，解析为true表示操作成功
   */
  async changeBotID(e) {
    // 定义匹配命令的正则表达式，用于识别"#kkk设置推送机器人"开头的消息
    const command = /^#kkk设置推送机器人/
    // 从消息中提取新的机器人ID，移除命令部分
    const newBotId = e.msg.replace(command, '')

    // 更改推送列表机器人ID
    const updateGroupIds = (list) => {
      // 检查列表是否为空或未定义
      if (!list || !Array.isArray(list) || list.length === 0) {
        return []
      }

      return list.map(item => ({
        ...item,
        group_id: item.group_id ? item.group_id.map(groupId => {
          const [group_id] = groupId.split(':')
          return `${group_id}:${newBotId}`
        }) : []
      }))
    }

    // 更新配置，提供默认空数组
    Config.modify('pushlist', 'douyin', updateGroupIds(Config.pushlist.douyin || []))
    Config.modify('pushlist', 'bilibili', updateGroupIds(Config.pushlist.bilibili || []))

    await e.reply(`推送机器人已修改为${newBotId}`)
    return true
  }

}
