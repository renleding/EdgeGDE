import { createHead } from '@unhead/vue/client'
import { createApp } from 'vue'

import './app.css'
import { preloadFonts } from '@/app/editor/fonts'
import { IS_TAURI } from '@/constants'

import App from './App.vue'
import router from './router'

preloadFonts()
const head = createHead()
createApp(App).use(router).use(head).mount('#app')

// ── MCP Bridge — connect to existing local MCP server ──────────
import('./app/automation/mcp/spawn').then(async ({ spawnMCPIfNeeded }) => {
  try {
    const handle = await spawnMCPIfNeeded()
    if (handle) {
      const { connectAutomation } = await import('./app/automation/bridge/server')
      const { getActiveEditorStore } = await import('@/app/editor/active-store')
      connectAutomation(getActiveEditorStore, handle.authToken)
      console.debug('[MCP] Bridge connected')
    }
  } catch (e) {
    console.warn('[MCP] Bridge init skipped:', e instanceof Error ? e.message : e)
  }
})

if (!IS_TAURI) {
  void import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({ immediate: true })
  })
}
