import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceRoot = fileURLToPath(new URL('../public/', import.meta.url))
const targetRoot = fileURLToPath(new URL('../../edge-runtime/public/pwa-canvas/', import.meta.url))

function walk(current) {
  const entries = readdirSync(current)
  for (const entry of entries) {
    if (entry === '.DS_Store') continue
    const sourcePath = join(current, entry)
    const targetPath = join(targetRoot, relative(sourceRoot, sourcePath))
    const entryStat = statSync(sourcePath)
    if (entryStat.isDirectory()) {
      walk(sourcePath)
      continue
    }
    mkdirSync(dirname(targetPath), { recursive: true })
    copyFileSync(sourcePath, targetPath)
  }
}

rmSync(targetRoot, { recursive: true, force: true })
mkdirSync(targetRoot, { recursive: true })
if (!existsSync(sourceRoot)) {
  throw new Error(`Missing pwa-canvas public source: ${sourceRoot}`)
}
walk(sourceRoot)
console.log(`copied pwa-canvas static assets to ${targetRoot}`)
