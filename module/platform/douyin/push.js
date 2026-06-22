import { Base, baseHeaders, Networks, Render, Config, Common, downloadVideo, Version } from '../../utils/index.js'
import { cleanOldDynamicCache, douyinDB } from '../../db/index.js'
import { getDouyinID, douyinProcessVideos } from './index.js'
import common from '../../../../../lib/common/common.js'
// import { douyinFetcher } from "@ikenxuan/amagi"

/**
 * @typedef {import('@ikenxuan/amagi').ApiResponse} ApiResponse
 * @typedef {import('@ikenxuan/amagi').DySearchInfo} DySearchInfo
 * @typedef {import('@ikenxuan/amagi').DyUserInfo} DyUserInfo
 * @typedef {import('@ikenxuan/amagi').DyUserLiveVideos} DyUserLiveVideos
 */

/**
 * 下载文件选项
 * @typedef {import('../../utils/Base.js').downloadFileOptions} downloadFileOptions
 */

/**
 * 定义推送列表项的接口
 * @typedef {import('../../utils/Config.js').douyinPushItem} douyinPushItem
 */

/**
 * 作品详情信息
 * @typedef {Object.<string, any>} DetailData
 * @property {import('@ikenxuan/amagi').ApiResponse<import('@ikenxuan/amagi').DyUserInfo>} user_info - 博主主页信息
 * @property {{ liveStatus: 'open' | 'close', isChanged: boolean, isliving: boolean }} [liveStatus] - 直播状态信息
 * @property {import('@ikenxuan/amagi').ApiResponse<import('@ikenxuan/amagi').DyUserLiveVideos>} [live_data] - 直播数据
 */

/**
 * @typedef {Object} DouyinPushItem
 * @property {string} remark - 博主的昵称
 * @property {string} sec_uid - 博主UID
 * @property {number} create_time - 作品发布时间
 * @property {Array<{groupId: string, botId: string}>} targets - 要推送到的群组和机器人ID
 * @property {DetailData} Detail_Data - 作品详情信息
 * @property {string} avatar_img - 博主头像url
 * @property {boolean} living - 是否正在直播
 * @exports DouyinPushItem
 */

/** 
 * 推送列表的类型定义
 * @typedef {Record<string, DouyinPushItem>} WillBePushList 
 */

/**
 * 抖音基础请求头配置
 * @type {downloadFileOptions['headers']}
 */
const douyinBaseHeaders = {
    ...baseHeaders,
    Referer: 'https://www.douyin.com',
    Cookie: Config.cookies.douyin
}

export class DouYinpush extends Base {
    /**
     * 构造函数
     * @param {*} e - 事件对象
     * @param {boolean} [force=false] - 是否强制推送
     */
    constructor(e, force = false) {
        super(e)
        if (this.botadapter === 'QQBot') {
            e.reply('不支持QQBot，请使用其他适配器')
            return
        }
        this.force = force
    }


    /**
     * 执行主要的操作流程
     */
    async action() {
        try {
            await this.syncConfigToDatabase()

            // 清理旧的作品缓存记录
            const deletedCount = await cleanOldDynamicCache('douyin', 1)
            if (deletedCount > 0) {
                logger.info(`已清理 ${deletedCount} 条过期的抖音作品缓存记录`)
            }

            // 检查备注信息
            if (await this.checkremark()) return true

            const data = await this.getDynamicList(Config.pushlist.douyin || [])

            if (Object.keys(data).length === 0) return true

            if (this.force) return await this.forcepush(data)
            else return await this.getdata(data)
        } catch (error) {
            logger.error(error)
        }
    }

    /**
     * 同步配置文件中的订阅信息到数据库
     */
    async syncConfigToDatabase() {
        // 如果配置文件中没有抖音推送列表，直接返回
        if (!Config.pushlist.douyin || Config.pushlist.douyin.length === 0) {
            return
        }

        await douyinDB?.syncConfigSubscriptions(Config.pushlist.douyin)
    }

