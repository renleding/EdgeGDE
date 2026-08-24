// main.js — entry point: imports all modules and initializes the canvas

import { state, initialObjects, normalizeObject } from './canvas-state.js'
import { renderObjects } from './canvas-render.js'
import { selectObjects, updateSelection } from './canvas-selection.js'
import { setupInteractionHandlers } from './canvas-interactions.js'
import { renderProposals, setupProposalHandlers, loadProposals, loadTransient } from './canvas-proposals.js'
import { updateOfflineBadge, loadDraft, registerServiceWorker, setupPersistenceHandlers, saveDraft } from './canvas-persistence.js'
import { setupKeyboard } from './canvas-keyboard.js'
import { setupPropertyEditor } from './canvas-properties.js'

// Wire up event handlers
setupInteractionHandlers()
setupProposalHandlers()
setupPersistenceHandlers()
setupKeyboard()
setupPropertyEditor()
const publishBtn = document.getElementById('publish-canvas')
if (publishBtn) publishBtn.addEventListener('click', publishCanvas)

// Publish canvas to EdgeGDE
async function publishCanvas() {
  const payload = {
    objects: state.objects,
    version: state.version,
    sessionId: crypto.randomUUID(),
    correlationId: crypto.randomUUID(),
  }
  try {
    const response = await fetch('/api/pwa/workspaces/default/canvas/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    state.transient.recentResults = `Published: ${data.missionId} at ${data.publishedAt}`
    state.transient.policyState = `published:${data.status}`
    workspaceTransient.textContent = JSON.stringify(state.transient, null, 2)
    saveDraft()
  } catch (err) {
    state.transient.recentResults = `Publish failed: ${err.message}`
    workspaceTransient.textContent = JSON.stringify(state.transient, null, 2)
  }
}

// Initialisation sequence (preserving original order)
updateOfflineBadge()
loadDraft().then(() => {
  if (!state.objects.length) state.objects = initialObjects
  state.objects = state.objects.map(normalizeObject)
  renderObjects()
  renderProposals()
  updateSelection()
})
loadTransient()
loadProposals()
registerServiceWorker()
