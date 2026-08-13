import YamlReader from './YamlReader.js'
import Version from './Version.js'
import cfg from '../../../../lib/config/config.js'
import chokidar from 'chokidar'
import fs from 'node:fs'
import YAML from 'yaml'
import _ from 'lodash'

const APP_UPLOAD_KEYS = [
  'videoSendMode',
  'sendbase64',
  'usefilelimit',
  'filelimit',
  'compress',
  'compresstrigger',
  'compressvalue',
  'usegroupfile',
  'groupfilevalue',
  'imageSendMode',
  'downloadMultiThread',
  'downloadConcurrency',
  'downloadThrottle',
  'downloadMaxSpeed',
  'downloadAutoReduce',
  'downloadMinSpeed'
]

/**
 * @typedef {Object} CookiesConfig
 * @property {string} [CookiesConfig.bilibili] B站平台Cookie信息
 * @property {string} [CookiesConfig.douyin] 抖音平台Cookie信息
 * @property {string} [CookiesConfig.kuaishou] 快手平台Cookie信息
 * @property {string} [CookiesConfig.xiaohongshu] 小红书平台Cookie信息
 */

/**
 * @typedef {Object} AppConfig
 * @property {boolean} [AppConfig.videotool] 视频解析工具总开关，修改后重启生效
 * @property {boolean} [AppConfig.defaulttool] 默认解析，即识别最高优先级，修改后重启生效
 * @property {boolean} [AppConfig.removeCache] 缓存删除，非必要不修改！
 * @property {number} [AppConfig.priority] 自定义优先级，「默认解析」关闭后才会生效。修改后重启生效
 * @property {boolean} [AppConfig.sendforwardmsg] 发送合并转发消息，可能多用于抖音解析
 * @property {number} [AppConfig.Theme] 评论图、推送图是否使用深色主题 0为根据时间自动切换 1为浅色 2为深色
 * @property {number} [AppConfig.renderScale] 渲染精度，可选值50~200，建议100。设置高精度会提高图片的精细度，过高可能会影响渲染与发送速度
 * @property {boolean} [AppConfig.APIServer] 放出API服务（本地部署一个抖音、B站的api服务）
 * @property {number} [AppConfig.APIServerPort] API服务端口
 * @property {boolean} [AppConfig.RemoveWatermark] 渲染图片是否移除底部版本信息
 * @property {boolean} [AppConfig.EmojiReply] 表情回应开关
 * @property {string[]} [AppConfig.errorLogSendTo] 错误日志接收者
 * @property {'google'|'xiaomi'|'oppo'|'huawei_honor'} [AppConfig.livePhotoSystem] Live Photo兼容系统
 * @property {'video_and_livephoto'|'video_only'|'livephoto_only'} [AppConfig.livePhotoMode] Live Photo发送方式
 */

/**
 * @typedef {Object} DouyinPushConfig
 * @property {boolean} [switch] 推送开关
 * @property {string} [permission] 谁可以设置推送
 * @property {string} [cron] 推送定时任务的cron表达式
 * @property {boolean} [parsedynamic] 推送时是否一同解析该作品
 * @property {boolean} [log] 是否打印日志
 * @property {'web'|'download'} [shareType] 分享链接二维码的类型
 */

/**
 * @typedef {Object} DouyinConfig
 * @property {boolean} [DouyinConfig.douyintool] 抖音解析开关
 * @property {('提示信息'|'评论图'|'视频'|'背景音乐'|'图集')[]} [DouyinConfig.douyinTip] 抖音解析可选列表 - 可选值：提示信息、评论图、视频、背景音乐、图集
 * @property {number} [DouyinConfig.numcomments] 抖音评论数量
 * @property {boolean} [DouyinConfig.realCommentCount] 评论图是否显示真实评论数量
 * @property {boolean} [DouyinConfig.sendHDrecord] 图集BGM是否使用高清语音发送
 * @property {boolean} [DouyinConfig.autoResolution] 根据「视频拦截阈值」自动选择合适的分辨率
 * @property {'text'|'image'} [DouyinConfig.videoInfoMode] 作品信息返回形式
 * @property {('cover'|'title'|'author'|'stats')[]} [DouyinConfig.displayContent] 作品信息展示内容
 * @property {DouyinPushConfig} [DouyinConfig.push] 抖音推送相关配置
 */

/**
 * @typedef {Object} BilibiliPushConfig
 * @property {boolean} [switch] 推送开关
 * @property {string} [permission] 谁可以设置推送
 * @property {string} [cron] 推送定时任务的cron表达式
 * @property {boolean} [parsedynamic] 推送时是否一同解析该动态
 * @property {boolean} [log] 是否打印日志
 * @property {number} [pushVideoQuality] 推送时视频画质偏好设置
 * @property {number} [pushMaxAutoVideoSize] 推送时视频体积上限
 */

/**
 * @typedef {Object} BilibiliConfig
 * @property {boolean} [BilibiliConfig.bilibilitool] B站解析开关
 * @property {('提示信息'|'简介'|'评论图'|'视频'|'动态')[]} [BilibiliConfig.bilibiliTip] B站解析可选列表 - 可选值：提示信息、简介、评论图、视频、动态
 * @property {number} [BilibiliConfig.bilibilinumcomments] B站评论数量
 * @property {boolean} [BilibiliConfig.realCommentCount] 评论图是否显示真实评论数量
 * @property {boolean} [BilibiliConfig.videopriority] 解析视频是否优先保内容
 * @property {number} [BilibiliConfig.videoQuality] 视频画质偏好设置
 * @property {number} [BilibiliConfig.maxAutoVideoSize] 自动画质模式下可接受的最大视频大小
 * @property {'text'|'image'} [BilibiliConfig.videoInfoMode] 视频信息返回形式
 * @property {string[]} [BilibiliConfig.displayContent] 视频解析时简介显示的内容
 * @property {boolean} [BilibiliConfig.showDanmakuInVideoInfo] 视频信息图片是否展示高频弹幕
 * @property {BilibiliPushConfig} [BilibiliConfig.push] B站推送相关配置
 */

