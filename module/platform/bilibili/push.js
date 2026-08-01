import { Base, baseHeaders, Common, Config, downloadFile, mergeFile, Render, uploadFile, Version } from '../../utils/index.js'
import { bilibiliProcessVideos, cover, generateDecorationCard, getvideosize, replacetext } from './bilibili.js'
import { DynamicType, MajorType } from '@ikenxuan/amagi'
import { bilibiliDB, cleanOldDynamicCache } from '../../db/index.js'
import common from '../../../../../lib/common/common.js'
import fs from 'node:fs'

/**
 * @typedef {import('@ikenxuan/amagi').BiliUserDynamic} BiliUserDynamic
 * @typedef {import('@ikenxuan/amagi').BiliUserProfile} BiliUserProfile
 */

/**
 * 下载文件选项
 * @typedef {import('../../utils/Base.js').downloadFileOptions} downloadFileOptions
 */

/**
 * 定义推送列表项的接口
 * @typedef {import('../../utils/Config.js').bilibiliPushItem} bilibiliPushItem
 */

/** 已支持推送的动态类型 */
export { DynamicType } from '@ikenxuan/amagi'

/** @type {Record<string, '视频'|'图文'|'文字'|'转发'|'直播'>} */
const dynamicTypeNames = {
    [DynamicType.AV]: '视频',
    [DynamicType.DRAW]: '图文',
    [DynamicType.WORD]: '文字',
    [DynamicType.FORWARD]: '转发',
    [DynamicType.LIVE_RCMD]: '直播'
}

const dynamicTypeCodes = Object.fromEntries(
    Object.entries(dynamicTypeNames).map(([type, name]) => [name, type])
)

/** B站推送列表可展示的动态类型名称 */
export const BILIBILI_DYNAMIC_PUSH_TYPES = Object.freeze(Object.values(dynamicTypeNames))

/**
 * 判断某类动态是否允许推送。
 * 未配置时保留旧行为（所有已支持的类型均可推送）；空数组则明确禁用全部类型。
 * @param {string} dynamicType B站动态类型
 * @param {unknown} configuredTypes 用户或全局配置的类型列表
 * @returns {boolean}
 */
export const isBilibiliDynamicTypeEnabled = (dynamicType, configuredTypes) => {
    if (!Array.isArray(configuredTypes)) return true

    const typeName = dynamicTypeNames[dynamicType]
    return Boolean(typeName && (configuredTypes.includes(typeName) || configuredTypes.includes(dynamicType)))
}

/**
 * 获取实际生效的推送类型名称，用于推送列表展示。
 * @param {unknown} configuredTypes 用户或全局配置的类型列表
 * @returns {string[]}
 */
export const getEnabledBilibiliDynamicTypes = (configuredTypes) => {
    if (!Array.isArray(configuredTypes)) return [...BILIBILI_DYNAMIC_PUSH_TYPES]

    return BILIBILI_DYNAMIC_PUSH_TYPES.filter(typeName =>
        configuredTypes.includes(typeName) || configuredTypes.includes(dynamicTypeCodes[typeName])
    )
}

/**
 * 每个推送项的类型定义
 * @typedef {Object} BilibiliPushItem
 * @property {string} remark - 该UP主的昵称
 * @property {number} host_mid - UP主UID
 * @property {number} create_time - 动态发布时间
 * @property {Array<{groupId: string, botId: string}>} targets - 要推送到的群组和机器人ID
 * @property {BiliUserDynamic['data']['items'][number]} Dynamic_Data - 动态详情信息
 * @property {string} avatar_img - UP主头像url
 * @property {DynamicType} dynamic_type - 动态类型
 */

/**
 * Bilibili基础请求头配置
 * @type {downloadFileOptions['headers']}
 */
const bilibiliBaseHeaders = {
    ...baseHeaders,
    Referer: 'https://api.bilibili.com/',
    Cookie: Config.cookies.bilibili
}

const CARD_SEND_TIMEOUT = 30_000
const MEDIA_SEND_TIMEOUT = 180_000
let activePushTask = null
let activePushStartedAt = 0

export class Bilibilipush extends Base {
    force = false
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
        if (activePushTask) {
            const elapsedSeconds = Math.round((Date.now() - activePushStartedAt) / 1000)
            logger.warn(`[Bilibili Push] 上一轮任务仍在运行(${elapsedSeconds}秒)，跳过本轮调度`)
            return false
        }

