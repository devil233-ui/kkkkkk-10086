import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildCore } from './build-core.ts'
import { withBuildLock } from './build-safety.ts'
import { buildTemplates } from './template-build.ts'

const pluginRoot = fileURLToPath(new URL('../../../', import.meta.url))

export const buildWatch = (): void => {
  if (process.env.KKK_ALLOW_BUILD_WATCH !== '1') {
    throw new Error('build:watch 默认禁用；仅可在独立开发机显式设置 KKK_ALLOW_BUILD_WATCH=1')
  }

  withBuildLock(pluginRoot, 'build watch', () => {
    buildCore({ lock: false })
    buildTemplates({ lock: false })
    const pnpmExecutable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
    execFileSync(pnpmExecutable, [
      'exec',
      'concurrently',
      '--kill-others-on-fail',
      'tsc -p tsconfig.build.json --watch',
      'tsc-alias -p tsconfig.build.json --watch'
    ], {
      cwd: pluginRoot,
      env: process.env,
      stdio: 'inherit'
    })
  })
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (entryPath && entryPath === fileURLToPath(import.meta.url)) buildWatch()