    /**
     * 获取并处理抖音动态数据
     * @param {WillBePushList} data - 待推送的抖音动态数据列表
     * @returns {Promise<boolean>} - 返回处理结果，成功返回true
     */
    async getdata(data) {
        try {
            // 检查数据是否为空，为空则直接返回true
            if (Object.keys(data).length === 0) return true

            // 遍历每个动态数据
            for (const awemeId in data) {
                // 👇 1. [新增] 在 for 循环内部第一行加上 try
                try {
                    const pushItem = data[awemeId]
                    if (!pushItem) continue
                    // 记录开始处理动态的日志信息
                    logger.mark(`
        ${logger.blue('开始处理并渲染抖音动态图片')}
        ${logger.blue('博主')}: ${logger.green(pushItem.remark)} 
        ${logger.cyan('作品id')}：${logger.yellow(awemeId)}
        ${logger.cyan('访问地址')}：${logger.green('https://www.douyin.com/video/' + awemeId)}`)

                    // 获取当前动态项
                    const Detail_Data = pushItem.Detail_Data
                    // 检查是否跳过该动态
                    const skip = await skipDynamic(pushItem)
                    /**
                     * @type {import('@kaguyajs/trss-yunzai-types').icqq.segment[]}
                     */
                    let img = []
                    /** @type {import('./getid.js').DouyinIdData} 抖音数据类型 */
                    let iddata = { is_mp4: true, type: 'one_work' }

                    // 如果不跳过，获取抖音ID数据
                    if (!skip) {
                        iddata = await getDouyinID(Detail_Data?.share_url || 'https://live.douyin.com/' + Detail_Data?.room_data?.owner?.web_rid, false)
                    }

                    // 如果不跳过，处理动态内容
                    if (!skip) {
                        // 处理直播推送
                        if (pushItem.living && 'room_data' in pushItem.Detail_Data && Detail_Data.live_data) {
                            // 处理直播推送
                            img = await Render('douyin/live', {
                                image_url: [{ image_src: Detail_Data?.live_data?.data?.data?.data[0]?.cover?.url_list[0] || '' }],
                                text: Detail_Data?.live_data?.data?.data?.data[0]?.title || '',
                                liveinf: `${Detail_Data.live_data?.data?.data?.partition_road_map?.partition?.title || Detail_Data.live_data?.data?.data?.data[0].title || ''} | 房间号: ${Detail_Data?.room_data?.owner?.web_rid || ''}`,
                                在线观众: Common.count(Detail_Data.live_data?.data?.data?.data[0].room_view_stats?.display_value),
                                总观看次数: Common.count(Number(Detail_Data.live_data?.data?.data?.data[0].stats?.total_user_str)),
                                username: Detail_Data.user_info.data.user.nickname,
                                avater_url: 'https://p3-pc.douyinpic.com/aweme/1080x1080/' + Detail_Data.user_info.data.user.avatar_larger.uri,
                                fans: Common.count(Detail_Data.user_info.data.user.follower_count),
                                create_time: Common.convertTimestampToDateTime(Date.now() / 1000),
                                now_time: Common.convertTimestampToDateTime(Date.now() / 1000),
                                share_url: 'https://live.douyin.com/' + Detail_Data.room_data.owner.web_rid,
                                dynamicTYPE: '直播动态推送'
                            })
                        } else {
                            // 处理普通作品推送
                            const realUrl = Config.douyin?.push?.shareType === 'web' && await new Networks({
                                url: Detail_Data.share_url,
                                headers: {
                                    ...douyinBaseHeaders,
                                    Referer: 'https://www.douyin.com',
                                    Cookie: ''
                                }
                            }).getLocation()
                            img = await Render('douyin/dynamic', {
                                image_url: iddata.is_mp4 ? Detail_Data.video.animated_cover?.url_list[0] || Detail_Data.video.cover.url_list[0] : Detail_Data.images[0].url_list[0],
                                desc: this.desc(Detail_Data, Detail_Data.desc),
                                dianzan: Common.count(Detail_Data.statistics.digg_count),
                                pinglun: Common.count(Detail_Data.statistics.comment_count),
                                share: Common.count(Detail_Data.statistics.share_count),
                                shouchang: Common.count(Detail_Data.statistics.collect_count),
                                create_time: Common.convertTimestampToDateTime(pushItem.create_time / 1000),
                                avater_url: 'https://p3-pc.douyinpic.com/aweme/1080x1080/' + Detail_Data.user_info.data.user.avatar_larger.uri,
                                share_url: Config.douyin?.push?.shareType === 'web' ? realUrl : `https://aweme.snssdk.com/aweme/v1/play/?video_id=${Detail_Data.video.play_addr.uri}&ratio=1080p&line=0`,
                                username: Detail_Data.author.nickname,
                                抖音号: Detail_Data.user_info.data.user.unique_id === '' ? Detail_Data.user_info.data.user.short_id : Detail_Data.user_info.data.user.unique_id,
                                粉丝: Common.count(Detail_Data.user_info.data.user.follower_count),
                                获赞: Common.count(Detail_Data.user_info.data.user.total_favorited),
                                关注: Common.count(Detail_Data.user_info.data.user.following_count)
                            })
                        }
                    }

                    // ==================== 修复 1：添加图片生成失败拦截机制 ====================
                    // 如果没有被标记为 skip，且 img 渲染失败（返回了 false 或为空），则跳过数据库记录
                    if (!skip && (!img || img === false)) {
                        logger.warn(`[Douyin Push] 动态${dynamicId}渲染图片失败/超时，取消推送并不写入数据库，等待下一次轮询重试`);
                        if (this.e && this.e.reply) await this.e.reply(`抖音推送异常：动态${dynamicId}渲染图片失败/超时，取消推送并不写入数据库，等待下一次轮询重试`);
                        continue; // 直接跳出当前动态的处理，不进入下面的 targets 循环，也不触发 finally 记录 DB
                    }

                    // 遍历目标群组，并发送消息
                    for (const target of pushItem.targets) {
                        let sendSuccess = false // 【1. 新增】成功状态标志
                        try {
                            const { groupId, botId } = target
                            let status = { message_id: '' }
                            if (!skip) {
                                // ====== 修复：独立包裹卡片发送，防止其假超时中断后续视频解析 ======
                                try {
                                    status = Bot?.[botId]?.pickGroup(groupId)
                                        ? img && await Bot[botId].pickGroup(groupId).sendMsg(img)
                                        : (logger.warn(`bot${botId}不存在或群${groupId}不存在`), { message_id: '1' })
                                } catch (imgError) {
                                    const errStr = JSON.stringify(imgError) + String(imgError);
                                    if (errStr.includes('Timeout') && errStr.includes('sendMsg')) {
                                        logger.warn(`[Douyin Push] 动态卡片发送超时，大概率已送达，跳过报错继续执行视频/图集解析`);
                                        status = { message_id: 'fake_success' }; // 伪造一个 message_id 以便让下面的视频解析能通过 if (status.message_id) 的判断
                                    } else {
                                        throw imgError; // 真实报错，抛出给外层彻底中断本次推送
                                    }
                                }
                                // =================================================================

                                // 如果是直播推送，更新直播状态
                                if (pushItem.living && 'room_data' in pushItem.Detail_Data && status.message_id) {
                                    await douyinDB?.updateLiveStatus(pushItem.sec_uid, true)
                                }

                                // 2. 是否一同解析该新作品？(拦截因为群/bot不存在而返回的假id)
                                if (Config.douyin?.push?.parsedynamic && status.message_id && status.message_id !== "1") {
                                    // 如果新作品是视频
                                    if (iddata.is_mp4) {
                                        try {
                                            /** 默认视频下载地址 */
                                            let downloadUrl = `https://aweme.snssdk.com/aweme/v1/play/?video_id=${Detail_Data.video.play_addr.uri}&ratio=1080p&line=0`
                                            // 根据配置文件自动选择分辨率
                                            if (Config.douyin.autoResolution) {
                                                logger.debug(`开始排除不符合条件的视频分辨率；\n
                      共拥有${logger.yellow(Detail_Data.video.bit_rate.length)}个视频源\n
                      视频ID：${logger.green(Detail_Data.aweme_id)}\n
                      分享链接：${logger.green(Detail_Data.share_url)}
                      `)
                                                const bitRate = Detail_Data.video?.bit_rate || [];
                                                const videoObj = douyinProcessVideos(Detail_Data.video.bit_rate, Config.upload.filelimit || 100)
                                                downloadUrl = await new Networks({
                                                    url: videoObj?.[0]?.play_addr?.url_list?.[0] || '',
                                                    headers: {
                                                        ...douyinBaseHeaders,
                                                        Cookie: ''
                                                    }
                                                }).getLongLink()
                                            } else {
                                                // 全部加上 ?. 可选链保护
                                                downloadUrl = await new Networks({
                                                    url: Detail_Data.video?.bit_rate?.[0]?.play_addr?.url_list?.[0] || Detail_Data.video?.play_addr_h264?.url_list?.[0] || Detail_Data.video?.play_addr?.url_list?.[0] || downloadUrl,
                                                    headers: { ...douyinBaseHeaders, Cookie: "" }
                                                }).getLongLink();
                                            }
                                            // 下载视频
                                            logger.mark(`[Douyin Push] 正在后台下载并发送视频: ${Detail_Data.desc}.mp4 ...`);

                                            await downloadVideo(this.e, {
                                                video_url: downloadUrl,
                                                title: { timestampTitle: `tmp_${Date.now()}.mp4`, originTitle: `${Detail_Data.desc}.mp4` },
                                                headers: {
                                                    ...douyinBaseHeaders,
                                                    Referer: downloadUrl,
                                                    Cookie: ''
                                                }
                                            }, { active: true, activeOption: { uin: botId, group_id: groupId } })
                                            logger.mark(`[Douyin Push] 视频 ${Detail_Data.desc}.mp4 下载并发送完毕！`);
                                        } catch (error) {
                                            logger.error(error)
                                        }
                                    } else if (!iddata.is_mp4 && iddata.type === 'one_work') { // 如果新作品是图集
                                        /** @type {import ('@kaguyajs/trss-yunzai-types').icqq.segment[]} */
                                        const imageres = []
                                        let image_url
                                        for (const item of Detail_Data.images) {
                                            image_url = item.url_list[2] || item.url_list[1] // 图片地址
                                            imageres.push(segment.image(image_url))
                                        }
                                        if (!imageres.length) return false
                                        const forwardMsg = Version.BotName === 'Miao-Yunzai' ?
                                            Bot?.makeForwardMsg(imageres.map(img => ({
                                                user_id: 2854196310,
                                                message: img
                                            }))) :
                                            common?.makeForwardMsg(Bot?.[botId], imageres, '作品图片')
                                        // 如果bot不存在或群组不存在,则默认message_id为1,防止bot上线发一堆消息
                                        Bot?.[botId]?.pickGroup(groupId) && forwardMsg
                                            ? await Bot[botId].pickGroup(groupId).sendMsg(forwardMsg)
                                            : (logger.warn(`bot${botId}不存在或群${groupId}不存在`), { message_id: '1' })
                                    }
                                    sendSuccess = true
                                }
                            }
                        } catch (error) {
                            const errStr = JSON.stringify(error) + String(error);
                            if (errStr.includes("Timeout") && errStr.includes("sendMsg")) {
                                logger.warn(`[Douyin Push] 作品${awemeId}发送超时，真实情况可能未送达群聊，标记为失败等待下一轮重试`);
                                sendSuccess = false; // <--- 遇到超时老老实实标记为失败
                            } else {
                                logger.error(`[Douyin Push] 发送${awemeId}真实失败(网络断开等)，取消写入数据库:`, error);
                                if (this.e && this.e.reply) await this.e.reply(`抖音推送异常：发送${dynamicId}失败(渲染异常、网络断开等)，取消写入数据库:\n${error}`);
                                sendSuccess = false; // 发生异常，标记为失败
                            }
                        } finally {
                            // 【修复 2：逻辑修改】无论是否发送成功，只有明确送达或被过滤规则 skip，才添加缓存
                            if (!pushItem.living && (sendSuccess || skip)) {
                                await douyinDB?.addAwemeCache(awemeId, pushItem.sec_uid, target.groupId)
                            }
                        }
                    }
                } catch (innerError) {
                    logger.error(`[Douyin Push] 动态 ${dynamicId} 处理崩溃 (渲染超时等)，跳过并不记录数据库，等待下轮重试:`, innerError);
                    if (this.e && this.e.reply) await this.e.reply(`抖音推送异常：动态${dynamicId}处理崩溃 (渲染超时等)，跳过并不记录数据库，等待下轮重试:\n${innerError}`);
                    continue; // 发生异常直接跳过这条动态，继续处理下一个 UP 主
                }
            }
            // 👇 3. [修复] 把下面这两行的 e 改成 error
        } catch (error) {
            logger.error('[Douyin Push] 推送动态列表总体失败', error);
            if (this.e && this.e.reply) await this.e.reply(`抖音推送异常：推送动态列表总体失败\n${error}`);
            return false;
        }
        return true
    }

