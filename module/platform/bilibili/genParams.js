import { wbi_sign } from '@ikenxuan/amagi'
import { getBilibiliData } from './api.js'
import Config from '../../utils/Config.js'

/**
 * 计算请求参数
 * @param {string} apiURL 请求地址
 * @returns {Promise<string>}
 */
export async function genParams(apiURL) {
  if (Config.cookies.bilibili === '' || Config.cookies.bilibili === null) return '&platform=html5'
  const loginInfo = await getBilibiliData('登录基本信息', Config.cookies.bilibili)
  const genSign = await wbi_sign(apiURL, Config.cookies.bilibili || '')

  const qn = [6, 16, 32, 64, 74, 80, 112, 116, 120, 125, 126, 127]
  if (loginInfo?.data?.data?.vipStatus === 1) {
    return `&fnval=16&fourk=1&${genSign}`
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
  if (Config.cookies.bilibili === '' || Config.cookies.bilibili === null) {
    return { Status: '!isLogin', isVIP: false }
  }

  const loginInfo = await getBilibiliData('登录基本信息', Config.cookies.bilibili || '')
  if (!loginInfo?.data?.data?.isLogin) return { Status: '!isLogin', isVIP: false }

  return {
    Status: 'isLogin',
    isVIP: loginInfo.data.data.vipStatus === 1
  }
}