/**
 * @typedef {Object} douyinPushItem
 * @property {boolean} switch - 是否启用
 * @property {string} sec_uid - sec_uid，与short_id二选一
 * @property {string} short_id - 抖音号，与sec_uid二选一
 * @property {string[]} group_id - 推送群号和机器人账号，多个则使用逗号隔开，必填。如：群号1:机器人账号1
 * @property {string} remark - 博主或UP主的名字信息，可不填
 * @property {('post'|'live')[]} [pushTypes] - 推送类型：作品、直播
 * @property {'blacklist'|'whitelist'} [filterMode='blacklist'] - 黑名单：命中不推送；白名单：命中才推送
 * @property {string[]} [Keywords] - 指定关键词
 * @property {string[]} [Tags] - 指定标签
 */

/**
 * 定义推送列表项的接口
 * @typedef {Object} bilibiliPushItem
 * @property {boolean} switch - 是否启用
 * @property {number} host_mid - B站用户的UID，必填
 * @property {string[]} group_id - 推送群号和机器人账号，多个则使用逗号隔开，必填。如：群号1:机器人账号1
 * @property {string} [remark] - 博主或UP主的名字信息，可不填
 * @property {('video'|'draw'|'word'|'live'|'forward'|'article')[]} [pushTypes] - 推送类型：视频、图文、纯文、直播、转发、专栏
 * @property {boolean|('视频'|'图文'|'video'|'draw')[]} [parsedynamic] - 是否在推送卡片后继续发送作品内容，未配置时继承全局设置
 * @property {'blacklist'|'whitelist'} [filterMode='blacklist'] - 黑名单：命中不推送；白名单：命中才推送
 * @property {string[]} [Keywords] - 指定关键词
 * @property {string[]} [Tags] - 指定标签
 */

/**
 * @typedef {Object} PushlistConfig
 * @property {douyinPushItem[]} [PushlistConfig.douyin] - 抖音推送配置列表
 * @property {bilibiliPushItem[]} [PushlistConfig.bilibili] - B站推送配置列表
 */

/**
 * @typedef {Object} KuaishouConfig
 * @property {boolean} [KuaishouConfig.switch] 快手解析开关
 * @property {boolean} [KuaishouConfig.comment] 快手评论解析开关
 * @property {boolean} [KuaishouConfig.kuaishoutip] 快手解析提示开关
 * @property {number} [KuaishouConfig.numcomment] 快手评论数量
 */

/**
 * @typedef {Object} XiaohongshuConfig
 * @property {boolean} [XiaohongshuConfig.switch] 小红书解析开关
 * @property {('info'|'image'|'video'|'comment')[]} [XiaohongshuConfig.sendContent] 小红书解析发送内容
 * @property {number} [XiaohongshuConfig.numcomment] 小红书评论数量
 * @property {'540p'|'720p'|'1080p'|'2k'|'4k'|'adapt'} [XiaohongshuConfig.videoQuality] 视频画质偏好
 * @property {number} [XiaohongshuConfig.maxAutoVideoSize] 自动画质最大大小
 */

/**
 * @typedef {Object} ProxyAuth
 * @property {string} username 用户名
 * @property {string} password 密码
 */

/**
 * @typedef {Object} ProxyConfig
 * @property {boolean} switch 是否启用代理
 * @property {string} host 代理服务器主机地址
 * @property {string} port 代理服务器端口
 * @property {string} protocol 代理协议类型(http/https)
 * @property {ProxyAuth} auth 代理服务器认证信息
 */

/**
 * @typedef {Object} RequestConfig
 * @property {number} timeout 请求超时时间，单位：毫秒
 * @property {string} User-Agent 用户代理
 * @property {ProxyConfig} proxy 代理配置
 */

/**
 * @typedef {Object} AmagiConfig
 * @property {number} timeout 请求超时时间，单位：毫秒
 * @property {string} User-Agent 用户代理
 * @property {ProxyConfig} proxy 代理配置
 * @property {CookiesConfig} cookies 平台 Cookie 配置
 * @property {boolean} APIServer API 服务开关
 * @property {number} APIServerPort API 服务端口
 */

/**
 * @typedef {Object} UploadConfig
 * @property {boolean} [UploadConfig.sendbase64] 发送视频经本插件转换为base64格式后再发送，适合Karin与机器人不在同一网络环境下开启
 * @property {boolean} [UploadConfig.usefilelimit] 视频上传拦截，开启后会根据解析的视频文件大小判断是否需要上传
 * @property {number} [UploadConfig.filelimit] 视频拦截阈值（填数字），视频文件大于该数值则不会上传 单位: MB，「视频文件上传限制」开启后才会生效
 * @property {boolean} [UploadConfig.compress] 压缩视频，开启后会将视频文件压缩后再上传，适合上传大文件
 * @property {number} [UploadConfig.compresstrigger] 触发视频压缩的阈值，单位：MB。当文件大小超过该值时，才会压缩视频，「压缩视频」开启后才会生效
 * @property {number} [UploadConfig.compressvalue] 压缩后的值，若视频文件大小大于「触发视频压缩的阈值」的值，则会进行压缩至该值（±5%），「压缩视频」开启后才会生效
 * @property {boolean} [UploadConfig.usegroupfile] 使用文件上传，开启后会将视频文件上传到群文件中，私聊也行
 * @property {number} [UploadConfig.groupfilevalue] 群文件上传阈值，当文件大小超过该值时将使用群文件上传，单位：MB，「使用群文件上传」开启后才会生效
 * @property {boolean} [UploadConfig.downloadMultiThread] 多线程下载开关，仅对支持 Range 的大文件生效
 * @property {number} [UploadConfig.downloadConcurrency] 多线程下载并发数，运行时限制为 2-8
 */