    /**
     * 根据配置文件获取用户当天的作品列表。
     * @param {douyinPushItem[]} userList - 抖音推送项列表
     * @returns {Promise<WillBePushList>} 将要推送的列表
     */
    async getDynamicList(userList) {
        const willbepushlist = {} 

        try {
            const filteredUserList = userList.filter(item => item.switch !== false)
            for (const item of filteredUserList) {
                // 加一层 try-catch，防止某一个博主解析失败导致后面的全军覆没
                try {
                    const sec_uid = item.sec_uid
                    logger.mark(`[Douyin Push] 开始获取抖音UP主：${item.remark || '未知'} 的最新作品...`)
                    
                    // 🚨 修复 1：增加 count 参数，防止抖音返回空数组
                    const videolist = await this.amagi.douyin.fetcher.fetchUserVideoList({
                        sec_uid: sec_uid,
                        count: 20,
                        max_cursor: "0",
                        typeMode: "strict"
                    }).catch(e => {
                        logger.error(`[Douyin Push] 获取视频列表失败:`, e);
                        return {};
                    })
                    
                    const userinfo = await this.amagi.douyin.fetcher.fetchUserProfile({ sec_uid, typeMode: 'strict' }).catch(() => ({}))

                    // 🚨 修复 2：完美兼容旧版配置文件 (如果没有 :botId 后缀，自动使用当前 bot)
                    const targets = item.group_id.map(groupWithBot => {
                        const parts = String(groupWithBot).split(':')
                        const groupId = parts[0]
                        const botId = parts[1] || this.e?.self_id || (global.Bot && Object.keys(global.Bot)[0]) || ''
                        return { groupId, botId }
                    }).filter(target => target.groupId)

                    if (targets.length === 0) {
                        logger.warn(`[Douyin Push] 博主 ${item.remark} 没有有效的订阅群组(跳过)`);
                        continue
                    }

                    // 🚨 修复 3：深度解构，兼容各种数据嵌套层级
                    const aweme_list = videolist?.data?.data?.aweme_list || videolist?.data?.aweme_list || videolist?.aweme_list || []
                    const userData = userinfo?.data?.data?.user || userinfo?.data?.user || userinfo?.user || {}

                    if (aweme_list.length === 0) {
                        logger.warn(`[Douyin Push] 博主 ${item.remark} 的作品列表为空，可能被风控或近期无作品`);
                    }

                    // 处理视频列表
                    if (aweme_list.length > 0) {
                        for (const aweme of aweme_list) {
                            const now = Date.now()
                            // 兼容 10 位(秒)和 13 位(毫秒)的时间戳
                            const createTime = String(aweme.create_time).length === 10 ? aweme.create_time * 1000 : aweme.create_time
                            const timeDifference = now - createTime 
                            const is_top = aweme.is_top === 1 
                            let shouldPush = false

                            // 判断是否在 24 小时 (86400000 ms) 内
                            if ((is_top && timeDifference < 86400000) || (timeDifference < 86400000 && !is_top)) {
                                const groupIds = targets.map(t => t.groupId)
                                const alreadyPushed = await this.checkIfAlreadyPushed(aweme.aweme_id, sec_uid, groupIds)
                                if (!alreadyPushed) {
                                    shouldPush = true
                                    logger.mark(`[Douyin Push] 发现新作品待推送: ${aweme.aweme_id}`);
                                }
                            }

                            if (shouldPush) {
                                willbepushlist[aweme.aweme_id] = {
                                    remark: item?.remark || aweme.author?.nickname || '未知',
                                    sec_uid,
                                    create_time: createTime,
                                    targets,
                                    Detail_Data: {
                                        ...aweme,
                                        user_info: userinfo
                                    },
                                    avatar_img: 'https://p3-pc.douyinpic.com/aweme/1080x1080/' + (userData.avatar_larger?.uri || ''),
                                    living: false
                                }
                            }
                        }
                    }

                    /** 获取缓存的直播状态 */
                    const liveStatus = await douyinDB?.getLiveStatus(sec_uid)

                    if (userData.live_status === 1) {
                        const liveInfo = await this.amagi.douyin.fetcher.fetchLiveRoomInfo({ sec_uid: userData.sec_uid || sec_uid, typeMode: 'strict' }).catch(() => ({}))

                        // 如果之前没有直播，现在开播了，需要推送
                        if (!liveStatus?.living) {
                            willbepushlist[`live_${sec_uid}`] = {
                                remark: item.remark,
                                sec_uid,
                                create_time: Date.now(),
                                targets,
                                Detail_Data: {
                                    user_info: userinfo,
                                    room_data: userData.room_data ? JSON.parse(userData.room_data) : {},
                                    live_data: liveInfo,
                                    liveStatus: { liveStatus: 'open', isChanged: true, isliving: true }
                                },
                                avatar_img: 'https://p3-pc.douyinpic.com/aweme/1080x1080/' + (userData.avatar_larger?.uri || ''),
                                living: true
                            }
                        }
                    } else if (liveStatus?.living) {
                        // 如果之前在直播，现在已经关播，需要更新状态
                        await douyinDB?.updateLiveStatus(sec_uid, false)
                        logger.info(`用户 ${item.remark || sec_uid} 已关播，更新直播状态`)
                    }

                } catch (e) {
                    logger.error(`[Douyin Push] 获取用户 ${item.sec_uid} 列表时崩溃:`, e);
                }
            }
        } catch (error) {
            logger.error('获取抖音用户主页作品列表总体失败:', error)
        }

        return willbepushlist
    }