        activePushStartedAt = Date.now()
        activePushTask = this.runAction()
        try {
            return await activePushTask
        } finally {
            activePushTask = null
            activePushStartedAt = 0
        }
    }

    async runAction() {
        try {
            await this.syncConfigToDatabase()
            // 清理旧的动态缓存记录
            const deletedCount = await cleanOldDynamicCache('bilibili', 1)
            if (deletedCount > 0) {
                logger.info(`已清理 ${deletedCount} 条过期的B站动态缓存记录`)
            }

            const data = await this.getDynamicList(Config.pushlist.bilibili || [])
            const pushdata = await this.excludeAlreadyPushed(data.willbepushlist)

            if (Object.keys(pushdata).length === 0) return true

            if (this.force) {
                return await this.forcepush(pushdata)
            } else {
                return await this.getdata(pushdata)
            }
        } catch (error) {
            logger.error(error)
            return false
        }
    }

    /**
     * 同步配置文件中的订阅信息到数据库
     */
    async syncConfigToDatabase() {
        // 如果配置文件中没有B站推送列表，直接返回
        if (!Config.pushlist.bilibili || Config.pushlist.bilibili.length === 0) {
            return
        }

        await bilibiliDB?.syncConfigSubscriptions(Config.pushlist.bilibili)
    }

    /**
     * @typedef {Record<string, BilibiliPushItem>} WillBePushList
     */

    /**
     * 异步获取数据并根据动态类型处理和发送动态信息。
     * @param {WillBePushList} data - 包含动态相关信息的对象
     * @returns {Promise<boolean>} - 返回处理结果，成功返回true，失败返回false
     */
    async getdata(data) {
        try {
            for (const dynamicId in data) {
                // 【1. 新增】在循环开头加一个 try，包裹单条动态的所有处理逻辑
                try {
                    const dynamicItem = data[dynamicId]
                    if (!dynamicItem) continue

                    logger.mark(`
            ${logger.blue('开始处理并渲染B站动态图片')}
            ${logger.cyan('UP')}: ${logger.green(dynamicItem.remark)}
            ${logger.cyan('动态id')}：${logger.yellow(dynamicId)}
            ${logger.cyan('访问地址')}：${logger.green('https://t.bilibili.com/' + dynamicId)}`)

                    let skip = await skipDynamic(dynamicItem)
                    let send_video = true
                    /** @type {import ('@kaguyajs/trss-yunzai-types').icqq.segment[]} */
                    let img = []

                    if (!skip) {
                        const userINFO = await this.amagi.bilibili.fetcher.fetchUserCard({ host_mid: String(dynamicItem.host_mid), typeMode: 'strict' }).catch(() => null)
                        let emojiResponse = await this.amagi.bilibili.fetcher.fetchEmojiList({ typeMode: 'strict' }).catch(() => null)
                        const emojiDATA = extractEmojisData(emojiResponse?.data?.data?.packages || [])

                        switch (dynamicItem.dynamic_type) {
                            /** 处理图文动态 */
                            case DynamicType.DRAW: {
                                if (dynamicItem.Dynamic_Data.modules.module_dynamic?.topic !== null && dynamicItem.Dynamic_Data.modules.module_dynamic && dynamicItem.Dynamic_Data.modules.module_dynamic.topic !== null) {
                                    const name = dynamicItem.Dynamic_Data.modules.module_dynamic.topic?.name
                                    dynamicItem.Dynamic_Data.modules.module_dynamic.major?.opus?.summary?.rich_text_nodes?.unshift({
                                        orig_text: name,
                                        text: name,
                                        type: 'topic',
                                        rid: dynamicItem.Dynamic_Data.modules.module_dynamic.topic?.id?.toString() || '',
                                    })
                                    if (dynamicItem.Dynamic_Data.modules.module_dynamic.major?.opus?.summary) {
                                        dynamicItem.Dynamic_Data.modules.module_dynamic.major.opus.summary.text = `${name}\n\n` + (dynamicItem.Dynamic_Data.modules.module_dynamic.major?.opus?.summary?.text || '')
                                    }
                                }
                                img = await Render('bilibili/dynamic/DYNAMIC_TYPE_DRAW',
                                    {
                                        image_url: dynamicItem.Dynamic_Data.modules.module_dynamic.major?.opus?.pics?.filter(item => item?.url).map(item => ({ image_src: item.url })) || [],
                                        text: replacetext(
                                            br(
                                                dynamicItem.Dynamic_Data.modules.module_dynamic.major?.opus?.summary?.text || ''),
                                            dynamicItem.Dynamic_Data.modules.module_dynamic.major?.opus?.summary?.rich_text_nodes || []
                                        ),
                                        dianzan: Common.count(dynamicItem.Dynamic_Data.modules.module_stat.like.count),
                                        pinglun: Common.count(dynamicItem.Dynamic_Data.modules.module_stat.comment.count),
                                        share: Common.count(dynamicItem.Dynamic_Data.modules.module_stat.forward.count),
                                        create_time: Common.convertTimestampToDateTime(dynamicItem.Dynamic_Data.modules.module_author.pub_ts),
                                        avatar_url: dynamicItem.Dynamic_Data.modules.module_author.face,
                                        frame: dynamicItem.Dynamic_Data.modules.module_author.pendant.image,
                                        share_url: 'https://t.bilibili.com/' + dynamicItem.Dynamic_Data.id_str,
                                        username: checkvip(userINFO?.data?.data?.card),
                                        fans: Common.count(userINFO?.data?.data?.follower),
                                        user_shortid: dynamicItem.host_mid,
                                        total_favorited: Common.count(userINFO?.data?.data?.like_num),
                                        following_count: Common.count(userINFO?.data?.data?.card?.attention),
                                        decoration_card: generateDecorationCard(dynamicItem.Dynamic_Data.modules.module_author?.decoration_card),
                                        render_time: Common.getCurrentTime(),
                                        dynamicTYPE: '图文动态推送'
                                    }
                                )
                                break
                            }
                            /** 处理纯文动态 */
                            case DynamicType.WORD: {
                                let text = replacetext(dynamicItem.Dynamic_Data.modules.module_dynamic.desc?.text || '', dynamicItem.Dynamic_Data.modules.module_dynamic.desc?.rich_text_nodes || [])
                                for (const item of emojiDATA || []) {
                                    if (text.includes(item.text)) {
                                        if (text.includes('[') && text.includes(']')) {
                                            text = text.replace(/\[[^\]]*\]/g, `<img src="${item.url}"/>`).replace(/\\/g, '')
                                        }
                                        text += '&#160'
                                    }
                                }
                                img = await Render('bilibili/dynamic/DYNAMIC_TYPE_WORD',
                                    {
                                        text: br(text),
                                        dianzan: Common.count(dynamicItem.Dynamic_Data.modules.module_stat.like.count),
                                        pinglun: Common.count(dynamicItem.Dynamic_Data.modules.module_stat.comment.count),
                                        share: Common.count(dynamicItem.Dynamic_Data.modules.module_stat.forward.count),
                                        create_time: Common.convertTimestampToDateTime(dynamicItem.Dynamic_Data.modules.module_author.pub_ts),
                                        avatar_url: dynamicItem.Dynamic_Data.modules.module_author.face,
                                        frame: dynamicItem.Dynamic_Data.modules.module_author.pendant.image,
                                        share_url: 'https://t.bilibili.com/' + dynamicItem.Dynamic_Data.id_str,
                                        username: checkvip(userINFO.data.data.card || userINFO.data.data.card),
                                        fans: Common.count(userINFO.data.data.follower),
                                        user_shortid: dynamicItem.host_mid,
                                        total_favorited: Common.count(userINFO.data.data.like_num),
                                        following_count: Common.count(userINFO.data.data.card.attention),
                                        render_time: Common.getCurrentTime(), dynamicTYPE: '纯文动态推送'
                                    }
                                )
                                break
                            }
                            /** 处理视频动态 */
                            case DynamicType.AV: {
                                if (dynamicItem.Dynamic_Data.modules.module_dynamic.major?.type === 'MAJOR_TYPE_ARCHIVE') {
                                    const bvid = dynamicItem.Dynamic_Data?.modules.module_dynamic.major?.archive?.bvid || ''
                                    const INFODATA = await this.amagi.bilibili.fetcher.fetchVideoInfo({ bvid: String(bvid), typeMode: 'strict' }).catch(() => null)

                                    if (!INFODATA?.data?.data) { skip = true; break; }
                                    if (INFODATA.data.data.redirect_url) {
                                        send_video = false
                                        logger.debug(`UP主：${INFODATA.data.data.owner.name} 的该动态类型为${logger.yellow('番剧或影视')}，默认跳过不下载，直达：${logger.green(INFODATA.data.data.redirect_url)}`)
                                    } else {
                                        // const noCkData = await getBilibiliData('单个视频下载信息数据', '', { avid: Number(aid), cid: INFODATA.data.data.cid, typeMode: 'strict' })
                                    }
                                    img = await Render('bilibili/dynamic/DYNAMIC_TYPE_AV',
                                        {
                                            image_url: [{ image_src: INFODATA.data.data.pic }], text: br(INFODATA.data.data.title),
                                            // 🚨 只保留视频本体简介
                                            desc: br(INFODATA.data.data.desc || "暂无简介"),
                                            dianzan: Common.count(INFODATA.data.data.stat.like),
                                            pinglun: Common.count(INFODATA.data.data.stat.reply),
                                            share: Common.count(INFODATA.data.data.stat.share),
                                            view: Common.count(dynamicItem.Dynamic_Data.modules.module_dynamic.major?.archive?.stat?.view || 0),
                                            coin: 0,
                                            duration_text: dynamicItem.Dynamic_Data.modules.module_dynamic.major?.archive?.duration_text || '0:00',
                                            create_time: Common.convertTimestampToDateTime(INFODATA.data.data.pubdate),
                                            avatar_url: INFODATA.data.data.owner.face,
                                            frame: dynamicItem.Dynamic_Data.modules.module_author.pendant.image,
                                            share_url: 'https://www.bilibili.com/video/' + bvid,
                                            username: checkvip(userINFO.data.data.card),
                                            fans: Common.count(userINFO.data.data.follower),
                                            user_shortid: dynamicItem.host_mid,
                                            total_favorited: Common.count(userINFO.data.data.like_num),
                                            following_count: Common.count(userINFO.data.data.card.attention),
                                            render_time: Common.getCurrentTime(), dynamicTYPE: '视频动态推送'
                                        }
                                    )
                                }
                                break
                            }
                            /** 处理直播动态 */
                            case DynamicType.LIVE_RCMD: {
                                const liveData = dynamicItem.Dynamic_Data.modules.module_dynamic.major?.live_rcmd?.content ? JSON.parse(dynamicItem.Dynamic_Data.modules.module_dynamic.major.live_rcmd.content) : { live_play_info: {} };
                                img = await Render('bilibili/dynamic/DYNAMIC_TYPE_LIVE_RCMD',
                                    {
                                        image_url: [{ image_src: liveData.live_play_info?.cover || '' }],
                                        text: br(liveData.live_play_info?.title || ''),
                                        liveinf: br(`${liveData.live_play_info?.area_name || ''} | 房间号: ${liveData.live_play_info?.room_id || ''}`),
                                        username: checkvip(userINFO?.data?.data?.card || { name: '获取失败', vip: {} }),
                                        avatar_url: userINFO?.data?.data?.card?.face || '',
                                        frame: dynamicItem.Dynamic_Data.modules.module_author.pendant?.image || '',
                                        fans: Common.count(userINFO?.data?.data?.follower || 0),
                                        create_time: Common.convertTimestampToDateTime(dynamicItem.Dynamic_Data.modules.module_author.pub_ts),
                                        now_time: Common.getCurrentTime(),
                                        share_url: 'https://live.bilibili.com/' + (liveData.live_play_info?.room_id || ''),
                                        dynamicTYPE: '直播动态推送'
                                    }
                                )
                                break
                            }
                            /** 处理转发动态 */
                            case DynamicType.FORWARD: {
                                // 🚨 核心修复：B站 V6 接口会在转发动态的 desc.text 尾部强行拼接原动态的全文！
                                // 我们通过顺序匹配 rich_text_nodes 算出 UP 主真正输入的文本长度，切掉后面的复读废话。
                                let descText = dynamicItem.Dynamic_Data.modules.module_dynamic.desc?.text || "";
                                const richNodes = dynamicItem.Dynamic_Data.modules.module_dynamic.desc?.rich_text_nodes || [];

                                if (descText && richNodes.length > 0) {
                                    let currentPos = 0;
                                    for (const node of richNodes) {
                                        const matchText = node.orig_text || node.text || "";
                                        if (!matchText) continue;
                                        const matchPos = descText.indexOf(matchText, currentPos);
                                        if (matchPos !== -1) {
                                            currentPos = matchPos + matchText.length;
                                        }
                                    }
                                    if (currentPos > 0) {
                                        descText = descText.substring(0, currentPos);
                                    }
                                }

                                const text = replacetext(br(descText), richNodes);
                                let param = {}
                                switch (dynamicItem.Dynamic_Data.orig.type) {
                                    case DynamicType.AV: {
                                        param = {
                                            username: checkvip(dynamicItem.Dynamic_Data.orig.modules.module_author),
                                            pub_action: dynamicItem.Dynamic_Data.orig.modules.module_author.pub_action,
                                            avatar_url: dynamicItem.Dynamic_Data.orig.modules.module_author.face,
                                            duration_text: dynamicItem.Dynamic_Data.orig.modules.module_dynamic.major.archive?.duration_text,
                                            title: dynamicItem.Dynamic_Data.orig.modules.module_dynamic.major.archive?.title,
                                            danmaku: dynamicItem.Dynamic_Data.orig.modules.module_dynamic.major.archive?.stat.danmaku,
                                            play: dynamicItem.Dynamic_Data.orig.modules.module_dynamic.major.archive?.stat.play,
                                            cover: dynamicItem.Dynamic_Data.orig.modules.module_dynamic.major.archive?.cover,
                                            create_time: Common.convertTimestampToDateTime(dynamicItem.Dynamic_Data.orig.modules.module_author.pub_ts),
                                            decoration_card: generateDecorationCard(dynamicItem.Dynamic_Data.orig.modules.module_author.decoration_card),
                                            frame: dynamicItem.Dynamic_Data.orig.modules.module_author.pendant.image
                                        }
                                        break
                                    }
                                    case DynamicType.DRAW: {
                                        const origPics = dynamicItem.Dynamic_Data.orig.modules.module_dynamic.major?.opus?.pics || [];
                                        const summary = dynamicItem.Dynamic_Data.orig.modules.module_dynamic.major?.opus?.summary;
                                        param = {
                                            username: checkvip(dynamicItem.Dynamic_Data.orig.modules.module_author),
                                            create_time: Common.convertTimestampToDateTime(dynamicItem.Dynamic_Data.orig.modules.module_author.pub_ts),
                                            avatar_url: dynamicItem.Dynamic_Data.orig.modules.module_author.face,
                                            text: replacetext(br(summary?.text || ''), summary?.rich_text_nodes || []),
                                            image_url: origPics.filter(item => item?.url).map(item => ({ image_src: item.url })),
                                            decoration_card: generateDecorationCard(dynamicItem.Dynamic_Data.orig.modules.module_author.decoration_card),
                                            frame: dynamicItem.Dynamic_Data.orig.modules.module_author.pendant?.image || ""
                                        }
                                        break
                                    }
                                    case DynamicType.WORD: {
                                        const summary = dynamicItem.Dynamic_Data.orig.modules.module_dynamic.major.opus.summary
                                        param = {
                                            username: checkvip(dynamicItem.Dynamic_Data.orig.modules.module_author),
                                            create_time: Common.convertTimestampToDateTime(dynamicItem.Dynamic_Data.orig.modules.module_author.pub_ts),
                                            avatar_url: dynamicItem.Dynamic_Data.orig.modules.module_author.face,
                                            text: replacetext(br(summary?.text || ''), summary?.rich_text_nodes || []),
                                            decoration_card: generateDecorationCard(dynamicItem.Dynamic_Data.orig.modules.module_author.decoration_card),
                                            frame: dynamicItem.Dynamic_Data.orig.modules.module_author.pendant.image
                                        }
                                        break
                                    }
                                    case DynamicType.LIVE_RCMD: {
                                        const liveData = JSON.parse(dynamicItem.Dynamic_Data.orig.modules.module_dynamic.major.live_rcmd.content)
                                        param = {
                                            username: checkvip(dynamicItem.Dynamic_Data.orig.modules.module_author),
                                            create_time: Common.convertTimestampToDateTime(dynamicItem.Dynamic_Data.orig.modules.module_author.pub_ts),
                                            avatar_url: dynamicItem.Dynamic_Data.orig.modules.module_author.face,
                                            decoration_card: generateDecorationCard(dynamicItem.Dynamic_Data.orig.modules.module_author.decoration_card),
                                            frame: dynamicItem.Dynamic_Data.orig.modules.module_author.pendant.image,
                                            cover: liveData.live_play_info.cover,
                                            text_large: liveData.live_play_info.watched_show.text_large,
                                            area_name: liveData.live_play_info.area_name,
                                            title: liveData.live_play_info.title,
                                            online: liveData.live_play_info.online
                                        }
                                        break
                                    }
                                    case DynamicType.FORWARD:
                                    default: {
                                        logger.warn(`UP主：${dynamicItem.remark}的${logger.green('转发动态')}转发的原动态类型为「${logger.yellow(dynamicItem.Dynamic_Data.orig.type)}」暂未支持解析`)
                                        break
                                    }
                                }
                                img = await Render('bilibili/dynamic/DYNAMIC_TYPE_FORWARD', {
                                    text,
                                    dianzan: Common.count(dynamicItem.Dynamic_Data.modules.module_stat.like.count),
                                    pinglun: Common.count(dynamicItem.Dynamic_Data.modules.module_stat.comment.count),
                                    share: Common.count(dynamicItem.Dynamic_Data.modules.module_stat.forward.count),
                                    create_time: dynamicItem.Dynamic_Data.modules.module_author.pub_time,
                                    avatar_url: dynamicItem.Dynamic_Data.modules.module_author.face,
                                    frame: dynamicItem.Dynamic_Data.modules.module_author.pendant.image,
                                    share_url: 'https://t.bilibili.com/' + dynamicItem.Dynamic_Data.id_str,
                                    username: checkvip(userINFO.data.data.card),
                                    fans: Common.count(userINFO.data.data.follower),
                                    user_shortid: dynamicItem.Dynamic_Data.modules.module_author.mid,
                                    total_favorited: Common.count(userINFO.data.data.like_num),
                                    following_count: Common.count(userINFO.data.data.card.attention),
                                    dynamicTYPE: '转发动态推送',
                                    decoration_card: generateDecorationCard(dynamicItem.Dynamic_Data.modules.module_author.decorate),
                                    render_time: Common.getCurrentTime(),
                                    original_content: { [dynamicItem.Dynamic_Data.orig.type]: param }
                                })
                                break
                            }
                            /** 未处理的动态类型 */
                            default: {
                                skip = true
                                logger.warn(`UP主：${dynamicItem.remark}「${dynamicItem.dynamic_type}」动态类型的暂未支持推送\n动态地址：${'https://t.bilibili.com/' + dynamicItem.Dynamic_Data.id_str}`)
                                break
                            }
                        }
                    }

                    if (!skip && (!img || img === false)) {
                        logger.warn(`[Bilibili Push] 动态${dynamicId}渲染图片失败/超时，取消推送并不写入数据库，等待下一次轮询重试`);
                        if (this.e && this.e.reply) await this.e.reply(`B站推送异常：动态${dynamicId}渲染图片失败/超时，取消推送并不写入数据库，等待下一次轮询重试`);
                        continue; // 直接跳出当前动态的处理，不进入下面的 targets 循环，也不触发 finally 记录 DB
                    }

                    // 🚨 新增：精准识别当前动态或被转发动态的媒体类型
                    let isVideo = false;
                    let isDraw = false;
                    let bvidToParse = '';
                    let picsToParse = [];

                    if (dynamicItem.dynamic_type === DynamicType.AV) {
                        isVideo = true;
                        bvidToParse = dynamicItem.Dynamic_Data?.modules?.module_dynamic?.major?.archive?.bvid || '';
                    } else if (dynamicItem.dynamic_type === DynamicType.DRAW) {
                        isDraw = true;
                        picsToParse = dynamicItem.Dynamic_Data?.modules?.module_dynamic?.major?.opus?.pics || [];
                    } else if (dynamicItem.dynamic_type === DynamicType.FORWARD) {
                        const origType = dynamicItem.Dynamic_Data?.orig?.type;
                        if (origType === DynamicType.AV) {
                            isVideo = true;
                            bvidToParse = dynamicItem.Dynamic_Data?.orig?.modules?.module_dynamic?.major?.archive?.bvid || '';
                        } else if (origType === DynamicType.DRAW) {
                            isDraw = true;
                            picsToParse = dynamicItem.Dynamic_Data?.orig?.modules?.module_dynamic?.major?.opus?.pics || [];
                        }
                    }

                    // 遍历目标数组，并发送消息
                    for (const target of dynamicItem.targets) {
                        try {
                            const { groupId, botId } = target
                            if (skip) {
                                await bilibiliDB?.addDynamicCache(
                                    dynamicId,
                                    dynamicItem.host_mid,
                                    groupId,
                                    dynamicItem.dynamic_type
                                )
                                continue
                            }

                            const group = Bot?.[botId]?.pickGroup(groupId)
                            if (!group) {
                                logger.warn(`bot${botId}不存在或群${groupId}不存在`)
                                continue
                            }

                            let status = { message_id: '' }
                            if (!skip) {
                                try {
                                    status = img && await Common.withTimeout(
                                        () => group.sendMsg(img),
                                        CARD_SEND_TIMEOUT,
                                        'B站动态卡片 sendMsg'
                                    )
                                } catch (sendError) {
                                    const errStr = JSON.stringify(sendError) + String(sendError)
                                    if (sendError?.code === 'ETIMEDOUT' || (errStr.toLowerCase().includes('timeout') && errStr.includes('sendMsg'))) {
                                        logger.warn(`[Bilibili Push] 动态${dynamicId}卡片发送超时，大概率已送达，写入去重缓存后继续处理`)
                                        status = { message_id: 'send_timeout' }
                                    } else {
                                        throw sendError
                                    }
                                }

                                if (!status?.message_id) {
                                    logger.warn(`[Bilibili Push] 动态卡片未返回 message_id，按已提交处理: ${dynamicId}`)
                                    status = { message_id: 'missing_result' }
                                }

                                // 卡片已提交后立即去重，避免附加媒体处理卡住后重复推送。
                                await bilibiliDB?.addDynamicCache(
                                    dynamicId,
                                    dynamicItem.host_mid,
                                    groupId,
                                    dynamicItem.dynamic_type
                                )

                                // ========================================================
                                // 🚨 核心修复：B站动态精细化向下解析（支持 UP 主专属配置覆盖全局配置）
                                let parseConfig = dynamicItem.parsedynamic !== undefined ? dynamicItem.parsedynamic : Config.bilibili?.push?.parsedynamic;
                                let parseVideo = Array.isArray(parseConfig) ? parseConfig.includes('视频') : (parseConfig === true);
                                let parseDraw = Array.isArray(parseConfig) ? parseConfig.includes('图文') : (parseConfig === true);

                                if ((parseVideo || parseDraw) && status.message_id && status.message_id !== '1') {

                                    // 1. 处理视频解析
                                    if (isVideo && parseVideo && bvidToParse) {
                                        try {
                                            logger.mark(`[Bilibili Push] 准备解析并推送视频: ${bvidToParse}`);
                                            const infoData = await this.amagi.bilibili.fetcher.fetchVideoInfo({ bvid: String(bvidToParse), typeMode: 'strict' }).catch(() => null);

                                            if (infoData?.data?.data) {
                                                const cid = infoData.data.data.cid;
                                                const aid = infoData.data.data.aid;
                                                const title = infoData.data.data.title.substring(0, 50).replace(/[\\/:*?"<>|\r\n\s]/g, ' ');

                                                // 获取极其轻量的 HTML5 DURL 直链，绕过 DASH 合成，专为 Push 打造的高速通道
                                                const { bilibiliApiUrls } = await import("@ikenxuan/amagi");
                                                const { Networks, downloadVideo } = await import('../../utils/index.js');

                                                const nockData = await new Networks({
                                                    url: bilibiliApiUrls.getVideoStream({ avid: aid, cid: cid }) + "&platform=html5",
                                                    headers: bilibiliBaseHeaders
                                                }).getData();

                                                let durlUrl = nockData?.data?.durl?.[0]?.url;
                                                if (durlUrl) {
                                                    // 无脑套上顶级 CDN 防火墙，防超时防拦截
                                                    durlUrl = durlUrl.replace(/^https?:\/\/[^\/]+/, 'https://upos-sz-mirrorhw.bilivideo.com');
                                                    logger.mark(`[Bilibili Push] 正在后台下载并发送 B站视频: ${title}.mp4 ...`);

                                                    await downloadVideo(this.e, {
                                                        video_url: durlUrl,
                                                        title: { timestampTitle: `tmp_${Date.now()}.mp4`, originTitle: `${title}.mp4` },
                                                        headers: { ...bilibiliBaseHeaders, Referer: "https://www.bilibili.com" }
                                                    }, { active: true, activeOption: { uin: botId, group_id: groupId } });
                                                    logger.mark(`[Bilibili Push] 视频 ${title}.mp4 下载并发送完毕！`);
                                                } else {
                                                    logger.warn(`[Bilibili Push] 获取视频流失败，可能为大会员限制`);
                                                }
                                            }
                                        } catch (error) {
                                            logger.error('[Bilibili Push] 视频流提取或发送失败:', error);
                                        }
                                    }

                                    // 2. 处理图集/图文解析
                                    else if (isDraw && parseDraw && picsToParse && picsToParse.length > 0) {
                                        try {
                                            logger.mark(`[Bilibili Push] 准备提取并推送无损图集...`);
                                            const imageres = [];
                                            for (const pic of picsToParse) {
                                                if (pic.url) imageres.push(segment.image(pic.url));
                                            }
                                            if (imageres.length > 0) {
                                                const forwardMsg = Version.BotName === 'Miao-Yunzai' ?
                                                    Bot?.makeForwardMsg(imageres.map(img => ({ user_id: 2854196310, message: img }))) :
                                                    common?.makeForwardMsg(Bot?.[botId], imageres, '作品图片');

                                                if (forwardMsg) {
                                                    await Common.withTimeout(
                                                        () => group.sendMsg(forwardMsg),
                                                        MEDIA_SEND_TIMEOUT,
                                                        'B站图集 sendMsg'
                                                    )
                                                }
                                                logger.mark(`[Bilibili Push] 提取图集已成功合并为转发消息发送！`);
                                            }
                                        } catch (error) {
                                            logger.error('[Bilibili Push] 图集提取失败:', error);
                                        }
                                    }
                                }
                                // ========================================================
                            }
                        } catch (error) {
                            // 将错误对象转为字符串以便检查
                            const errStr = JSON.stringify(error) + String(error)
                            // 拦截底层框架的假超时报错 (retcode 1200 或 NTEvent Timeout)
                            if (error?.code === 'ETIMEDOUT' || (errStr.toLowerCase().includes('timeout') && errStr.includes('sendMsg'))) {
                                logger.warn(`[Bilibili Push] 动态${dynamicId}的附加媒体发送超时，卡片已去重，不再重复推送`)
                            } else {
                                logger.error(`[Bilibili Push] 发送${dynamicId}失败:`, error)
                                if (this.e && this.e.reply) await this.e.reply(`B站推送异常：发送${dynamicId}失败:\n${error}`)
                            }
                        }
                    }
                } catch (innerError) {
                    logger.error(`[Bilibili Push] 动态 ${dynamicId} 处理崩溃 (渲染超时等)，跳过并不记录数据库，等待下轮重试:`, innerError);
                    if (this.e && this.e.reply) await this.e.reply(`B站推送异常：动态${dynamicId}处理崩溃 (渲染超时等)，跳过并不记录数据库，等待下轮重试:\n${innerError}`);
                    continue; // 发生异常直接跳过这条动态，继续处理下一个 UP 主
                }
            }
        } catch (error) {
            logger.error('[Bilibili Push] 推送动态列表总体失败', error);
            if (this.e && this.e.reply) await this.e.reply(`B站推送异常：推送动态列表总体失败\n${error}`);
            return false;
        }
        return true
    }

    /**
     * 根据配置文件获取UP当天的动态列表。
     * @param {bilibiliPushItem[]} userList - 用户列表
     * @returns {Promise<{willbepushlist: WillBePushList}>}
     */
    async getDynamicList(userList) {
        /** @type {WillBePushList} */
        const willbepushlist = {}

        try {
            /** 过滤掉不启用的订阅项 */
            const filteredUserList = userList.filter(item => item.switch !== false)
            for (const item of filteredUserList) {
                const dynamic_list = await this.amagi.bilibili.fetcher.fetchUserDynamicList({ host_mid: String(item.host_mid), typeMode: 'strict' }).catch(e => {
                    logger.error(`[Bilibili Push] 获取UP主 ${item.host_mid} 动态失败:`, e)
                    return null;
                })
                if (!dynamic_list?.data?.data?.items) continue
                if (dynamic_list.data.data.items.length > 0) {
                    // 遍历接口返回的视频列表
                    for (const dynamic of dynamic_list.data.data.items) {
                        const now = Date.now()
                        // 获取动态发布时间戳(毫秒)
                        const createTime = dynamic.modules.module_author.pub_ts * 1000
                        const timeDifference = (now - createTime)

                        const is_top = dynamic.modules.module_tag?.text === '置顶' // 是否为置顶
                        let shouldPush = false // 是否列入推送数组

                        const timeDiffSeconds = Math.round(timeDifference / 1000)
                        const timeDiffHours = Math.round((timeDifference / 1000 / 60 / 60) * 100) / 100 // 保留2位小数

                        // 条件判断，以下任何一项成立都将进行推送：如果是置顶且发布时间在一天内 || 如果是置顶作品且有新的群组且发布时间在一天内 || 如果有新的群组且发布时间在一天内
                        logger.debug(`
              前期获取该动态基本信息：
              UP主：${dynamic.modules.module_author.name}
              动态ID：${dynamic.id_str}
              发布时间：${Common.convertTimestampToDateTime(createTime / 1000)}
              发布时间戳（ms）：${createTime}
              当前时间戳（ms）：${now}
              时间差（ms）：${timeDifference} ms (${timeDiffSeconds}s) (${timeDiffHours}h)
              是否置顶：${is_top}
              是否在一天内：${timeDifference < 86400000 ? logger.green('true') : logger.red('false')}
              `)

                        if ((is_top && timeDifference < 86400000) || (timeDifference < 86400000)) {
                            shouldPush = true
                            logger.debug(logger.green(`根据以上判断，shoulPush 为 true，将对该动态纳入当天推送列表：https://t.bilibili.com/${dynamic.id_str}\n`))
                        } else {
                            logger.debug(logger.yellow(`根据以上判断，shoulPush 为 false，跳过该动态：https://t.bilibili.com/${dynamic.id_str}\n`))
                        }

                        // 如果 shouldPush 为 true，或该作品距现在的时间差小于一天，则将该动态添加到 willbepushlist 中
                        if (timeDifference < 86400000 || shouldPush) {
                            // 单个 UP 的 dynamicTypes 优先于全局配置；未设置时保持历史全推送行为
                            const dynamicTypes = item.dynamicTypes !== undefined
                                ? item.dynamicTypes
                                : Config.bilibili?.push?.dynamicTypes
                            if (!isBilibiliDynamicTypeEnabled(dynamic.type, dynamicTypes)) {
                                logger.debug(`[Bilibili Push] 已按类型配置跳过 ${item.remark || item.host_mid} 的${dynamicTypeNames[dynamic.type] || dynamic.type}动态：https://t.bilibili.com/${dynamic.id_str}`)
                                continue
                            }

                            // 将群组ID和机器人ID分离
                            const targets = item.group_id.map(groupWithBot => {
                                const [groupId, botId] = groupWithBot.split(':')
                                return { groupId: groupId || '', botId: botId || '' }
                            })

                            // 确保 willbepushlist[dynamic.id_str] 是一个对象
                            if (!willbepushlist[dynamic.id_str]) {
                                willbepushlist[dynamic.id_str] = {
                                    remark: item?.remark || dynamic.modules.module_author.name,
                                    host_mid: item.host_mid,
                                    create_time: dynamic.modules.module_author.pub_ts,
                                    targets,
                                    Dynamic_Data: dynamic, // 存储 dynamic 对象
                                    avatar_img: dynamic.modules.module_author.face,
                                    dynamic_type: dynamic.type,
                                    parsedynamic: item.parsedynamic
                                }
                            }
                        }
                    }
                } else {
                    logger.error(`「${item.remark}」的动态列表数量为零！`)
                }
            }
        } catch (error) {
            logger.error(error)
        }
        return { willbepushlist }
    }

    /**
     * 排除已推送过的群组并返回更新后的推送列表
     * @param {WillBePushList} willBePushList - 将要推送的列表
     * @returns {Promise<WillBePushList>} 更新后的推送列表
     */
    async excludeAlreadyPushed(willBePushList) {
        // 遍历推送列表中的作品ID
        for (const dynamicId in willBePushList) {
            const pushItem = willBePushList[dynamicId]
            if (!pushItem) continue
            const newTargets = []

            // 遍历作品对应的目标群组
            for (const target of pushItem.targets) {
                // 检查该动态是否已经推送给该群组
                const isPushed = await bilibiliDB?.isDynamicPushed(dynamicId, pushItem.host_mid, target.groupId)

                // 如果未被推送过，则保留此目标
                if (!isPushed) {
                    newTargets.push(target)
                }
            }

            // 更新作品的目标数组
            if (newTargets.length > 0) {
                pushItem.targets = newTargets
            } else {
                // 如果没有剩余目标，移除该作品
                delete willBePushList[dynamicId]
            }
        }

        return willBePushList
    }

    /**
     * 设置或更新特定 host_mid 的群组信息。
     * @param {BiliUserProfile} data - 包含 card 对象
     * @returns {Promise<void>}
     */
    async setting(data) {
        const host_mid = Number(data.data.card.mid)
        const config = Config.pushlist // 读取配置文件
        const groupId = this.e.group_id
        const botId = this.e.self_id

        // 初始化或确保 bilibilipushlist 数组存在
        config.bilibili = config.bilibili || []

        // 检查是否存在相同的 host_mid
        const existingItem = config.bilibili.find((item) => item.host_mid === host_mid)

        // 检查该群组是否已订阅该UP主
        const isSubscribed = await bilibiliDB?.isSubscribed(host_mid, groupId)

        if (existingItem) {
            // 使用 findIndex 替代循环，提高查找效率
            const groupIndex = existingItem.group_id.findIndex(item => {
                const existingGroupId = item?.split(':')[0] || ''
                return existingGroupId === String(groupId)
            })

            if (groupIndex >= 0) {
                // 删除订阅
                existingItem.group_id.splice(groupIndex, 1)

                // 顺序执行数据库操作和消息发送
                if (isSubscribed) {
                    await bilibiliDB?.unsubscribeBilibiliUser(groupId, host_mid)
                }
                await this.e.reply(`群：${this.e.group_name}(${groupId})\n删除成功！${data.data.card.name}\nUID：${host_mid}`)

                // 如果删除后 group_id 数组为空，则删除整个属性
                if (existingItem.group_id.length === 0) {
                    const index = config.bilibili.indexOf(existingItem)
                    config.bilibili.splice(index, 1)
                }
            } else {
                // 顺序执行数据库操作和消息发送
                await bilibiliDB?.subscribeBilibiliUser(groupId, botId, host_mid, data.data.card.name)
                await this.e.reply(`群：${this.e.group_name}(${groupId})\n添加成功！${data.data.card.name}\nUID：${host_mid}`)

                // 检查推送状态
                if (Config.bilibili?.push?.switch === false) {
                    await this.e.reply('请发送「#kkk设置B站推送开启」以进行推送')
                }

                existingItem.group_id.push(`${groupId}:${botId}`)
            }
        } else {
            // 顺序执行数据库操作和消息发送
            await bilibiliDB?.subscribeBilibiliUser(groupId, botId, host_mid, data.data.card.name)
            await this.e.reply(`群：${this.e.group_name}(${groupId})\n添加成功！${data.data.card.name}\nUID：${host_mid}`)

            // 检查推送状态
            if (Config.bilibili?.push?.switch === false) {
                await this.e.reply('请发送「#kkk设置B站推送开启」以进行推送')
            }

            // 不存在相同的 host_mid，新增一个配置项
            config.bilibili.push({
                switch: true,
                host_mid,
                group_id: [`${groupId}:${botId}`],
                remark: data.data.card.name
            })
        }

        // 顺序执行配置保存和渲染操作
        if (config.bilibili) {
            Config.modify('pushlist', 'bilibili', config.bilibili)
        }
        await this.renderPushList()
    }

    /**
     * 检查并更新配置文件中指定用户的备注信息。
     * 该函数会遍历配置文件中的用户列表，对于没有备注或备注为空的用户，会从外部数据源获取其备注信息，并更新到配置文件中。
     */
    async checkremark() {
        // 读取配置文件内容
        /** @type {import('../../utils/Config.js').PushlistConfig} */
        const config = Config.pushlist
        const abclist = []
        if (!Config.pushlist.bilibili || Config.pushlist.bilibili.length === 0) return true
        // 遍历配置文件中的用户列表，收集需要更新备注信息的用户
        for (const i of Config.pushlist.bilibili) {
            const remark = i.remark
            const group_id = i.group_id
            const host_mid = i.host_mid

            if (remark === undefined || remark === '') {
                abclist.push({ host_mid, group_id })
            }
        }

        // 如果有需要更新备注的用户，则逐个获取备注信息并更新到配置文件中
        if (abclist.length > 0) {
            for (const i of abclist) {
                // 从外部数据源获取用户备注信息
                const resp = await this.amagi.bilibili.fetcher.fetchUserCard({ host_mid: String(i.host_mid), typeMode: 'strict' }).catch(() => null)
                const remark = resp?.data?.data?.card?.name
                if (!remark) continue;
                // 在配置文件中找到对应的用户，并更新其备注信息
                const matchingItemIndex = config.bilibili?.findIndex(item => item.host_mid === i.host_mid) || 0
                if (matchingItemIndex !== -1 && config.bilibili && config.bilibili[matchingItemIndex]) {
                    config.bilibili[matchingItemIndex].remark = remark
                }
            }
            // 将更新后的配置文件内容写回文件
            if (config.bilibili) {
                Config.modify('pushlist', 'bilibili', config.bilibili)
            }
        }
        return true
    }

    /**
     * 强制推送
     * @param {WillBePushList} data - 处理完成的推送列表
     */
    async forcepush(data) {
        const currentGroupId = 'groupId' in this.e && this.e.groupId ? this.e.groupId : ''
        const currentBotId = this.e.selfId

        // 如果不是全部强制推送，需要过滤数据
        if (!this.e.msg.includes('全部')) {
            // 获取当前群组订阅的所有UP主
            const subscriptions = await bilibiliDB?.getGroupSubscriptions(currentGroupId)
            const subscribedUids = subscriptions?.map(sub => sub.host_mid) || []

            /** 创建一个新的推送列表，只包含当前群组订阅的UP主的动态 */
            /** @type {WillBePushList} */
            const filteredData = /** @type {WillBePushList} */ ({})

            for (const dynamicId in data) {
                // 检查该动态的UP主是否被当前群组订阅
                if (data[dynamicId] && subscribedUids.includes(data[dynamicId].host_mid)) {
                    // 复制该动态到过滤后的列表，并将目标设置为当前群组
                    filteredData[dynamicId] = {
                        ...data[dynamicId],
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

    /** 渲染推送列表图片 */
    async renderPushList() {
        await this.syncConfigToDatabase()
        // 获取当前群组的所有订阅
        const subscriptions = await bilibiliDB?.getGroupSubscriptions(this.e.group_id)

        if (!subscriptions || subscriptions.length === 0) {
            await this.e.reply(`当前群：${this.e.group_name}(${this.e.group_id})\n没有设置任何B站UP推送！\n可使用「#设置B站推送 + UP主UID」进行设置`)
            return
        }

        /** 用户的今日动态列表 */
        const renderOpt = []

        // 获取所有订阅UP主的信息
        for (const subscription of subscriptions) {
            const host_mid = subscription.host_mid
            const userInfo = await this.amagi.bilibili.fetcher.fetchUserCard({ host_mid: String(host_mid), typeMode: 'strict' }).catch(() => null)

            if (!userInfo?.data?.data?.card) continue;

            // 优先查找当前群的独立订阅项，避免同一 UP 在不同群使用不同推送类型时展示错误。
            const pushConfig = Config.pushlist.bilibili?.find(item =>
                item.host_mid === host_mid && item.group_id?.some(groupWithBot =>
                    String(groupWithBot).split(':')[0] === String(this.e.group_id)
                )
            )
            const pushEnabled = pushConfig?.switch !== false
            const dynamicTypes = pushConfig?.dynamicTypes !== undefined
                ? pushConfig.dynamicTypes
                : Config.bilibili?.push?.dynamicTypes

            renderOpt.push({
                avatar_img: userInfo.data.data.card.face,
                username: userInfo.data.data.card.name,
                host_mid: userInfo.data.data.card.mid,
                fans: Common.count(userInfo.data.data.follower),
                total_favorited: Common.count(userInfo.data.data.like_num),
                following_count: Common.count(userInfo.data.data.card.attention),
                push_enabled: pushEnabled,
                push_types: pushEnabled ? getEnabledBilibiliDynamicTypes(dynamicTypes) : [],
                push_status: pushEnabled ? '未开启任何类型' : '已关闭推送'
            })
        }

        const img = await Render('bilibili/userlist', { renderOpt })
        await this.e.reply(img)
    }

}

/**
 * 将换行符替换为HTML的<br>标签。
 * @param {string} data - 需要进行换行符替换的字符串
 * @returns {string} 替换后的字符串，其中的换行符\n被<br>替换
 */
function br(data) {
    // 使用正则表达式将所有换行符替换为<br>
    return (data = data.replace(/\n/g, '<br>'))
}

/**
 * 检查成员是否为VIP，并根据VIP状态改变其显示颜色。
 * @param {BiliUserProfile['data']['card'] | BiliUserDynamic['data']['items'][number]['orig']['modules']['module_author']} member - 成员对象，需要包含vip属性，该属性应包含vipStatus和nickname_color（可选）
 * @returns {string} 返回成员名称的HTML标签字符串，VIP成员将显示为特定颜色，非VIP成员显示为默认颜色
 */
function checkvip(member) {
    // 根据VIP状态选择不同的颜色显示成员名称
    return member.vip.status === 1
        ? `<span style="color: ${member.vip.nickname_color || '#FB7299'}; font-weight: 700;">${member.name}</span>`
        : `<span style="color: ${Common.useDarkTheme() ? '#EDEDED' : '#606060'}">${member.name}</span>`
}

/**
 * 处理并提取表情数据，返回一个包含表情名称和URL的对象数组。
 * @param {any[]} data - 表情数据的数组，每个元素包含一个表情包的信息
 * @returns {Array<{text: string, url: string}>} 返回一个对象数组，每个对象包含text(表情名称)和url(表情图片地址)属性
 */
const extractEmojisData = (data) => {
    return Array.isArray(data)
        ? data.flatMap(p => p?.emote || []).filter(e => e?.text && e?.url)
            .map(e => ({ text: String(e.text), url: String(e.url) }))
        : []
}

/**
 * 判断标题是否有屏蔽词或屏蔽标签
 * @param {BilibiliPushItem} PushItem - 推送项
 * @returns {Promise<boolean>} 是否应该跳过推送
 */
const skipDynamic = async (PushItem) => {
    const tags = [];
    let fullText = "";

    const dynamic = PushItem.Dynamic_Data.modules?.module_dynamic;
    if (!dynamic) return false;

    // 1. 提取当前动态的文本和标签（兼顾视频动态的 desc 和图文动态的 major.opus.summary）
    if (dynamic.desc) {
        fullText += dynamic.desc.text || "";
        if (dynamic.desc.rich_text_nodes) {
            for (const node of dynamic.desc.rich_text_nodes) {
                if (node.type === "topic" && node.orig_text) tags.push(node.orig_text);
            }
        }
    }

    if (dynamic.major?.opus?.summary) {
        fullText += "\n" + (dynamic.major.opus.summary.text || "");
        if (dynamic.major.opus.summary.rich_text_nodes) {
            for (const node of dynamic.major.opus.summary.rich_text_nodes) {
                if (node.type === "topic" && node.orig_text) tags.push(node.orig_text);
            }
        }
    }

    // 2. 提取转发的原动态文本和标签
    if (PushItem.Dynamic_Data.orig) {
        const origDynamic = PushItem.Dynamic_Data.orig.modules?.module_dynamic;

        if (origDynamic?.desc) {
            fullText += "\n" + (origDynamic.desc.text || "");
            if (origDynamic.desc.rich_text_nodes) {
                for (const node of origDynamic.desc.rich_text_nodes) {
                    if (node.type === "topic" && node.orig_text) tags.push(node.orig_text);
                }
            }
        }

        if (origDynamic?.major?.opus?.summary) {
            fullText += "\n" + (origDynamic.major.opus.summary.text || "");
            if (origDynamic.major.opus.summary.rich_text_nodes) {
                for (const node of origDynamic.major.opus.summary.rich_text_nodes) {
                    if (node.type === "topic" && node.orig_text) tags.push(node.orig_text);
                }
            }
        }
    }

    // 3. 终极防漏：把收集到的所有文本强行覆盖回 desc.text
    // 因为底层的 shouldFilter 过滤机制只读 desc.text，这样就能让它看见所有内容！
    if (!dynamic.desc) {
        dynamic.desc = { text: fullText, rich_text_nodes: [] };
    } else {
        dynamic.desc.text = fullText;
    }

    logger.debug(`检查动态是否需要过滤：https://t.bilibili.com/${PushItem.Dynamic_Data.id_str}`);
    const shouldFilter = await bilibiliDB.shouldFilter(PushItem, tags);
    return shouldFilter;
};
