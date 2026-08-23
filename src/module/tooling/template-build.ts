import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { replaceDirectoryAtomically, withBuildLock } from './build-safety.ts'
import { assertUnlinkedOwnedPath } from './react-template/path-safety.ts'

const pluginRoot = fileURLToPath(new URL('../../../', import.meta.url))
const finalOutput = join(pluginRoot, 'lib', 'react-template')
const stampName = '.source-hash'
const fingerprintFiles = [
  'karin.template.ts',
  'pnpm-lock.yaml'
]
const fingerprintDirectories = [
  'ktr',
  'src/module/utils/richtext',
  'src/template-sdk'
]

/**
 * 需要触发模板重建的输入。业务 src 改动不会进入这里，因此普通修复只需 build:core。
 */
const collectFiles = (directory: string, result: string[]): void => {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) collectFiles(absolute, result)
    else if (entry.isFile()) result.push(absolute)
  }
}

const createTemplateFingerprint = (): string => {
  const files: string[] = []
  for (const file of fingerprintFiles) {
    const absolute = join(pluginRoot, file)
    if (existsSync(absolute)) files.push(absolute)
  }
  for (const directory of fingerprintDirectories) {
    const absolute = join(pluginRoot, directory)
    if (existsSync(absolute)) collectFiles(absolute, files)
  }

  const hash = createHash('sha256')
  for (const file of files.sort((a, b) => a.localeCompare(b, 'en'))) {
    hash.update(relative(pluginRoot, file).split('\\').join('/'))
    hash.update('\0')
    hash.update(readFileSync(file))
    hash.update('\0')
  }
  return hash.digest('hex')
}

const readCurrentFingerprint = (): string => {
  try {
    return readFileSync(join(finalOutput, stampName), 'utf8').trim()
  } catch {
    return ''
  }
}

const buildTemplatesUnlocked = (force: boolean): void => {
  const fingerprint = createTemplateFingerprint()
  if (!force && existsSync(join(finalOutput, 'index.mjs')) && readCurrentFingerprint() === fingerprint) {
    console.log('[build:template] 模板输入未变化，复用现有运行包')
    return
  }

  const cacheRoot = join(pluginRoot, '.ktr')
  const tempOutput = join(cacheRoot, `react-template-build-${process.pid}-${Date.now()}`)
  assertUnlinkedOwnedPath(pluginRoot, tempOutput)
  assertUnlinkedOwnedPath(pluginRoot, finalOutput)
  mkdirSync(cacheRoot, { recursive: true })
  rmSync(tempOutput, { recursive: true, force: true })

  try {
    const pnpmExecutable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
    execFileSync(pnpmExecutable, ['exec', 'ktr', 'build'], {
      cwd: pluginRoot,
      env: { ...process.env, KKK_TEMPLATE_OUT_DIR: tempOutput },
      stdio: 'inherit'
    })
    if (!existsSync(join(tempOutput, 'index.mjs'))) {
      throw new Error(`模板构建未生成入口：${join(tempOutput, 'index.mjs')}`)
    }
    writeFileSync(join(tempOutput, stampName), `${fingerprint}\n`, 'utf8')
    replaceDirectoryAtomically(pluginRoot, tempOutput, finalOutput)
    console.log('[build:template] 模板运行包已原子更新')
  } finally {
    if (existsSync(tempOutput)) rmSync(tempOutput, { recursive: true, force: true })
  }
}

export const buildTemplates = ({
  lock = true,
  force = false
}: {
  lock?: boolean
  force?: boolean
} = {}): void => {
  const action = (): void => buildTemplatesUnlocked(force)
  if (lock) withBuildLock(pluginRoot, 'template build', action)
  else action()
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  buildTemplates({ force: process.argv.includes('--force') })
}
