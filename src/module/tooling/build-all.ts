import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildCore } from './build-core.ts'
import { withBuildLock } from './build-safety.ts'
import { buildTemplates } from './template-build.ts'

const pluginRoot = fileURLToPath(new URL('../../../', import.meta.url))

export const buildAll = (): void => {
  withBuildLock(pluginRoot, 'full build', () => {
    buildCore({ lock: false })
    buildTemplates({ lock: false })
  })
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (entryPath && entryPath === fileURLToPath(import.meta.url)) buildAll()
