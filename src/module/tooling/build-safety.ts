import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { assertUnlinkedOwnedPath, resolveRequiredRoot } from './react-template/path-safety.ts'

interface BuildLockOwner {
  pid: number
  label: string
  startedAt: string
  token: string
}

const LOCK_LEASE_MS = 30_000
const LOCK_HEARTBEAT_MS = 5_000

const readLockOwner = (ownerFile: string): BuildLockOwner | null => {
  try {
    const value: unknown = JSON.parse(readFileSync(ownerFile, 'utf8'))
    if (typeof value !== 'object' || value === null) return null
    const owner = value as Partial<BuildLockOwner>
    if (typeof owner.pid !== 'number' || typeof owner.token !== 'string') return null
    return {
      pid: owner.pid,
      label: typeof owner.label === 'string' ? owner.label : 'unknown',
      startedAt: typeof owner.startedAt === 'string' ? owner.startedAt : 'unknown',
      token: owner.token
    }
  } catch {
    return null
  }
}

/** 同一仓库的核心与模板构建共用一把进程锁，避免多个 Agent 并发压垮宿主。 */
export const withBuildLock = <T>(root: string, label: string, action: () => T): T => {
  const absoluteRoot = resolveRequiredRoot(root, '构建根目录')
  const cacheRoot = join(absoluteRoot, '.ktr')
  const lockDir = join(cacheRoot, 'build.lock')
  const ownerFile = join(lockDir, 'owner.json')
  assertUnlinkedOwnedPath(absoluteRoot, cacheRoot)
  assertUnlinkedOwnedPath(absoluteRoot, lockDir)
  mkdirSync(cacheRoot, { recursive: true })

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(lockDir)
      break
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST') throw error

      const owner = readLockOwner(ownerFile)
      const heartbeatFile = existsSync(ownerFile) ? ownerFile : lockDir
      const age = Date.now() - (statSync(heartbeatFile).mtimeMs || Date.now())
      if (age < LOCK_LEASE_MS) {
        throw new Error(`已有构建正在运行：${owner?.label ?? 'initializing'}（PID ${owner?.pid ?? 'unknown'}，开始于 ${owner?.startedAt ?? 'unknown'}）`)
      }
      rmSync(lockDir, { recursive: true, force: true })
    }
  }

  if (!existsSync(lockDir)) throw new Error('无法取得构建锁')
  const owner: BuildLockOwner = {
    pid: process.pid,
    label,
    startedAt: new Date().toISOString(),
    token: randomUUID()
  }
  writeFileSync(ownerFile, `${JSON.stringify(owner, null, 2)}\n`, 'utf8')

  const heartbeatScript = `
const fs = require('node:fs')
const [ownerFile, token, parentPidText, intervalText] = process.argv.slice(1)
const parentPid = Number(parentPidText)
const beat = () => {
  try {
    if (process.ppid !== parentPid) process.exit(0)
    const owner = JSON.parse(fs.readFileSync(ownerFile, 'utf8'))
    if (owner.token !== token) process.exit(0)
    const now = new Date()
    fs.utimesSync(ownerFile, now, now)
  } catch {
    process.exit(0)
  }
}
beat()
setInterval(beat, Number(intervalText))
`
  const heartbeat = spawn(process.execPath, [
    '-e',
    heartbeatScript,
    ownerFile,
    owner.token,
    String(process.pid),
    String(LOCK_HEARTBEAT_MS)
  ], { stdio: 'ignore' })
  if (!heartbeat.pid) {
    rmSync(lockDir, { recursive: true, force: true })
    throw new Error('无法启动构建锁心跳')
  }

  try {
    return action()
  } finally {
    heartbeat.kill()
    const current = readLockOwner(ownerFile)
    if (current?.token === owner.token) rmSync(lockDir, { recursive: true, force: true })
  }
}

/** 准备目录完整后再替换正式产物；替换失败时恢复旧目录。 */
export const replaceDirectoryAtomically = (
  root: string,
  preparedDirectory: string,
  targetDirectory: string
): void => {
  const absoluteRoot = resolveRequiredRoot(root, '构建根目录')
  assertUnlinkedOwnedPath(absoluteRoot, preparedDirectory)
  assertUnlinkedOwnedPath(absoluteRoot, targetDirectory)
  if (!existsSync(preparedDirectory)) throw new Error(`构建临时目录不存在：${preparedDirectory}`)

  const backupDirectory = join(
    absoluteRoot,
    '.ktr',
    `${basename(targetDirectory)}.backup-${process.pid}-${Date.now()}`
  )
  assertUnlinkedOwnedPath(absoluteRoot, backupDirectory)
  mkdirSync(dirname(targetDirectory), { recursive: true })

  let movedOldOutput = false
  try {
    if (existsSync(targetDirectory)) {
      renameSync(targetDirectory, backupDirectory)
      movedOldOutput = true
    }
    renameSync(preparedDirectory, targetDirectory)
  } catch (error) {
    if (!existsSync(targetDirectory) && movedOldOutput && existsSync(backupDirectory)) {
      renameSync(backupDirectory, targetDirectory)
    }
    throw error
  }

  if (existsSync(backupDirectory)) rmSync(backupDirectory, { recursive: true, force: true })
}
