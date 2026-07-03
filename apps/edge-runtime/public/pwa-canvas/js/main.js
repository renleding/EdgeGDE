// main.js — entry point: imports all modules and initializes the canvas

import { state, initialObjects, normalizeObject } from './canvas-state.js'
import { renderObjects } from './canvas-render.js'
import { updateSelection } from './canvas-selection.js'
import { setupInteractionHandlers } from './canvas-interactions.js'
import { renderProposals, setupProposalHandlers, loadProposals, loadTransient } from './canvas-proposals.js'
import { updateOfflineBadge, loadDraft, registerServiceWorker, setupPersistenceHandlers } from './canvas-persistence.js'
import { setupKeyboard } from './canvas-keyboard.js'
import { setupPropertyEditor } from './canvas-properties.js'

// Wire up event handlers
setupInteractionHandlers()
setupProposalHandlers()
setupPersistenceHandlers()
setupKeyboard()
setupPropertyEditor()

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