/**
 * @typedef {Object} ConfigType
 * @property {AppConfig} app - 插件应用设置
 * @property {BilibiliConfig} bilibili - bilibili 相关设置
 * @property {DouyinConfig} douyin - 抖音相关设置
 * @property {CookiesConfig} cookies - CK 相关设置
 * @property {PushlistConfig} pushlist - 推送列表
 * @property {UploadConfig} upload - 上传相关设置
 * @property {KuaishouConfig} kuaishou - 快手相关设置
 * @property {XiaohongshuConfig} xiaohongshu - 小红书相关设置
 * @property {RequestConfig} request - 解析库请求配置设置
 * @property {AmagiConfig} amagi - API 服务使用的解析库聚合配置
 * @property {any} [key] - 添加字符串索引签名
 */

class Cfg {
    /** @type {Record<string, any>} 配置缓存对象 */
    config = {}

    /** @type {Record<string, any>} 文件监听器对象 */
    watcher = { config: {}, defSet: {} }
    /** @type {Record<string, NodeJS.Timeout>} 配置重载防抖计时器 */
    reloadTimers = {}
    /** 推送列表配置异常的最近主人通知时间 */
    pushlistWarningAt = 0
    /** 推送数据库风险预警的最近主人通知时间 */
    pushlistDatabaseWarningAt = 0
    /** 最近一次数据库风险预警的摘要，避免同一事件重复通知 */
    pushlistDatabaseWarningKey = ''

    constructor() {
        this.config = {}
        this.watcher = { config: {}, defSet: {} }
        this.reloadTimers = {}
    }

    /**
     * 初始化配置系统
     * - 创建配置目录（如果不存在）
     * - 从默认配置目录复制配置文件
     * - 合并用户配置和默认配置
     * - 设置文件监听
     * @returns {*} 当前实例
     */
    initCfg() {
        // 用户配置目录路径
        const path = `${Version.pluginPath}/config/config/`
        // 创建配置目录（如果不存在）
        if (!fs.existsSync(path)) fs.mkdirSync(path, { recursive: true })
        // 默认配置目录路径
        const pathDef = `${Version.pluginPath}/config/default_config/`
        // 获取所有yaml配置文件
        const files = fs.readdirSync(pathDef).filter(file => file.endsWith('.yaml'))

        // 处理每个配置文件
        for (const file of files) {
            const configFile = `${path}${file}`
            const defaultFile = `${pathDef}${file}`
            // 如果用户配置不存在，复制默认配置
            if (!fs.existsSync(configFile)) {
                fs.copyFileSync(defaultFile, configFile)
            } else {
                // 解析用户配置和默认配置
                const config = this.readYamlFile(configFile).value
                const defConfig = this.readYamlFile(defaultFile).value
                // 合并配置并检查差异
                /** @type {{differences: boolean, result: Record<string, any>}} */
                const { differences, result } = this.mergeObjectsWithPriority(config, defConfig)
                // 如果有差异，使用完整内容原子替换，避免监听器读到半写入文件
                if (differences) this.writeMergedConfig(defaultFile, configFile, result)
            }
            // 监听配置文件变化
            this.watch(configFile, file.replace('.yaml', ''), 'config')
        }
        return this
    }

    /**
     * 获取应用相关配置
     * @returns {AppConfig} 应用配置对象，包含应用运行相关设置
     * 
     * @example
     * // 获取应用配置
     * const appConfig = Config.app
     * console.log(appConfig.videotool)      // 访问视频解析工具总开关
     * console.log(appConfig.defaulttool)    // 访问默认解析开关
     * console.log(appConfig.removeCache)    // 访问缓存删除设置
     * console.log(appConfig.priority)       // 访问优先级设置
     * console.log(appConfig.sendforwardmsg) // 访问合并转发消息设置
     * console.log(appConfig.Theme)          // 访问主题设置
     * console.log(appConfig.renderScale)    // 访问渲染精度设置
     * console.log(appConfig.APIServer)      // 访问API服务开关
     * console.log(appConfig.APIServerPort)  // 访问API服务端口
     */
    get app() {
        return this.getDefOrConfig('app')
    }

    /**
     * 获取Cookie相关配置
     * @returns {CookiesConfig} Cookie配置对象，包含各平台Cookie信息
     * 
     * @example
     * // 获取Cookie配置
     * const cookieConfig = Config.cookies
     * console.log(cookieConfig.douyin)   // 访问抖音Cookie
     * console.log(cookieConfig.bilibili) // 访问B站Cookie
     * console.log(cookieConfig.kuaishou) // 访问快手Cookie
     */
    get cookies() {
        return this.getDefOrConfig('cookies')
    }

