/**
 * amagi v7 的中文名 → fetcher 方法映射表（内联自 amagi 6.5.0 顶层导出）。
 *
 * amagi 7.0 起删除了 `DouyinMethodToFetcher` / `BilibiliMethodToFetcher` /
 * `XiaohongshuMethodToFetcher` / `KuaishouMethodToFetcher` 顶层导出，且没有提供
 * 替代映射；插件内部调用一直使用旧中文方法名，因此把 6.5.0 的映射表原样内联到
 * 这里维护。若上游将来重新导出映射，可改回直取。
 *
 * 6.5.0 实测导出内容（2026-10-12 从 node_modules 实装版本逐条导出）。
 */

export const DouyinMethodToFetcher: Record<string, string> = {
  视频作品数据: 'fetchVideoWork',
  图集作品数据: 'fetchImageAlbumWork',
  合辑作品数据: 'fetchSlidesWork',
  文字作品数据: 'fetchTextWork',
  聚合解析: 'parseWork',
  弹幕数据: 'fetchDanmakuList',
  评论数据: 'fetchWorkComments',
  指定评论回复数据: 'fetchCommentReplies',
  用户主页数据: 'fetchUserProfile',
  用户主页视频列表数据: 'fetchUserVideoList',
  搜索数据: 'searchContent',
  热点词数据: 'fetchSuggestWords',
  音乐数据: 'fetchMusicInfo',
  直播间信息数据: 'fetchLiveRoomInfo',
  申请二维码数据: 'requestLoginQrcode',
  Emoji数据: 'fetchEmojiList',
  动态表情数据: 'fetchDynamicEmojiList'
}

export const BilibiliMethodToFetcher: Record<string, string> = {
  单个视频作品数据: 'fetchVideoInfo',
  单个视频下载信息数据: 'fetchVideoStreamUrl',
  实时弹幕: 'fetchVideoDanmaku',
  评论数据: 'fetchComments',
  指定评论的回复: 'fetchCommentReplies',
  用户主页数据: 'fetchUserCard',
  用户主页动态列表数据: 'fetchUserDynamicList',
  用户直播状态: 'fetchUserLiveStatus',
  用户空间详细信息: 'fetchUserSpaceInfo',
  获取UP主总播放量: 'fetchUploaderTotalViews',
  动态详情数据: 'fetchDynamicDetail',
  番剧基本信息数据: 'fetchBangumiInfo',
  番剧下载信息数据: 'fetchBangumiStreamUrl',
  直播间信息: 'fetchLiveRoomInfo',
  直播间初始化信息: 'fetchLiveRoomInitInfo',
  专栏正文内容: 'fetchArticleContent',
  专栏显示卡片信息: 'fetchArticleCards',
  专栏文章基本信息: 'fetchArticleInfo',
  文集基本信息: 'fetchArticleListInfo',
  登录基本信息: 'fetchLoginStatus',
  申请二维码: 'requestLoginQrcode',
  二维码状态: 'checkQrcodeStatus',
  从_v_voucher_申请_captcha: 'requestCaptchaFromVoucher',
  验证验证码结果: 'validateCaptchaResult',
  AV转BV: 'convertAvToBv',
  BV转AV: 'convertBvToAv',
  Emoji数据: 'fetchEmojiList'
}

export const XiaohongshuMethodToFetcher: Record<string, string> = {
  首页推荐数据: 'fetchHomeFeed',
  单个笔记数据: 'fetchNoteDetail',
  评论数据: 'fetchNoteComments',
  用户数据: 'fetchUserProfile',
  用户笔记数据: 'fetchUserNoteList',
  搜索笔记: 'searchNotes',
  表情列表: 'fetchEmojiList'
}

export const KuaishouMethodToFetcher: Record<string, string> = {
  单个视频作品数据: 'fetchVideoWork',
  评论数据: 'fetchWorkComments',
  用户主页数据: 'fetchUserProfile',
  用户作品列表数据: 'fetchUserWorkList',
  直播间信息数据: 'fetchLiveRoomInfo',
  Emoji数据: 'fetchEmojiList'
}

/**
 * B站平台错误码 → 用户可读文案（内联自 amagi 6.5.0 的 `bilibiliErrorCodeMap`，
 * 51 条）。amagi 7.0 删除了该导出；Base 的错误卡片仍按 code 展示中文说明。
 */
export const bilibiliErrorCodeMap: Record<string, string> = {
  '100000': '验证码获取失败',
  '100003': '验证码过期',
  '-1': '应用程序不存在或已被封禁',
  '-2': 'Access Key 错误',
  '-3': 'API 校验密匙错误',
  '-4': '调用方对该 Method 没有权限',
  '-101': '账号未登录',
  '-102': '账号被封停',
  '-103': '积分不足',
  '-104': '硬币不足',
  '-105': '验证码错误',
  '-106': '账号非正式会员或在适应期',
  '-107': '应用不存在或者被封禁',
  '-108': '未绑定手机',
  '-110': '未绑定手机',
  '-111': 'csrf 校验失败',
  '-112': '系统升级中',
  '-113': '账号尚未实名认证',
  '-114': '请先绑定手机',
  '-115': '请先完成实名认证',
  '-304': '木有改动',
  '-307': '撞车跳转',
  '-352': '风控校验失败 (UA 或 wbi 参数不合法)',
  '-400': '请求错误',
  '-401': '未认证 (或非法请求)',
  '-403': '访问权限不足',
  '-404': '啥都木有',
  '-405': '不支持该方法',
  '-409': '冲突',
  '-412': '请求被拦截 (客户端 ip 被服务端风控)',
  '-500': '服务器错误',
  '-503': '过载保护,服务暂不可用',
  '-504': '服务调用超时',
  '-509': '超出限制',
  '-616': '上传文件不存在',
  '-617': '上传文件太大',
  '-625': '登录失败次数太多',
  '-626': '用户不存在',
  '-628': '密码太弱',
  '-629': '用户名或密码错误',
  '-632': '操作对象数量限制',
  '-643': '被锁定',
  '-650': '用户等级太低',
  '-652': '重复的用户',
  '-658': 'Token 过期',
  '-662': '密码时间戳过期',
  '-688': '地理区域限制',
  '-689': '版权限制',
  '-701': '扣节操失败',
  '-799': '请求过于频繁，请稍后再试',
  '-8888': '对不起，服务器开小差了~ (ಥ﹏ಥ)'
}
