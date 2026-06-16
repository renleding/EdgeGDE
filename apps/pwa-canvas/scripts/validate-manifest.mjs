import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const manifestPath = fileURLToPath(new URL('../public/manifest.webmanifest', import.meta.url))
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const required = ['name', 'short_name', 'start_url', 'scope', 'display', 'icons']
const missing = required.filter((key) => !(key in manifest))
if (missing.length) {
  throw new Error(`manifest.webmanifest missing required keys: ${missing.join(', ')}`)
}
if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) {
  throw new Error('manifest.webmanifest must include at least one icon')
}
console.log('manifest.webmanifest ok')
