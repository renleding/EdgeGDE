// canvas-state.js — shared state, constants, DOM references, utility functions

// ── DOM Element References ──
export const canvasStage = document.getElementById('canvas-stage')
export const canvasViewport = document.getElementById('canvas-viewport')
export const selectionSummary = document.getElementById('selection-summary')
export const workspaceTransient = document.getElementById('workspace-transient')
export const proposalList = document.getElementById('proposal-list')
export const offlineBadge = document.getElementById('offline-badge')
export const missionForm = document.getElementById('mission-form')
export const missionInput = document.getElementById('mission')

// ── Constants ──
export const SNAP_THRESHOLD = 22
export const SNAP_GAP = 10
export const MIN_OBJECT_WIDTH = 160
export const MIN_OBJECT_HEIGHT = 120

// ── State ──
export const state = {
  version: 0,
  transform: { x: 0, y: 0, scale: 1 },
  selectedId: null,
  selectedIds: [],
  pendingSelectId: null,
  rectangleSelect: null,
  dragging: null,
  resizing: null,
  snappingId: null,
  panning: null,
  objects: [],
  proposals: [],
  transient: {
    selected: 'none',
    recentResults: 'none',
    policyState: 'cached'
  }
}

// ── Initial Objects ──
export const initialObjects = [
  {
    id: 'welcome-onboarding',
    type: 'onboarding',
    x: 80,
    y: 90,
    width: 340,
    height: 220,
    title: 'Start with an empty canvas',
    status: 'ready',
    body: 'Create workspace objects, agent panels, MCP app shells, and governed proposals without importing Space Agent runtime files.'
  },
  {
    id: 'agent-proposal-shell',
    type: 'agent-panel',
    x: 470,
    y: 90,
    width: 390,
    height: 270,
    title: 'Agent proposals are staged',
    status: 'ready',
    body: 'Every mutation carries expectedVersion, correlationId, policy state, and audit metadata before EdgeGDE applies it.'
  },
  {
    id: 'edge-calculator-sandbox',
    type: 'mcp-app',
    x: 130,
    y: 370,
    width: 430,
    height: 280,
    title: 'Mortgage calculator iframe',
    status: 'ready',
    variant: 'edge-calculator',
    body: 'Sandboxed mortgage calculator iframe. Inputs calculate locally; any EdgeGDE action requires proposal, policy, and audit.'
  }
]

// ── Utility Functions ──
export function now() {
  return new Date().toISOString()
}

export function uid(prefix) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

export function safeText(value) {
  return String(value || '').replace(/[<>&]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[char]))
}

export function normalizeObject(object) {
  if (object.id === 'edge-calculator-sandbox' || /calculator/i.test(object.title || '')) {
    return {
      ...object,
      title: object.title === 'Edge Calculator sandbox iframe' ? 'Mortgage calculator iframe' : object.title,
      variant: 'edge-calculator'
    }
  }
  return object
}