    /**
     * 获取抖音相关配置
     * @returns {DouyinConfig} 抖音配置对象，包含抖音功能相关设置
     * 
     * @example
     * // 获取抖音配置
     * const douyinConfig = Config.douyin
     * console.log(douyinConfig.douyintool)     // 访问抖音解析开关
     * console.log(douyinConfig.douyinTip)      // 访问抖音解析可选列表
     * console.log(douyinConfig.numcomments)    // 访问评论数量设置
     * console.log(douyinConfig.commentsimg)    // 访问评论图设置
     * console.log(douyinConfig.detailMusic)    // 访问背景音乐设置
     * console.log(douyinConfig.sendHDrecord)   // 访问高清语音设置
     * console.log(douyinConfig.push)           // 访问推送配置
     */
    get douyin() {
        return this.getDefOrConfig('douyin')
    }

    /**
     * 获取B站相关配置
     * @returns {BilibiliConfig} B站配置对象，包含B站功能相关设置
     * 
     * @example
     * // 获取B站配置
     * const bilibiliConfig = Config.bilibili
     * console.log(bilibiliConfig.bilibilitool)        // 访问B站解析开关
     * console.log(bilibiliConfig.bilibiliTip)         // 访问B站解析可选列表
     * console.log(bilibiliConfig.bilibilinumcomments) // 访问评论数量设置
     * console.log(bilibiliConfig.senddynamicvideo)    // 访问动态视频设置
     * console.log(bilibiliConfig.videopriority)       // 访问视频优先级设置
     * console.log(bilibiliConfig.videoQuality)        // 访问视频画质设置
     * console.log(bilibiliConfig.maxAutoVideoSize)    // 访问最大视频大小设置
     * console.log(bilibiliConfig.displayContent)      // 访问显示内容设置
     * console.log(bilibiliConfig.push)                // 访问推送配置
     */
    get bilibili() {
        return this.getDefOrConfig('bilibili')
    }

    /**
     * 获取推送列表配置
     * @returns {PushlistConfig} 推送列表配置对象，包含各平台推送设置
     * 
     * @example
     * // 获取推送列表配置
     * const pushConfig = Config.pushlist
     * console.log(pushConfig.douyin) // 访问抖音推送设置
     */
    get pushlist() {
        return this.getDefOrConfig('pushlist')
    }

    /**
     * 获取快手相关配置
     * @returns {KuaishouConfig} 快手配置对象，包含快手功能相关设置
     * 
     * @example
     * // 获取快手配置
     * const kuaishouConfig = Config.kuaishou
     * console.log(kuaishouConfig.comments)     // 访问评论设置
     * console.log(kuaishouConfig.videoQuality) // 访问视频清晰度设置
     */
    get kuaishou() {
        return this.getDefOrConfig('kuaishou')
    }

    /**
     * 获取小红书相关配置
     * @returns {XiaohongshuConfig} 小红书配置对象
     */
    get xiaohongshu() {
        return this.getDefOrConfig('xiaohongshu')
    }

    /**
     * 获取请求相关配置
     * @returns {RequestConfig} 请求配置对象，包含超时、代理等设置
     * 
     * @example
     * // 获取请求配置
     * const requestConfig = Config.request
     * console.log(requestConfig.timeout)    // 访问超时设置
     * console.log(requestConfig['User-Agent']) // 访问用户代理
     * console.log(requestConfig.proxy)      // 访问代理设置
     */
    get request() {
        return this.getDefOrConfig('request')
    }

    /**
     * 获取 API 服务使用的聚合配置
     * @returns {AmagiConfig}
     */
    get amagi() {
        const request = this.request || {}
        const app = this.app || {}
        return {
            timeout: request.timeout,
            'User-Agent': request['User-Agent'],
            proxy: request.proxy,
            cookies: this.cookies || {},
            APIServer: app.APIServer,
            APIServerPort: app.APIServerPort
        }
    }

    /**
     * 获取上传相关配置
     * @returns {UploadConfig} 上传配置对象，包含视频上传、压缩等设置
     * 
     * @example
     * // 获取上传配置
     * const uploadConfig = Config.upload
     * console.log(uploadConfig.sendbase64)     // 访问base64发送设置
     * console.log(uploadConfig.compress)       // 访问视频压缩设置
     * console.log(uploadConfig.usegroupfile)   // 访问群文件上传设置
     */
    get upload() {
        return this.getDefOrConfig('upload')
    }

    /**
     * 获取完整配置（包含数据库配置）
     * @returns {Promise<any>} 完整配置对象
     */
    async All() {
        const config = /** @type {ConfigType} */({})
        const configPath = `${Version.pluginPath}/config/default_config/`
        const files = fs.readdirSync(configPath).filter(file => file.endsWith('.yaml'))

        for (const file of files) {
            const name = /** @type {keyof ConfigType} */(file.replace('.yaml', ''))
            config[name] = this.getDefOrConfig(name)
            if (config.pushlist) {
                const { getDouyinDB, getBilibiliDB } = await import('../db/index.js')
                const douyinDB = await getDouyinDB()
                const bilibiliDB = await getBilibiliDB()
                try {
                    if (config.pushlist.douyin) {
                        for (const item of config.pushlist.douyin) {
                            const filterWords = await douyinDB?.getFilterWords(item.sec_uid)
                            const filterTags = await douyinDB?.getFilterTags(item.sec_uid)
                            const userInfo = await douyinDB?.getDouyinUser(item.sec_uid)
                            if (userInfo) item.filterMode = userInfo.filterMode || 'blacklist'
                            item.Keywords = filterWords
                            item.Tags = filterTags
                        }
                    }
                    if (config.pushlist.bilibili) {
                        for (const item of config.pushlist.bilibili) {
                            const filterWords = await bilibiliDB?.getFilterWords(item.host_mid)
                            const filterTags = await bilibiliDB?.getFilterTags(item.host_mid)
                            const userInfo = await bilibiliDB?.getOrCreateBilibiliUser(item.host_mid)
                            if (userInfo) {
                                item.filterMode = userInfo.filterMode || 'blacklist'
                                // 🚨 从数据库拉取专属特权并反序列化赋值给配置
                                if (userInfo.parsedynamic) {
                                    try { item.parsedynamic = JSON.parse(userInfo.parsedynamic) } catch (e) { }
                                }
                            }
                            item.Keywords = filterWords
                            item.Tags = filterTags
                        }
                    }
                } catch (error) {
                    logger.error(`从数据库获取过滤配置时出错: ${error}`)
                }
            }
        }
        return config
    }

