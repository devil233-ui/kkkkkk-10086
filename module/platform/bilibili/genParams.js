import * as amagi from "@ikenxuan/amagi"
import Config from "../../utils/Config.js"

/**
 * 计算请求参数
 * @param {string} apiURL 请求地址
 * @returns {Promise<string>}
 */
export async function genParams(apiURL) {
  if (Config.cookies.bilibili === "" || Config.cookies.bilibili === null) return "&platform=html5"
  
  let isvip = false;
  let genSign = "";
  
  try {
    // 🚨 替换为新版 API
    const loginInfo = await amagi.bilibiliFetcher.fetchUserNav({ typeMode: "strict" });
    isvip = loginInfo?.data?.data?.vipStatus === 1;
    
    // 🚨 兼容 Amagi v6 WBI 签名方法可能的重命名或移除，防止找不到函数直接崩溃
    const signFunc = amagi.wbi_sign || amagi.wbiSign || amagi.bilibiliFetcher?.wbiSign;
    if (typeof signFunc === "function") {
      genSign = await signFunc(apiURL, Config.cookies.bilibili || "");
    }
  } catch (error) {
    logger.error("[B站解析] 获取登录信息或生成签名失败", error);
  }

  const qn = [6, 16, 32, 64, 74, 80, 112, 116, 120, 125, 126, 127]
  if (isvip) {
    // 灵活拼接签名，如果提取失败则不拼
    return `&fnval=16&fourk=1${genSign ? "&" + genSign : ""}`
  } else return `&qn=${qn[3]}&fnval=16`
}

/**
 * 检查B站Cookie的有效性和VIP状态
 * 
 * 此函数通过调用B站API来验证Cookie的有效性，并检查用户的VIP状态。
 * 如果Cookie未配置或无效，将返回未登录状态。
 * 
 * @example
 * // 检查Cookie状态
 * const result = await checkCk();
 * console.log(result); // { Status: 'isLogin', isVIP: true }
 * 
 * @returns {Promise<{
 *   Status: '!isLogin' | 'isLogin';
 *   isVIP: boolean;
 * }>} 返回包含登录状态和VIP状态的对象
 * 
 * @property {string} Status - 登录状态，'!isLogin'表示未登录，'isLogin'表示已登录
 * @property {boolean} isVIP - VIP状态，true表示是VIP用户，false表示普通用户
 */
export async function checkCk() {
  // 如果Cookie为空或未配置，直接返回未登录状态
  if (Config.cookies.bilibili === "" || Config.cookies.bilibili === null) {
    return { Status: "!isLogin", isVIP: false }
  }

  try {
    // 🚨 替换为新版 API
    const loginInfo = await amagi.bilibiliFetcher.fetchUserNav({ typeMode: "strict" })

    // 只有明确返回 isLogin === true 才算真正有效
    if (loginInfo?.data?.data?.isLogin) {
      const isVIP = loginInfo.data.data.vipStatus === 1
      return { Status: "isLogin", isVIP }
    }
    
    return { Status: "!isLogin", isVIP: false }
  } catch (error) {
    return { Status: "!isLogin", isVIP: false }
  }
}