    /**
     * 检查作品是否已经推送过
     * @async
     * @function checkIfAlreadyPushed
     * @param {string} aweme_id - 作品ID
     * @param {string} sec_uid - 用户sec_uid
     * @param {string[]} groupIds - 群组ID列表
     * @returns {Promise<boolean>} 是否已经推送过
     */
    async checkIfAlreadyPushed(aweme_id, sec_uid, groupIds) {
        for (const groupId of groupIds) {
            const isPushed = await douyinDB?.isAwemePushed(aweme_id, sec_uid, groupId)
            if (!isPushed) {
                return false
            }
        }
        return true
    }

    /**
     * 设置或更新特定 sec_uid 的群组信息。
     * @param {string} sec_uid 用户的sec_uid
     */
    async setting(sec_uid) {
        const config = Config.pushlist // 读取配置文件
        const groupId = this.e.group_id
        const botId = this.e.self_id

        if (!sec_uid) {
            throw new Error('无法获取用户sec_uid')
        }

        // 顺序获取用户数据和检查订阅状态
        const UserInfoData = await this.amagi.douyin.fetcher.fetchUserProfile({ sec_uid, typeMode: 'strict' })
        const isSubscribed = await douyinDB?.isSubscribed(sec_uid, groupId)

        if (!UserInfoData?.data?.user) {
            throw new Error('获取用户信息失败, 请确认抖音号或链接是否正确')
        }

        // 处理抖音号：优先使用unique_id，如果为空则使用short_id
        const user_shortid = UserInfoData.data.user.unique_id || UserInfoData.data.user.short_id
        if (!user_shortid) {
            throw new Error('无法获取用户抖音号')
        }

        // 初始化 douyin 数组：确保配置中存在douyin数组
        config.douyin = config.douyin || []

        // 查找用户配置：检查是否已存在该用户的订阅配置
        const existingItem = config.douyin.find((item) => item.sec_uid === sec_uid)

        if (existingItem) {
            // 使用findIndex快速定位群组配置，提高查找效率
            const groupIndex = existingItem.group_id.findIndex(item => {
                const existingGroupId = item?.split(':')[0]
                return existingGroupId === String(groupId)
            })

            if (groupIndex >= 0) {
                // 删除订阅：移除群组配置并更新数据库
                existingItem.group_id.splice(groupIndex, 1)

                // 顺序执行数据库操作和消息发送
                if (isSubscribed) {
                    await douyinDB?.unsubscribeDouyinUser(groupId, sec_uid)
                }
                await this.e.reply(`群：${this.e.group_name}(${groupId})\n删除成功！${UserInfoData.data.user.nickname}\n抖音号：${user_shortid}`)

                // 清理空配置：如果用户没有群组订阅了，删除整个用户配置
                if (existingItem.group_id.length === 0) {
                    const index = config.douyin.indexOf(existingItem)
                    config.douyin.splice(index, 1)
                }
            } else {
                // 添加订阅：向现有用户配置添加新群组
                existingItem.group_id.push(`${groupId}:${botId}`)

                // 顺序执行数据库操作和消息发送
                if (!isSubscribed) {
                    await douyinDB?.subscribeDouyinUser(groupId, botId, sec_uid, user_shortid, UserInfoData.data.user.nickname)
                }
                await this.e.reply(`群：${this.e.group_name}(${groupId})\n添加成功！${UserInfoData.data.user.nickname}\n抖音号：${user_shortid}`)

                // 检查推送状态：如果推送未开启，发送提示消息
                if (Config.douyin.push && Config.douyin.push.switch === false) {
                    await this.e.reply('请发送「#kkk设置抖音推送开启」以进行推送')
                }
            }
        } else {
            // 新增用户：创建新的用户订阅配置
            config.douyin.push({
                switch: true,
                sec_uid,
                group_id: [`${groupId}:${botId}`],
                remark: UserInfoData.data.user.nickname,
                short_id: user_shortid
            })

            // 顺序执行数据库操作和消息发送
            if (!isSubscribed) {
                await douyinDB?.subscribeDouyinUser(groupId, botId, sec_uid, user_shortid, UserInfoData.data.user.nickname)
            }
            await this.e.reply(`群：${this.e.group_name}(${groupId})\n添加成功！${UserInfoData.data.user.nickname}\n抖音号：${user_shortid}`)

            // 检查推送状态：如果推送未开启，发送提示消息
            if (Config.douyin.push && Config.douyin.push.switch === false) {
                await this.e.reply('请发送「#kkk设置抖音推送开启」以进行推送')
            }
        }

        // 顺序执行配置保存和界面渲染
        if (config.douyin) {
            Config.modify('pushlist', 'douyin', config.douyin)
        }
        await this.renderPushList()
    }

