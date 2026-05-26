<script setup lang="ts">
import Tip from '@/components/ui/Tip.vue'
import ToolButton from '@/components/Toolbar/ToolButton.vue'
import ToolFlyout from '@/components/Toolbar/ToolFlyout.vue'
import { toolbarToolTestId, ToolbarItem } from '@open-pencil/vue'
import { ref } from 'vue'

import type { Tool } from '@open-pencil/vue'
import type { EditorToolDef } from '@open-pencil/core/editor'
import type { ToolbarUi, ToolIconMap, ToolLabels } from '@/components/Toolbar/types'

const { tools, activeTool, toolIcons, toolLabels, toolShortcuts, ui } = defineProps<{
  tools: EditorToolDef[]
  activeTool: Tool
  toolIcons: ToolIconMap
  toolLabels: ToolLabels
  toolShortcuts: Record<Tool, string>
  ui?: ToolbarUi
}>()

const emit = defineEmits<{
  setTool: [tool: Tool]
}>()

function isActive(tool: EditorToolDef) {
  return tool.key === activeTool || (tool.flyout?.includes(activeTool) ?? false)
}

function activeKeyForTool(tool: EditorToolDef) {
  return tool.flyout?.includes(activeTool) ? activeTool : tool.key
}

// ── Live Staging Deploy ──────────────────────────────────────────────────
const deploying = ref(false)
const deployed = ref(false)
const deployMessage = ref('Deploying...')

const DEPLOY_URL = 'https://edgegde-calculator.renleding.workers.dev/api/dev/deploy-staging'
const DEV_TOKEN = 'edgegde-dev-token-2026'

async function deployToStaging() {
  const tenant = window.prompt('Tenant name (e.g. afirmico):')
  if (!tenant?.trim()) return

  deploying.value = true
  deployed.value = false
  deployMessage.value = 'Deploying...'

  try {
    const res = await fetch(DEPLOY_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DEV_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tenant: tenant.trim(), layout_payload: '{}' }),
    })
    const data = await res.json()
    if (res.ok && data.success) {
      deployMessage.value = `✅ ${data.staging_url} (${data.version})`
      deployed.value = true
    } else {
      deployMessage.value = `❌ ${data.error || 'Deploy failed'}`
      deployed.value = true
    }
  } catch (err: any) {
    deployMessage.value = `❌ ${err.message}`
    deployed.value = true
  } finally {
    deploying.value = false
  }
}
</script>

<template>
  <div class="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center">
    <div
      data-test-id="toolbar"
      class="flex gap-0.5 rounded-xl border border-border bg-panel p-1 shadow-lg"
    >
      <template v-for="tool in tools" :key="tool.key">
        <Tip
          v-if="tool.flyout && tool.flyout.length > 1"
          :label="`${toolLabels[activeKeyForTool(tool)]} (${tool.shortcut})`"
        >
          <ToolFlyout
            :tool="tool"
            :active-tool="activeTool"
            :tool-icons="toolIcons"
            :tool-labels="toolLabels"
            :tool-shortcuts="toolShortcuts"
            :ui="ui"
            @select="emit('setTool', $event)"
          />
        </Tip>

        <ToolbarItem v-else v-slot="{ active, actions }" :tool="tool.key">
          <Tip :label="`${toolLabels[tool.key]} (${tool.shortcut})`">
            <ToolButton
              :test-id="toolbarToolTestId(tool.key)"
              :icon="toolIcons[tool.key]"
              :active="active || isActive(tool)"
              @click="actions.select"
            />
          </Tip>
        </ToolbarItem>
      </template>
    </div>
  </div>

  <!-- Live Staging deploy button -->
  <div class="absolute bottom-4 right-4 z-10 flex items-center gap-2">
    <button
      v-if="!deploying && !deployed"
      class="flex items-center gap-1.5 rounded-lg border border-[#2d3140] bg-[#1c1e26] px-3 py-1.5 text-xs font-medium text-[#e1e4e8] shadow-lg transition-all hover:border-[#58a6ff] hover:bg-[#22252e] active:scale-95"
      @click="deployToStaging"
    >
      <span>🚀</span>
      <span>Live Staging</span>
    </button>
    <button
      v-else-if="deploying"
      class="flex items-center gap-1.5 rounded-lg border border-[#d29922] bg-[#1c1e26] px-3 py-1.5 text-xs font-medium text-[#d29922] shadow-lg"
      disabled
    >
      <span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[#d29922] border-t-transparent" />
      <span>Deploying...</span>
    </button>
    <button
      v-else
      class="flex items-center gap-1.5 rounded-lg border border-[#3fb950] bg-[#1c1e26] px-3 py-1.5 text-xs font-medium text-[#3fb950] shadow-lg transition-all hover:border-[#58a6ff]"
      @click="deployed = false; deployError = ''"
    >
      <span>✅</span>
      <span>{{ deployMessage }}</span>
    </button>
  </div>
</template>
