import fs from 'node:fs'
import { join } from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import _ from 'lodash'
import YAML from 'yaml'
import hostConfig from '@/runtime/host/config'
import type {
  AmagiConfig,
  AppConfig,
  BilibiliConfig,
  ConfigName,
  ConfigSource,
  CookiesConfig,
  DouyinConfig,
  KuaishouConfig,
  PluginConfigMap,
  PushlistConfig,
  RequestConfig,
  UploadConfig,
  XiaohongshuConfig
} from '@/types/config'
import YamlReader from './YamlReader.js'
import Version from './Version.js'
import { normalizeCookieValue } from './cookie.js'

export type {
  BilibiliPushItem,
  PushlistConfig,
  DouyinPushItem
} from '@/types/config'
export type {
  DouyinPushItem as douyinPushItem,
  BilibiliPushItem as bilibiliPushItem
} from '@/types/config'

const APP_UPLOAD_KEYS = new Set([
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
])

const CONFIG_NAMES: ConfigName[] = [
  'app',
  'bilibili',
  'cookies',
  'douyin',
  'kuaishou',
  'pushlist',
  'request',
  'upload',
  'xiaohongshu'
]

interface FilterItem {
  switch?: boolean
  filterMode?: 'blacklist' | 'whitelist'
  Keywords?: string[]
  Tags?: string[]
}

interface FilterDatabase<TId extends string | number> {
  updateFilterMode?: (id: TId, mode: 'blacklist' | 'whitelist') => Promise<unknown>
  getFilterWords?: (id: TId) => Promise<string[] | undefined>
  removeFilterWord?: (id: TId, word: string) => Promise<unknown>
  addFilterWord?: (id: TId, word: string) => Promise<unknown>
  getFilterTags?: (id: TId) => Promise<string[] | undefined>
  removeFilterTag?: (id: TId, tag: string) => Promise<unknown>
  addFilterTag?: (id: TId, tag: string) => Promise<unknown>
}

type CompleteConfig = Partial<PluginConfigMap> & {
  app?: AppConfig & UploadConfig
  amagi: AmagiConfig
}

type ConfigService = PluginConfigMap & {
  amagi: AmagiConfig
  All: Cfg['All']
  modify: Cfg['modify']
  ModifyPro: Cfg['ModifyPro']
  saveGuobaConfig: Cfg['saveGuobaConfig']
  /** 运行时的 Proxy 会转发这个方法，业务代码里以 `Config.getConfig?.(name)` 的形式调用 */
  getConfig: Cfg['getConfig']
  syncConfigToDatabase: Cfg['syncConfigToDatabase']
  initCfg: Cfg['initCfg']
}

export class Cfg {
  readonly pluginRoot: string
  config: Record<string, unknown> = {}
  watcher: Record<string, FSWatcher> = {}
  reloadTimers: Record<string, NodeJS.Timeout> = {}
  pushlistWarningAt = 0

  constructor (pluginRoot = Version.pluginPath) {
    this.pluginRoot = pluginRoot
  }

  initCfg (): this {
    const userPath = this.configDirectory('config')
    const defaultPath = this.configDirectory('default_config')
    if (!fs.existsSync(userPath)) fs.mkdirSync(userPath, { recursive: true })
    const files = fs.readdirSync(defaultPath).filter(file => file.endsWith('.yaml'))

    for (const file of files) {
      const userFile = join(userPath, file)
      const defaultFile = join(defaultPath, file)
      const name = file.slice(0, -'.yaml'.length)
      if (!isConfigName(name)) continue

      if (!fs.existsSync(userFile)) {
        fs.copyFileSync(defaultFile, userFile)
      } else {
        const configResult = this.parseYamlRecordResult(userFile)
        if (!configResult.valid) {
          this.watch(userFile, name, 'config')
          continue
        }
        const defConfigResult = this.parseYamlRecordResult(defaultFile)
        if (!defConfigResult.valid) {
          this.watch(userFile, name, 'config')
          continue
        }
        const { differences, result } = this.mergeObjectsWithPriority(configResult.value, defConfigResult.value)
        if (differences) this.writeMergedConfig(defaultFile, userFile, result)
      }
      this.watch(userFile, name, 'config')
    }
    return this
  }

  get app (): AppConfig {
    return this.getDefOrConfig('app')
  }