    /** 渲染推送列表图片 */
    async renderPushList() {
        await this.syncConfigToDatabase()
        const groupId = this.e.group_id

        // 获取当前群组的所有订阅
        const subscriptions = await douyinDB?.getGroupSubscriptions(groupId)

        if (!subscriptions || subscriptions.length === 0) {
            await this.e.reply(`当前群：${this.e.group_name}(${groupId})\n没有设置任何抖音博主推送！\n可使用「#设置抖音推送 + 抖音号」进行设置`)
            return
        }

        /** @type {Record<string, string>[]} */
        const renderOpt = []

        for (const subscription of subscriptions) {
            const sec_uid = subscription.sec_uid
            const userInfo = await this.amagi.douyin.fetcher.fetchUserProfile({ sec_uid, typeMode: 'strict' })

            renderOpt.push({
                avatar_img: userInfo.data.user.avatar_larger.url_list[0] || '',
                username: userInfo.data.user.nickname,
                short_id: userInfo.data.user.unique_id === '' ? userInfo.data.user.short_id : userInfo.data.user.unique_id,
                fans: Common.count(userInfo.data.user.follower_count),
                total_favorited: Common.count(userInfo.data.user.total_favorited),
                following_count: Common.count(userInfo.data.user.following_count)
            })
        }
        const img = await Render('douyin/userlist', { renderOpt })
        await this.e.reply(img)
    }