    /**
     * 获取合并后的配置（默认配置 + 用户配置）
     * 用户配置会覆盖默认配置中的相同项
     * @param {keyof ConfigType} name - 配置文件名称（不包含.yaml扩展名）
     * @returns {any} 合并后的配置对象
     */
    getDefOrConfig(name) {
        // 获取默认配置
        const def = this.getdefSet(name)
        // 获取用户配置
        const config = this.getConfig(name)
        // 合并配置，用户配置优先级更高
        return { ...def, ...config }
    }

    /**
     * 获取默认配置
     * @param {string} name - 配置文件名称（不包含.yaml扩展名）
     * @returns {any} 默认配置对象
     * 
     * @example
     * // 获取默认的cookies配置
     * const defaultCookies = Config.getdefSet('cookies')
     */
    getdefSet(name) {
        return this.getYaml('default_config', name)
    }

    /**
     * 获取用户配置
     * @param {string} name - 配置文件名称（不包含.yaml扩展名）
     * @returns {any} 用户配置对象
     * 
     * @example
     * // 获取用户配置的douyin设置
     * const userDouyinConfig = Config.getConfig('douyin')
     */
    getConfig(name) {
        return this.getYaml('config', name)
    }

    /**
     * 获取配置yaml文件内容
     * @param {string} type - 配置类型，'default_config'表示默认配置，'config'表示用户配置
     * @param {string} name - 配置文件名称（不包含.yaml扩展名）
     * @returns {any} 返回解析后的配置对象
     * 
     * @example
     * // 获取默认配置
     * const defaultConfig = Config.getYaml('default_config', 'app')
     * 
     * @example
     * // 获取用户配置
     * const userConfig = Config.getYaml('config', 'cookies')
     */
    getYaml(type, name) {
        // 构建配置文件完整路径
        const file = `${Version.pluginPath}/config/${type}/${name}.yaml`
        // 构建缓存键名
        const key = `${type}.${name}`

        // 如果配置已缓存，直接返回
        if (Object.hasOwn(this.config, key)) return this.config[key]

        const parsed = this.readYamlFile(file)
        // 空文件、缺失文件或解析异常不能进入缓存，避免短暂写入状态导致永久空配置。
        if (parsed.valid) this.config[key] = parsed.value

        // 监听配置文件变化
        this.watch(file, name, type)

        // 返回配置对象
        return parsed.value
    }