  get cookies (): CookiesConfig {
    const raw = this.getDefOrConfig('cookies') as unknown as Record<string, unknown>
    return {
      bilibili: normalizeCookieValue(raw.bilibili),
      douyin: normalizeCookieValue(raw.douyin),
      kuaishou: normalizeCookieValue(raw.kuaishou),
      xiaohongshu: normalizeCookieValue(raw.xiaohongshu)
    }
  }

  get douyin (): DouyinConfig {
    return this.getDefOrConfig('douyin')
  }

  get bilibili (): BilibiliConfig {
    return this.getDefOrConfig('bilibili')
  }

  get pushlist (): PushlistConfig {
    return this.getDefOrConfig('pushlist')
  }

  get kuaishou (): KuaishouConfig {
    return this.getDefOrConfig('kuaishou')
  }

  get xiaohongshu (): XiaohongshuConfig {
    return this.getDefOrConfig('xiaohongshu')
  }

  get request (): RequestConfig {
    return this.getDefOrConfig('request')
  }

  get upload (): UploadConfig {
    return this.getDefOrConfig('upload')
  }

  get amagi (): AmagiConfig {
    const request = this.request
    const app = this.app
    return {
      timeout: request.timeout,
      'User-Agent': request['User-Agent'],
      proxy: request.proxy,
      cookies: this.cookies,
      APIServer: app.APIServer,
      APIServerMount: app.APIServerMount,
      APIServerPort: app.APIServerPort
    }
  }

  async All (): Promise<CompleteConfig> {
    const rawConfig: Record<string, unknown> = {}
    const files = fs.readdirSync(this.configDirectory('default_config')).filter(file => file.endsWith('.yaml'))

    for (const file of files) {
      const name = file.slice(0, -'.yaml'.length)
      if (isConfigName(name)) rawConfig[name] = this.getDefOrConfig(name)
    }

    const config = rawConfig as Partial<PluginConfigMap>
    if (config.pushlist) {
      const { getDouyinDB, getBilibiliDB } = await import('@/module/db/index')
      const douyinDB = await getDouyinDB()
      const bilibiliDB = await getBilibiliDB()
      try {
        if (config.pushlist.douyin) {
          for (const item of config.pushlist.douyin) {
            const filterWords = await callLegacyLookup<string[]>(douyinDB, douyinDB?.getFilterWords, item.sec_uid)
            const filterTags = await callLegacyLookup<string[]>(douyinDB, douyinDB?.getFilterTags, item.sec_uid)
            const userInfo = await callLegacyLookup<{ filterMode?: 'blacklist' | 'whitelist' }>(
              douyinDB,
              douyinDB?.getDouyinUser,
              item.sec_uid
            )
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
            if (userInfo) item.filterMode = userInfo.filterMode || 'blacklist'
            item.Keywords = filterWords
            item.Tags = filterTags
          }
        }
      } catch (error: unknown) {
        logger.error(`从数据库获取过滤配置时出错: ${String(error)}`)
      }
    }

    const result: CompleteConfig = { ...config, amagi: this.amagi }
    if (config.app && config.upload) {
      result.app = {
        ...config.app,
        ...config.upload,
        videoSendMode: config.upload.videoSendMode || (config.upload.sendbase64 ? 'base64' : 'file')
      }
    }
    return result
  }

  getDefOrConfig<K extends ConfigName> (name: K): PluginConfigMap[K] {
    return { ...this.getdefSet(name), ...this.getConfig(name) }
  }

  getdefSet<K extends ConfigName> (name: K): PluginConfigMap[K] {
    return this.getYaml('default_config', name) as unknown as PluginConfigMap[K]
  }

  getConfig<K extends ConfigName> (name: K): Partial<PluginConfigMap[K]> {
    return this.getYaml('config', name) as Partial<PluginConfigMap[K]>
  }

  getYaml (type: ConfigSource, name: ConfigName): Record<string, unknown> {
    const file = this.configFile(type, name)
    const key = `${type}.${name}`
    const cached = this.config[key]
    if (isRecord(cached)) return cached

    let value: Record<string, unknown> = {}
    if (fs.existsSync(file)) value = this.parseYamlRecord(file)
    this.config[key] = value
    this.watch(file, name, type)
    return value
  }