    /**
     * 强制推送
     * @param {WillBePushList} data 处理完成的推送列表
     */
    async forcepush(data) {
        const currentGroupId = 'groupId' in this.e && this.e.groupId ? this.e.groupId : ''
        const currentBotId = this.e.selfId

        // 如果不是全部强制推送，需要过滤数据
        if (!this.e.msg.includes('全部')) {
            // 获取当前群组订阅的所有抖音用户
            const subscriptions = await douyinDB?.getGroupSubscriptions(currentGroupId)
            const subscribedUids = subscriptions?.map(sub => sub.sec_uid) || []

            // 创建一个新的推送列表，只包含当前群组订阅的用户的作品
            /** @type {WillBePushList} */
            const filteredData = {}

            for (const awemeId in data) {
                // 检查该作品的用户是否被当前群组订阅
                if (data[awemeId] && subscribedUids.includes(data[awemeId].sec_uid)) {
                    // 复制该作品到过滤后的列表，并将目标设置为当前群组
                    filteredData[awemeId] = {
                        ...data[awemeId],
                        targets: [{
                            groupId: currentGroupId,
                            botId: currentBotId
                        }]
                    }
                }
            }

            // 使用过滤后的数据进行推送
            await this.getdata(filteredData)
        } else {
            // 全部强制推送，保持原有逻辑
            await this.getdata(data)
        }
    }

