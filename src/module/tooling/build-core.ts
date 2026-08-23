import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { replaceDirectoryAtomically, withBuildLock } from './build-safety.ts'
import { assertUnlinkedOwnedPath } from './react-template/path-safety.ts'

const pluginRoot = fileURLToPath(new URL('../../../', import.meta.url))
const projectFile = join(pluginRoot, 'tsconfig.build.json')

const runNode = (script: string, args: string[] = [], env?: NodeJS.ProcessEnv): void => {
  execFileSync(process.execPath, [script, ...args], {
    cwd: pluginRoot,
    env: env ?? process.env,
    stdio: 'inherit'
  })
}

const buildCoreUnlocked = (): void => {
  const cacheRoot = join(pluginRoot, '.ktr')
  const tempOutput = join(cacheRoot, `core-build-${process.pid}-${Date.now()}`)
  const finalOutput = join(pluginRoot, 'lib')
  assertUnlinkedOwnedPath(pluginRoot, tempOutput)
  assertUnlinkedOwnedPath(pluginRoot, finalOutput)
  mkdirSync(cacheRoot, { recursive: true })
  rmSync(tempOutput, { recursive: true, force: true })

  try {
    runNode('node_modules/typescript/bin/tsc', ['-p', projectFile, '--outDir', tempOutput])
    runNode('node_modules/tsc-alias/dist/bin/index.js', ['-p', projectFile, '--outDir', tempOutput])

    const currentTemplate = join(finalOutput, 'react-template')
    if (existsSync(currentTemplate)) cpSync(currentTemplate, join(tempOutput, 'react-template'), { recursive: true })
    const currentMetadata = join(finalOutput, 'build-metadata.json')
    if (existsSync(currentMetadata)) cpSync(currentMetadata, join(tempOutput, 'build-metadata.json'))

    replaceDirectoryAtomically(pluginRoot, tempOutput, finalOutput)
    runNode('lib/module/tooling/build-metadata.js')
    console.log('[build:core] 核心运行产物已原子更新')
  } finally {
    if (existsSync(tempOutput)) rmSync(tempOutput, { recursive: true, force: true })
  }
}

export const buildCore = ({ lock = true }: { lock?: boolean } = {}): void => {
  if (lock) withBuildLock(pluginRoot, 'core build', buildCoreUnlocked)
  else buildCoreUnlocked()
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (entryPath && entryPath === fileURLToPath(import.meta.url)) buildCore()
