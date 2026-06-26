import { Common, Config } from "../../utils/index.js"
// 🚨 核心修复 1：移除已被彻底废弃的 getBilibiliData，改为引入原生的 bilibiliFetcher
import { bilibiliFetcher } from "@ikenxuan/amagi"
import * as QRCode from "qrcode"
import fs from "node:fs"

/**
 * 处理哔哩哔哩登录流程
 * @param {*} e - 消息对象
 */
export const bilibiliLogin = async (e) => {
    // 🚨 动态嗅探 amagi v6+ 的 API 方法名，防止后续 SDK 瞎改名字导致暴毙
    const fetchQr = bilibiliFetcher.fetchLoginQrcode || bilibiliFetcher.fetchQrcode || bilibiliFetcher.requestLoginQrcode;

    /** 申请二维码 */
    // 🚨 核心修复 2：使用原生方法提取二维码数据
    const qrcodeurl = await fetchQr.call(bilibiliFetcher, { typeMode: "strict" }); // 获取二维码URL

    const qrimg = await QRCode.toDataURL(qrcodeurl.data.data.url) // 将二维码URL转换为base64图片
    const base64Data = qrimg ? qrimg.replace(/^data:image\/\w+;base64,/, '') : '' // 提取base64数据
    const buffer = Buffer.from(base64Data, 'base64') // 将base64数据转换为Buffer
    fs.writeFileSync(`${Common.tempDri.default}BilibiliLoginQrcode.png`, new Uint8Array(buffer)) // 将二维码图片保存到临时目录

    const qrcode_key = qrcodeurl.data.data.qrcode_key // 获取二维码的key
    /** @type {(string | number | undefined)[]} */
    const messageIds = [] // 存储消息ID的数组

    // 发送免责声明和二维码
    const disclaimerMsg = await e.reply('免责声明:\n您将通过扫码完成获取哔哩哔哩网页端的用户登录凭证（ck），该ck将用于请求哔哩哔哩WEB API接口。\n本BOT不会上传任何有关你的信息到第三方，所配置的 ck 只会用于请求官方 API 接口。\n我方仅提供视频解析及相关哔哩哔哩内容服务,若您的账号封禁、被盗等处罚与我方无关。\n害怕风险请勿扫码 ~') // 发送免责声明
    const qrcodeMsg = await e.reply([ // 发送二维码图片和提示文字
        segment.image(qrimg?.split(';')[1]?.replace('base64,', 'base64://') || ''),
        '请在120秒内通过哔哩哔哩APP扫码进行登录'
    ], true)

    messageIds.push(disclaimerMsg?.message_id, qrcodeMsg?.message_id) // 将消息ID存入数组

    /**
     * 批量撤回消息
     */
    const recallMessages = async () => {
        await Promise.all(messageIds.filter(id => id).map(async (id) => {
            try {
                await e.bot.recallMsg(e, id)
            } catch { }
        }))
    }

    /**
     * 处理登录成功
     * @param {import('@ikenxuan/amagi').ApiResponse<import('@ikenxuan/amagi').BiliCheckQrcode>} responseData - 登录响应数据
     */
    const handleLoginSuccess = async (responseData) => {
        // 🚨 核心修复：SDK 已屏蔽底层 Axios headers，改从官方返回的跨域 url 中直接精准提取核心 Cookie 字段
        const successUrl = responseData?.data?.data?.url || responseData?.data?.data?.data?.url || "";
        if (!successUrl) {
            await e.reply("登录数据提取失败，未找到跨域URL", true);
            return;
        }

        // 🚨 终极编码修复：B站 crossDomain URL 返回的 SESSDATA 含有未经编码的逗号和星号！
        // 但作为 HTTP Cookie 请求头发送时，B站服务器严格要求必须进行 URL 编码（%2C 和 %2A），否则直接打成游客！
        const rawSess = successUrl.match(/SESSDATA=([^&]+)/)?.[1] || "";
        // 先解码(防叠buff)再强制编码，最后把 JS 忽略的 * 强转为 %2A，确保绝对安全
        const SESSDATA = encodeURIComponent(decodeURIComponent(rawSess)).replace(/\*/g, "%2A");

        const bili_jct = successUrl.match(/bili_jct=([^&]+)/)?.[1] || "";
        const DedeUserID = successUrl.match(/DedeUserID=([^&]+)/)?.[1] || "";
        const DedeUserID__ckMd5 = successUrl.match(/DedeUserID__ckMd5=([^&]+)/)?.[1] || "";
        const sid = successUrl.match(/sid=([^&]+)/)?.[1] || "";

        // 组装标准 Cookie 字符串 (附带 sid 更稳定)
        const cookieStr = `SESSDATA=${SESSDATA}; bili_jct=${bili_jct}; DedeUserID=${DedeUserID}; DedeUserID__ckMd5=${DedeUserID__ckMd5}${sid ? `; sid=${sid}` : ""}`;

        Config.modify("cookies", "bilibili", cookieStr);
        await e.reply("登录成功！用户登录凭证已保存至cookies.yaml", true);
        await recallMessages();
    }

    /**
     * 处理二维码已扫描但未确认
     */
    const handleQrScanned = async () => {
        const scannedMsg = await e.reply('二维码已扫码，未确认', true)
        messageIds.push(scannedMsg?.message_id)

        // 撤回原二维码消息
        try {
            if (qrcodeMsg?.message_id) {
                await e.bot.recallMsg(e, qrcodeMsg.message_id)
            }
        } catch { }

        // 从消息ID列表中移除已撤回的消息
        const index = messageIds.indexOf(qrcodeMsg?.message_id)
        if (index > -1) {
            messageIds.splice(index, 1)
        }
    }

    /**
     * 处理二维码失效
     */
    const handleQrExpired = async () => {
        await e.reply('二维码已失效', true)
        await recallMessages()
    }

    /** 轮询二维码状态 */
    let hasScanned = false

    // 🚨 终极核武器：直接扫荡原型链寻找轮询(poll)方法，绝对不再漏网！
    const allKeys = [];
    for (let obj = bilibiliFetcher; obj; obj = Object.getPrototypeOf(obj)) {
        allKeys.push(...Object.getOwnPropertyNames(obj));
    }

    // 寻找包含 qrcode 和 poll 的方法名
    const pollKey = allKeys.find(k => /qrcode/i.test(k) && /poll/i.test(k))
        || allKeys.find(k => /qrcode/i.test(k) && /status|check/i.test(k))
        || allKeys.find(k => /poll/i.test(k));

    // 抓出真实方法，若实在没有则提供强力猜测兜底
    const fetchQrStatus = pollKey ? bilibiliFetcher[pollKey] : (bilibiliFetcher.fetchLoginQrcodePoll || bilibiliFetcher.fetchQrcodePoll);

    while (true) {
        try {
            if (!fetchQrStatus) throw new Error(`[amagi] 彻底找不到二维码轮询方法！可用方法: ${allKeys.slice(0, 15).join(", ")}...`);

            // 调用动态揪出来的准确方法
            const qrcodeStatusData = await fetchQrStatus.call(bilibiliFetcher, { qrcode_key, typeMode: "strict" });

            // 🚨 兼容层级：B站新老接口的 code 层级可能在 data.data 也有可能在 data.data.data
            const statusCode = qrcodeStatusData?.data?.data?.code ?? qrcodeStatusData?.data?.data?.data?.code;

            switch (statusCode) {
                case 0: // 登录成功
                    await handleLoginSuccess(qrcodeStatusData)
                    return

                case 86038: // 二维码失效
                    await handleQrExpired()
                    return

                case 86090: // 二维码已扫描，未确认
                    if (!hasScanned) {
                        await handleQrScanned()
                        hasScanned = true
                    }
                    break

                case 86101: // 未扫描
                default:
                    // 继续轮询
                    break
            }

            await Common.sleep(3000)
        } catch (error) {
            console.error('轮询二维码状态时发生错误:', error)
            await e.reply('登录过程中发生错误，请重试', true)
            await recallMessages()
            return
        }
    }
}