    /**
     * 检查并更新备注信息
     */
    async checkremark() {
        // 读取配置文件内容
        /** @type {import('../../utils/Config.js').PushlistConfig} */
        const config = Config.pushlist
        /** @type {{ sec_uid: string }[]} */
        const updateList = []

        if (!Config.pushlist?.douyin || Config.pushlist.douyin.length === 0) return true

        // 遍历配置文件中的用户列表，收集需要更新备注信息的用户
        for (const i of Config.pushlist.douyin) {
            const remark = i.remark
            const sec_uid = i.sec_uid

            if (remark === undefined || remark === '') {
                updateList.push({ sec_uid })
            }
        }

        // 如果有需要更新备注的用户，则逐个获取备注信息并更新到配置文件中
        if (updateList.length > 0) {
            for (const i of updateList) {
                // 从外部数据源获取用户备注信息
                const userinfo = await this.amagi.douyin.fetcher.fetchUserProfile({ sec_uid: i.sec_uid, typeMode: 'strict' })
                const remark = userinfo.data.user.nickname

                // 在配置文件中找到对应的用户，并更新其备注信息
                const matchingItemIndex = config.douyin?.findIndex((item) => item.sec_uid === i.sec_uid) || 0
                if (matchingItemIndex !== -1 && config.douyin && config.douyin[matchingItemIndex]) {
                    config.douyin[matchingItemIndex].remark = remark
                }
            }

            // 将更新后的配置文件内容写回文件
            Config.modify('pushlist', 'douyin', config.douyin)
        }

        return false
    }

    /**
     * 处理作品描述
     * @param {any} Detail_Data - 作品详细数据
     * @param {string} desc - 作品描述文本
     * @returns {string} 处理后的描述文本
     */
    desc(Detail_Data, desc) {
        if (desc === '') {
            return '该作品没有描述'
        }
        return desc
    }

}

/**
 * 判断标题是否有屏蔽词或屏蔽标签
 * @param {DouyinPushItem} PushItem - 推送项
 * @returns {Promise<boolean>} 是否应该跳过推送
 */
const skipDynamic = async (PushItem) => {
    // 如果是直播动态，不跳过
    if ('liveStatus' in PushItem.Detail_Data) {
        return false
    }

    /** @type {string[]} */
    const tags = []

    // 提取标签
    if (PushItem.Detail_Data.text_extra) {
        for (const item of PushItem.Detail_Data.text_extra) {
            if (item.hashtag_name) {
                tags.push(item.hashtag_name)
            }
        }
    }

    logger.debug(`检查作品是否需要过滤：${PushItem.Detail_Data.share_url}`)
    const shouldFilter = await douyinDB?.shouldFilter(PushItem, tags)
    return /** @type {boolean} */ (shouldFilter)
}