  watch (file: string, name: ConfigName, type: ConfigSource = 'default_config'): void {
    const key = `${type}.${name}`
    if (this.watcher[key]) return

    const watcher = chokidar.watch(file, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 50 }
    })
    const scheduleReload = (): void => {
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
    watcher.on('error', (error: unknown) => {
      logger.error(`[Config] 配置文件监听出错，${name}.yaml 的热重载可能已失效:`, error)
    })
    this.watcher[key] = watcher
  }

  modify<K extends ConfigName> (name: K, key: string, value: unknown, type: ConfigSource = 'config'): boolean {
    const success = new YamlReader(this.configFile(type, name)).set(key, value)
    if (success) delete this.config[`${type}.${name}`]
    return success
  }

  ModifyPro (name: ConfigName | 'amagi', value: Record<string, unknown>, type: ConfigSource = 'config'): boolean {
    if (!isRecord(value)) return false
    if (name === 'amagi') {
      if ('timeout' in value) this.modify('request', 'timeout', value.timeout, type)
      if ('User-Agent' in value) this.modify('request', 'User-Agent', value['User-Agent'], type)
      if ('proxy' in value) this.modify('request', 'proxy', value.proxy, type)
      if (isRecord(value.cookies)) this.ModifyPro('cookies', value.cookies, type)
      if ('APIServer' in value) this.modify('app', 'APIServer', value.APIServer, type)
      if ('APIServerMount' in value) this.modify('app', 'APIServerMount', value.APIServerMount, type)
      if ('APIServerPort' in value) this.modify('app', 'APIServerPort', value.APIServerPort, type)
      return true
    }

    if (name === 'app') {
      const appValue: Record<string, unknown> = {}
      const uploadValue: Record<string, unknown> = {}
      for (const [key, item] of Object.entries(value)) {
        if (APP_UPLOAD_KEYS.has(key)) uploadValue[key] = item
        else appValue[key] = item
      }
      if ('videoSendMode' in uploadValue) uploadValue.sendbase64 = uploadValue.videoSendMode === 'base64'
      const appSuccess = Object.keys(appValue).length ? this.writeModuleConfig('app', appValue, type) : true
      const uploadSuccess = Object.keys(uploadValue).length ? this.writeModuleConfig('upload', uploadValue, type) : true
      return appSuccess && uploadSuccess
    }

    return this.writeModuleConfig(name, value, type)
  }

  /** 保存锅巴白名单配置，并在同一次原子写入中清理已知废弃键。 */
  saveGuobaConfig (
    name: ConfigName,
    value: Record<string, unknown>,
    deprecatedKeys: string[] = [],
    type: ConfigSource = 'config'
  ): boolean {
    if (!isRecord(value)) return false
    const file = this.configFile(type, name)
    if (!fs.existsSync(file)) return false

    const reader = new YamlReader(file)
    for (const [key, item] of Object.entries(value)) reader.document.set(key, item)
    for (const key of deprecatedKeys) deleteDocumentPath(reader.document, key)

    const success = reader.write()
    if (success) delete this.config[`${type}.${name}`]
    return success
  }

  async syncPushlistToDatabase (): Promise<void> {
    const { getDouyinDB, getBilibiliDB } = await import('@/module/db/index')
    try {
      const pushlistConfig = this.getDefOrConfig('pushlist')
      if (pushlistConfig.douyin) {
        await this.syncFilterConfigToDb(pushlistConfig.douyin, await getDouyinDB(), 'sec_uid')
      }
      if (pushlistConfig.bilibili) {
        await this.syncFilterConfigToDb(pushlistConfig.bilibili, await getBilibiliDB(), 'host_mid')
      }
      logger.info('[Config] pushlist的过滤配置已同步到数据库')
    } catch (error: unknown) {
      logger.error('[Config] 同步pushlist配置到数据库失败:', error)
      throw error
    }
  }

  async syncFilterConfigToDb<
    TItem extends FilterItem,
    TId extends string | number
  > (
    items: TItem[],
    db: FilterDatabase<TId> | null | undefined,
    idField: keyof TItem
  ): Promise<void> {
    for (const item of items) {
      if (!item.switch) continue
      const rawId = item[idField]
      if (!rawId || (typeof rawId !== 'string' && typeof rawId !== 'number')) continue
      const id = rawId as TId

      if (item.filterMode !== undefined) await db?.updateFilterMode?.(id, item.filterMode)
      const configWords = item.Keywords || []
      const existingWords = await db?.getFilterWords?.(id)
      for (const word of existingWords || []) {
        if (!configWords.includes(word)) await db?.removeFilterWord?.(id, word)
      }
      for (const word of configWords) {
        if (!existingWords?.includes(word)) await db?.addFilterWord?.(id, word)
      }

      const configTags = item.Tags || []
      const existingTags = await db?.getFilterTags?.(id)
      for (const tag of existingTags || []) {
        if (!configTags.includes(tag)) await db?.removeFilterTag?.(id, tag)
      }
      for (const tag of configTags) {
        if (!existingTags?.includes(tag)) await db?.addFilterTag?.(id, tag)
      }
    }
  }

  mergeObjectsWithPriority (objA: Record<string, unknown>, objB: Record<string, unknown>): {
    differences: boolean
    result: Record<string, unknown>
  } {
    let differences = false
    const customizer = (objValue: unknown, srcValue: unknown): unknown => {
      if (_.isArray(objValue) && _.isArray(srcValue)) return objValue
      if (_.isPlainObject(objValue) && _.isPlainObject(srcValue)) {
        if (!_.isEqual(objValue, srcValue)) {
          return _.mergeWith(_.cloneDeep(objValue), srcValue, customizer) as unknown
        }
      } else if (!_.isEqual(objValue, srcValue)) {
        differences = true
        return objValue !== undefined ? objValue : srcValue
      }
      return objValue !== undefined ? objValue : srcValue
    }
    const result = _.mergeWith(_.cloneDeep(objA), objB, customizer) as Record<string, unknown>
    return { differences, result }
  }

  async syncConfigToDatabase (): Promise<void> {
    try {
      const pushCfg = this.getDefOrConfig('pushlist')
      const { getDouyinDB, getBilibiliDB } = await import('@/module/db/index')
      const douyinDB = await getDouyinDB()
      const bilibiliDB = await getBilibiliDB()
      if (pushCfg.bilibili) await bilibiliDB?.syncConfigSubscriptions(pushCfg.bilibili)
      if (pushCfg.douyin) await douyinDB?.syncConfigSubscriptions(pushCfg.douyin)
      logger.debug('[BilibiliDB] + [DouyinDB] 配置已同步到数据库')
    } catch (error: unknown) {
      logger.error('同步配置到数据库失败:', error)
    }
  }

  /** 在配置文件短暂不可读时保留上一份有效配置，并给主人发送限频告警。 */
  private async notifyPushlistConfigIssue (): Promise<void> {
    if (Date.now() - this.pushlistWarningAt < 60 * 60 * 1000) return

    const runtimeConfig = hostConfig as { masterQQ?: Array<string | number>, master?: Array<string | number> }
    const globalScope = globalThis as unknown as {
      BotConfig?: { master?: { user?: Array<string | number> } | Array<string | number>, masterQQ?: Array<string | number> }
      Bot?: Record<string, { pickFriend?: (userId: string | number) => { sendMsg?: (message: unknown) => Promise<unknown> } | undefined }>
    }
    const rawMasters = runtimeConfig.masterQQ || runtimeConfig.master ||
      globalScope.BotConfig?.masterQQ ||
      (Array.isArray(globalScope.BotConfig?.master) ? globalScope.BotConfig.master : globalScope.BotConfig?.master?.user) || []
    const masters = (Array.isArray(rawMasters) ? rawMasters : [rawMasters]).filter(Boolean)
    const bots = Object.values(globalScope.Bot || {})
    const message = '⚠️kkkkkk-10086推送配置异常\npushlist.yaml 重载时为空、缺失或格式错误。为避免漏推送，当前进程继续使用上一份有效配置；请检查配置文件。'

    if (!masters.length || !bots.length) {
      logger.warn('[Config] 无法向主人发送推送配置异常通知：主人或机器人不存在')
      return
    }

    const sent = new Set<string>()
    for (const master of masters) {
      for (const bot of bots) {
        const target = bot.pickFriend?.(master)
        if (!target?.sendMsg) continue
        try {
          await target.sendMsg(message)
          sent.add(String(master))
          break
        } catch (error: unknown) {
          logger.warn(`[Config] 推送配置异常主人通知发送失败：${master}：${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    if (sent.size > 0) this.pushlistWarningAt = Date.now()
  }

  private async reloadConfig (
    file: string,
    name: ConfigName,
    type: ConfigSource,
    key: string
  ): Promise<void> {
    const parsed = this.parseYamlRecordResult(file)
    if (!parsed.valid) {
      logger.warn(`[Config] 配置文件暂不可用: ${file}，继续使用上一份有效配置`)
      if (name === 'pushlist' && type === 'config') await this.notifyPushlistConfigIssue()
      return
    }

    this.config[key] = parsed.value
    logger.mark(`[${Version.pluginName}][修改配置文件][${type}][${name}]`)
    if (name !== 'pushlist' || type !== 'config') return

    try {
      await this.syncPushlistToDatabase()
    } catch (error: unknown) {
      logger.error('[Config] 文件监听同步数据库失败:', error)
    } finally {
      await this.syncConfigToDatabase()
    }
  }

  private writeMergedConfig (
    defaultFile: string,
    configFile: string,
    config: Record<string, unknown>
  ): void {
    const document = YAML.parseDocument(fs.readFileSync(defaultFile, 'utf8'))
    for (const [key, value] of Object.entries(config)) document.set(key, value)
    const tempFile = `${configFile}.${process.pid}.${Date.now()}.tmp`
    try {
      fs.writeFileSync(tempFile, document.toString({ lineWidth: -1, simpleKeys: true }), 'utf8')
      fs.renameSync(tempFile, configFile)
    } catch (error: unknown) {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile)
      throw error
    }
  }

  private configDirectory (type: ConfigSource): string {
    return join(this.pluginRoot, 'config', type)
  }

  private configFile (type: ConfigSource, name: ConfigName): string {
    return join(this.configDirectory(type), `${name}.yaml`)
  }

  private parseYamlRecord (file: string): Record<string, unknown> {
    return this.parseYamlRecordResult(file).value
  }

  private parseYamlRecordResult (file: string): {
    valid: boolean
    value: Record<string, unknown>
  } {
    try {
      const value: unknown = YAML.parse(fs.readFileSync(file, 'utf8'))
      if (!isRecord(value)) throw new TypeError('YAML root must be a non-array record')
      return { valid: true, value }
    } catch (error: unknown) {
      logger.error(`[Config] 解析配置文件失败，该文件的配置已全部退回默认值: ${file}`, error)
      return { valid: false, value: {} }
    }
  }

  private writeModuleConfig (name: ConfigName, value: Record<string, unknown>, type: ConfigSource): boolean {
    const path = this.configFile(type, name)
    if (!fs.existsSync(path)) return false
    const reader = new YamlReader(path)
    for (const [key, item] of Object.entries(value)) reader.document.set(key, item)
    const success = reader.write()
    if (success) delete this.config[`${type}.${name}`]
    return success
  }
}

/** 旧键清理必须容忍旧页面把父级配置提交成标量，不能让清理动作反过来阻断正常保存。 */
const deleteDocumentPath = (document: YAML.Document, key: string): void => {
  const path = key.split('.')
  if (path.length === 1) {
    document.delete(key)
    return
  }

  const parent = document.getIn(path.slice(0, -1), true) as { delete?: unknown } | undefined
  if (typeof parent?.delete === 'function') document.deleteIn(path)
}

let configInstance: ConfigService | undefined

const getConfigInstance = (): ConfigService => {
  if (!configInstance) {
    const cfg = new Cfg().initCfg()
    configInstance = new Proxy(cfg, {
      get (target, prop, receiver): unknown {
        if (Reflect.has(target, prop)) return Reflect.get(target, prop, receiver)
        if (typeof prop === 'string' && isConfigName(prop)) return target.getDefOrConfig(prop)
        return undefined
      }
    }) as ConfigService
  }
  return configInstance
}

export default new Proxy({} as ConfigService, {
  get (_target, prop): unknown {
    return Reflect.get(getConfigInstance(), prop)
  }
})

function isRecord (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function callLegacyLookup<TResult> (
  receiver: unknown,
  method: unknown,
  id: string | undefined
): Promise<TResult | undefined> {
  if (typeof method !== 'function') return undefined
  return await Reflect.apply(method, receiver, [id]) as TResult
}

function isConfigName (value: string): value is ConfigName {
  return CONFIG_NAMES.includes(value as ConfigName)
}