    /**
     * 读取YAML配置文件。不可用内容返回空对象，但不标记为有效配置。
     * @param {string} file 配置文件路径
     * @returns {{valid: boolean, value: Record<string, any>, reason?: string}}
     */
    readYamlFile(file) {
        try {
            if (!fs.existsSync(file)) return { valid: false, value: {}, reason: '文件不存在' }

            const value = YAML.parse(fs.readFileSync(file, 'utf8'))
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
                return { valid: false, value: {}, reason: '内容为空或格式不是对象' }
            }
            return { valid: true, value }
        } catch (error) {
            logger.warn(`[Config] 解析配置文件失败: ${file}`)
            return { valid: false, value: {}, reason: 'YAML解析失败' }
        }
    }

    /**
     * 基于默认配置生成完整内容后原子替换用户配置，避免监听器读到半写入文件。
     * @param {string} defaultFile 默认配置路径
     * @param {string} configFile 用户配置路径
     * @param {Record<string, any>} config 合并后的配置
     */
    writeMergedConfig(defaultFile, configFile, config) {
        const document = YAML.parseDocument(fs.readFileSync(defaultFile, 'utf8'))
        for (const key in config) document.set(key, config[key])

        const tempFile = `${configFile}.${process.pid}.${Date.now()}.tmp`
        try {
            fs.writeFileSync(tempFile, document.toString({ lineWidth: -1, simpleKeys: true }), 'utf8')
            fs.renameSync(tempFile, configFile)
        } catch (error) {
            if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile)
            throw error
        }
    }

    /**
     * 监听配置文件变化
     * @param {string} file - 要监听的文件完整路径
     * @param {string} name - 配置文件名称（不带扩展名）
     * @param {string} [type='default_config'] - 配置类型，默认为默认配置
     * @returns {void}
     */
    watch(file, name, type = 'default_config') {
        const key = `${type}.${name}`
        // 如果已经在监听，则直接返回
        if (this.watcher[key]) return

        const watcher = chokidar.watch(file, {
            ignoreInitial: true,
            awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 50 }
        })
        const scheduleReload = () => {
            clearTimeout(this.reloadTimers[key])
            this.reloadTimers[key] = setTimeout(() => {
                this.reloadConfig(file, name, type, key).catch(error => {
                    logger.error(`[Config] 重载配置文件失败: ${file}`, error)
                })
            }, 300)
        }

        watcher.on('add', scheduleReload)
        watcher.on('change', scheduleReload)
        watcher.on('unlink', scheduleReload)

        // 保存监听器实例
        this.watcher[key] = watcher
    }

    /**
     * 在文件稳定后刷新配置。若新文件不可用，继续保留上一份有效缓存。
     * @param {string} file 配置文件路径
     * @param {string} name 配置名称
     * @param {string} type 配置类型
     * @param {string} key 缓存键
     */
    async reloadConfig(file, name, type, key) {
        const parsed = this.readYamlFile(file)
        if (!parsed.valid) {
            logger.warn(`[Config] 配置文件暂不可用(${parsed.reason}): ${file}，继续使用上一份有效配置`)
            if (name === 'pushlist' && type === 'config') await this.notifyPushlistConfigIssue()
            return
        }

        this.config[key] = parsed.value
        logger.mark(`[${Version.pluginName}][修改配置文件][${type}][${name}]`)
        if (name !== 'pushlist' || type !== 'config') return

        try {
            await this.syncPushlistToDatabase()
        } catch (error) {
            logger.error('[Config] 文件监听同步数据库失败:', error)
            return
        }

        try {
            await this.syncConfigToDatabase()
        } catch (error) {
            logger.error('[Config] 文件监听同步订阅失败:', error)
        }
    }

    /**
     * 向机器人主人发送插件告警。
     * @param {string} message 告警内容
     * @param {'pushlistWarningAt'|'pushlistDatabaseWarningAt'} stateKey 限流状态字段
     * @param {number} cooldown 限流时间，单位毫秒
     * @param {string} [dedupeKey] 同一类告警的去重键
     * @returns {Promise<'sent'|'duplicate'|'unavailable'>} 通知结果
     */
    async notifyMasters(message, stateKey, cooldown, dedupeKey = '') {
        const stateKeyAt = this[stateKey] || 0
        const stateKeyName = stateKey === 'pushlistDatabaseWarningAt' ? 'pushlistDatabaseWarningKey' : ''
        if (Date.now() - stateKeyAt < cooldown && (!dedupeKey || this[stateKeyName] === dedupeKey)) return 'duplicate'

        const bot = globalThis.Bot
        const recipients = []
        const deliveredMasterIds = new Set()
        const masterByBot = cfg.master && typeof cfg.master === 'object' ? cfg.master : {}
        for (const [botId, users] of Object.entries(masterByBot)) {
            const masterList = Array.isArray(users) ? users : [users]
            for (const master of masterList.filter(Boolean)) {
                const target = bot?.[botId]?.pickFriend?.(master)
                if (target?.sendMsg) {
                    deliveredMasterIds.add(String(master))
                    recipients.push({ target, master, botId })
                }
            }
        }

        // 某些旧配置只保留 masterQQ，使用云崽聚合 Bot 补找尚未按 Bot 分组的主人。
        let masters = cfg.masterQQ || []
        if (!Array.isArray(masters)) masters = [masters]
        for (const master of masters.filter(Boolean)) {
            if (deliveredMasterIds.has(String(master))) continue
            const target = bot?.pickFriend?.(master, true)
            if (target?.sendMsg) {
                deliveredMasterIds.add(String(master))
                recipients.push({ target, master, botId: target.self_id || 'auto' })
            }
        }

        if (recipients.length === 0) {
            logger.warn('[Config] 无法向主人发送推送配置异常通知：主人或机器人不存在')
            return 'unavailable'
        }

        const sends = []
        for (const { target, master, botId } of recipients) {
            try {
                sends.push(Promise.resolve().then(() => target.sendMsg(message)).then(() => true).catch(error => {
                    logger.warn(`[Config] 推送配置异常主人通知发送失败：${botId} -> ${master}：${error}`)
                    return false
                }))
            } catch (error) {
                logger.warn(`[Config] 推送配置异常主人通知发送失败：${botId} -> ${master}：${error}`)
            }
        }
        const results = await Promise.all(sends)
        if (!results.some(Boolean)) return 'unavailable'

        this[stateKey] = Date.now()
        if (dedupeKey) this[stateKeyName] = dedupeKey
        return 'sent'
    }

    /**
     * 向机器人主人通知推送列表配置异常，避免配置暂不可用时悄然停推。
     */
    async notifyPushlistConfigIssue() {
        const message = '⚠️kkkkkk-10086推送配置异常\npushlist.yaml重载时为空、缺失或格式错误。为避免漏推送，当前进程继续使用上一份有效配置；请检查配置文件。'
        await this.notifyMasters(message, 'pushlistWarningAt', 60 * 60 * 1000)
    }

    /**
     * 通知主人推送数据库即将或已经发生高风险变更。
     * @param {Object} details 变更摘要
     * @param {string} [details.platform='未知平台'] 平台名称
     * @param {string} [details.reason='配置或缓存同步'] 变更原因
     * @param {number} [details.removedSubscriptions=0] 将删除的订阅关系数量
     * @param {number} [details.removedCaches=0] 将删除的去重缓存数量
     * @param {number} [details.removedUsers=0] 将删除的平台用户记录数量
     * @param {number} [details.invalidItems=0] 配置异常项数量
     * @param {string} [details.phase='before'] 预警阶段
     * @param {string} [details.error=''] 错误摘要
     * @param {string} [details.note=''] 补充说明
     */
    async notifyPushlistDatabaseWarning({
        platform = '未知平台',
        reason = '配置或缓存同步',
        removedSubscriptions = 0,
        removedCaches = 0,
        removedUsers = 0,
        invalidItems = 0,
        phase = 'before',
        error = '',
        note = ''
    } = {}) {
        const safeError = String(error || '').replace(/[\r\n]+/g, ' ').slice(0, 180)
        const key = [platform, reason, removedSubscriptions, removedCaches, removedUsers, invalidItems, phase, safeError].join('|')
        if (key === this.pushlistDatabaseWarningKey && Date.now() - this.pushlistDatabaseWarningAt < 10 * 60 * 1000) return true

        const action = phase === 'before' ? '检测到即将发生' : '已发生'
        const lines = [
            '⚠️kkkkkk-10086推送数据库预警',
            `平台：${platform}`,
            `动作：${action}${reason}`
        ]
        if (removedSubscriptions > 0) lines.push(`订阅关系：${removedSubscriptions} 条`)
        if (removedCaches > 0) lines.push(`去重缓存：${removedCaches} 条`)
        if (removedUsers > 0) lines.push(`用户记录：${removedUsers} 条`)
        if (invalidItems > 0) lines.push(`异常配置项：${invalidItems} 条`)
        if (safeError) lines.push(`错误：${safeError}`)
        if (note) lines.push(`说明：${note}`)
        lines.push('相关历史记录可能再次进入推送列表，请检查 pushlist.yaml、锅巴保存内容和重启时机。')

        const result = await this.notifyMasters(lines.join('\n'), 'pushlistDatabaseWarningAt', 10 * 60 * 1000, key)
        return result === 'sent' || result === 'duplicate'
    }

    /**
     * 修改配置文件中的指定项
     * @param {keyof ConfigType} name - 配置文件名
     * @param {string} key - 要修改的配置项键名
     * @param {*} value - 要设置的新值
     * @param {'config' | 'default_config'} [type='config'] - 配置类型，默认为用户配置
     * @returns {void}
     * 
     * @example
     * // 修改应用配置中的优先级
     * Config.modify('app', 'priority', 1)
     * 
     * @example
     * // 修改抖音配置中的评论设置
     * Config.modify('douyin', 'comments', true)
     * 
     * @example
     * // 修改默认配置中的Cookie
     * Config.modify('cookies', 'douyin', 'your-cookie', 'default_config')
     * 
     */
    modify(name, key, value, type = 'config') {
        // 构建配置文件完整路径
        const path = `${Version.pluginPath}/config/${type}/${name}.yaml`
        // 使用YamlReader修改配置
        new YamlReader(path).set(key, value)
        // 清除对应的配置缓存
        delete this.config[`${type}.${name}`]
    }

    /**
     * 批量修改指定配置模块，供锅巴配置页保存整组数据。
     * @param {keyof ConfigType} name 配置文件名
     * @param {Record<string, any>} value 配置对象
     * @param {'config' | 'default_config'} [type='config'] 配置类型
     * @returns {boolean} 是否写入成功
     */
    ModifyPro(name, value, type = 'config') {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false
        if (name === 'amagi') {
            if ('timeout' in value) this.modify('request', 'timeout', value.timeout, type)
            if ('User-Agent' in value) this.modify('request', 'User-Agent', value['User-Agent'], type)
            if ('proxy' in value) this.modify('request', 'proxy', value.proxy, type)
            if (value.cookies && typeof value.cookies === 'object') this.ModifyPro('cookies', value.cookies, type)
            if ('APIServer' in value) this.modify('app', 'APIServer', value.APIServer, type)
            if ('APIServerPort' in value) this.modify('app', 'APIServerPort', value.APIServerPort, type)
            return true
        }

        const writeModuleConfig = (moduleName, moduleValue) => {
            const modulePath = `${Version.pluginPath}/config/${type}/${moduleName}.yaml`
            if (!fs.existsSync(modulePath)) return false
            const reader = new YamlReader(modulePath)
            for (const [key, item] of Object.entries(moduleValue)) reader.document.set(key, item)
            const success = reader.write()
            if (success) delete this.config[`${type}.${moduleName}`]
            return success
        }

        if (name === 'app') {
            const appValue = {}
            const uploadValue = {}
            for (const [key, item] of Object.entries(value)) {
                if (APP_UPLOAD_KEYS.includes(key)) uploadValue[key] = item
                else appValue[key] = item
            }
            if ('videoSendMode' in uploadValue) uploadValue.sendbase64 = uploadValue.videoSendMode === 'base64'
            const appSuccess = Object.keys(appValue).length ? writeModuleConfig('app', appValue) : true
            const uploadSuccess = Object.keys(uploadValue).length ? writeModuleConfig('upload', uploadValue) : true
            return appSuccess && uploadSuccess
        }

        return writeModuleConfig(name, value)
    }

    /**
     * 保存锅巴面板中的单个配置模块，并在同一次写入中移除已废弃字段。
     * @param {keyof ConfigType} name 配置文件名
     * @param {Record<string, any>} value 经过白名单过滤的配置对象
     * @param {string[]} deprecatedKeys 需要删除的历史字段路径
     * @returns {boolean} 是否写入成功
     */
    saveGuobaConfig(name, value, deprecatedKeys = []) {
        try {
            if (!value || typeof value !== 'object' || Array.isArray(value)) return false
            const modulePath = `${Version.pluginPath}/config/config/${name}.yaml`
            if (!fs.existsSync(modulePath)) return false

            const reader = new YamlReader(modulePath)
            for (const key of deprecatedKeys) {
                if (key.includes('.')) reader.document.deleteIn(key.split('.'))
                else reader.document.delete(key)
            }
            for (const [key, item] of Object.entries(value)) reader.document.set(key, item)

            const success = reader.write()
            if (success) delete this.config[`config.${name}`]
            return success
        } catch (error) {
            logger.error(`[Config] 锅巴配置模块 ${name} 保存失败:`, error)
            return false
        }
    }

    /**
     * 同步pushlist配置到数据库
     * @returns {Promise<void>}
     */
    async syncPushlistToDatabase() {
        const { getDouyinDB, getBilibiliDB } = await import('../db/index.js')
        try {
            /** @type {PushlistConfig} */
            const pushlistConfig = this.getDefOrConfig('pushlist')
            if (pushlistConfig.douyin) await this.syncFilterConfigToDb(pushlistConfig.douyin, await getDouyinDB(), 'sec_uid')
            if (pushlistConfig.bilibili) await this.syncFilterConfigToDb(pushlistConfig.bilibili, await getBilibiliDB(), 'host_mid')
            logger.info('[Config] pushlist的过滤配置已同步到数据库')
            return true
        } catch (error) {
            logger.error('[Config] 同步pushlist配置到数据库失败:', error)
            throw error
        }
    }

    /**
     * 同步推送配置到数据库（通用方法）
     * @param {any[]} items - 推送配置列表
     * @param {any} db - 数据库实例
     * @param {string} idField - ID字段名称
     * @returns {Promise<void>}
     */
    async syncFilterConfigToDb(items, db, idField) {
        for (const item of items) {
            if (!item.switch) continue
            const id = item[idField]
            if (!id) continue

            // 更新解析选项
            if (item.parsedynamic !== undefined && db?.updateParseDynamic) await db.updateParseDynamic(id, JSON.stringify(item.parsedynamic))
            // 更新过滤模式
            if (item.filterMode !== undefined) await db?.updateFilterMode(id, item.filterMode)
            // 更新过滤词
            const configWords = item.Keywords || []
            const existingWords = await db?.getFilterWords(id)
            // 删除不再需要的过滤词
            for (const word of existingWords || []) {
                if (!configWords.includes(word)) await db?.removeFilterWord(id, word)
            }
            // 添加新的过滤词
            for (const word of configWords) {
                if (!existingWords?.includes(word)) await db?.addFilterWord(id, word)
            }
            // 更新过滤标签
            const configTags = item.Tags || []
            const existingTags = await db?.getFilterTags(id)
            // 删除不再需要的过滤标签
            for (const tag of existingTags || []) {
                if (!configTags.includes(tag)) await db?.removeFilterTag(id, tag)
            }
            // 添加新的过滤标签
            for (const tag of configTags) {
                if (!existingTags?.includes(tag)) await db?.addFilterTag(id, tag)
            }
        }
    }

    /**
     * 合并两个对象并保留优先级
     * @param {Object} objA 第一个对象（具有较高优先级）
     * @param {Object} objB 第二个对象（具有较低优先级）
     * @returns {{differences: boolean, result: Object}} 返回合并结果和差异状态
     */
    mergeObjectsWithPriority(objA, objB) {
        let differences = false

        /**
         * 自定义合并函数
         * @param {Object} objValue - 目标对象的值
         * @param {Object} srcValue - 源对象的值
         * @returns {Object} 合并后的值
         */
        const customizer = (objValue, srcValue) => {
            if (_.isArray(objValue) && _.isArray(srcValue)) {
                return objValue
            } else if (_.isPlainObject(objValue) && _.isPlainObject(srcValue)) {
                if (!_.isEqual(objValue, srcValue)) {
                    return _.mergeWith(_.cloneDeep(objValue), srcValue, customizer)
                }
            } else if (!_.isEqual(objValue, srcValue)) {
                differences = true
                return objValue !== undefined ? objValue : srcValue
            }
            return objValue !== undefined ? objValue : srcValue
        }

        let result = _.mergeWith(_.cloneDeep(objA), objB, customizer)

        return {
            differences,
            result
        }
    }

    /**
     * 同步配置到数据库
     * 这个方法应该在所有模块都初始化完成后调用
     */
    async syncConfigToDatabase() {
        let success = true
        try {
            /** @type {PushlistConfig} */
            const pushCfg = this.getDefOrConfig('pushlist')
            const { getDouyinDB, getBilibiliDB } = await import('../db/index.js')
            const douyinDB = await getDouyinDB()
            const bilibiliDB = await getBilibiliDB()
            // 同步配置到数据库
            if (pushCfg.bilibili) {
                const synced = await bilibiliDB?.syncConfigSubscriptions(pushCfg.bilibili)
                if (synced === false) success = false
            }
            if (pushCfg.douyin) {
                const synced = await douyinDB?.syncConfigSubscriptions(pushCfg.douyin)
                if (synced === false) success = false
            }
            logger.debug('[BilibiliDB] + [DouyinDB] 配置已同步到数据库')
        } catch (error) {
            logger.error('同步配置到数据库失败:', error)
            return false
        }
        return success
    }

}

/**
 * @typedef {ConfigType & Pick<Cfg, 'All' | 'modify' | 'ModifyPro' | 'syncConfigToDatabase' | 'initCfg'>} Config$
 */

/**
 * 配置实例缓存
 * @type {Config$}
 */
let configInstance

/**
 * 获取配置实例（延迟初始化）
 * @returns {Config$} 配置实例
 */
const getConfigInstance = () => {
    if (!configInstance) {
        configInstance = new Proxy(new Cfg().initCfg(), {
            /**
             * @param {string} prop - 属性名
             * @returns 
             */
            get(target, prop) {
                if (prop in target) return target[/** @type {keyof Cfg} */(prop)]
                return target.getDefOrConfig(/** @type {keyof ConfigType} */(prop))
            }
        })
    }
    return configInstance
}

/**
 * 配置对象代理
 * @type {Config$}
 */
export default new Proxy(/** @type {Config$} */({}), {
    /**
     * 获取配置属性值
     * @param {string} prop - 属性名
     * @returns {*} 属性值
     */
    get(target, prop) {
        return getConfigInstance()[/** @type {keyof Config$} */(prop)]
    }
})
