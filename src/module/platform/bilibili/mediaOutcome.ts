/**
 * B站卡片送达后，「附加内容（视频/图集/专栏）是否真的发出去了」的判定与告警文案。
 *
 * 独立成文件是为了让判定脱离云崽运行时单测：这里不导入任何运行时依赖。
 *
 * 语义与抖音一致：卡片已经进群，附加内容失败只汇总告警、不重发卡片，
 * 也不把整条动态退回"未推送"状态（否则下一轮会把卡片再发一遍）。
 */

export interface BilibiliMissedMediaRecord {
  dynamicId: string
  dynamicType: string
  remark: string
  groupId: string
  reason: string
}

/**
 * B站附加视频的发送结果。
 *
 * - `delivered`：正常送达。
 * - `retry`：视频文件没生成（下载或合成失败）——抛回外层只记错误、保留页级进度，
 *   下一轮只重跑附加内容而不会重发卡片，符合「下载失败要重试」。
 * - `missed`：文件生成但上传未确认成功——卡片已送达，记漏发告警、写缓存不重推，
 *   与抖音同语义。
 */
export type BilibiliVideoOutcome = 'delivered' | 'retry' | 'missed'

/**
 * AV 动态的附加视频结果判定。
 *
 * @param generated 是否生成了可发送的视频文件（mp4 与 mp3 都下到并合成成功）
 * @param uploaded `uploadFile` 的结果；没走到上传时为 undefined
 */
export const resolveBilibiliVideoOutcome = (
  generated: boolean,
  uploaded: boolean | undefined
): { outcome: BilibiliVideoOutcome, reason: string } => {
  if (!generated) return { outcome: 'retry', reason: '视频文件未生成（下载或合成失败）' }
  if (uploaded !== true) return { outcome: 'missed', reason: '视频上传未确认成功' }
  return { outcome: 'delivered', reason: '' }
}

/** 动态类型 → 告警文案里的中文标签 */
const MEDIA_LABELS: Record<string, string> = {
  DYNAMIC_TYPE_AV: '视频',
  DYNAMIC_TYPE_DRAW: '图集',
  DYNAMIC_TYPE_ARTICLE: '专栏',
  DYNAMIC_TYPE_FORWARD: '转发内容'
}

/**
 * 汇总漏发记录成一条私聊文案。
 *
 * 同一轮多条漏发合并，最多列 5 条，超出只报总数；每条都带完整动态链接，
 * 便于直接点开核对（此前只给裸动态 ID）。
 */
export const buildBilibiliMissedMediaMessage = (records: BilibiliMissedMediaRecord[]): string => {
  const shown = records.slice(0, 5)
  const lines = shown.map(record =>
    `· ${record.remark} 的${MEDIA_LABELS[record.dynamicType] || '附加内容'} https://t.bilibili.com/${record.dynamicId}（群${record.groupId}）：${record.reason}`
  )
  if (records.length > shown.length) lines.push(`……等共 ${records.length} 条`)
  return [
    'B站动态推送有附加内容未发出（卡片已送达）',
    ...lines,
    '可检查机器人与上传日志；按策略不重发卡片，附加内容不补推。'
  ].join('\n')
}
