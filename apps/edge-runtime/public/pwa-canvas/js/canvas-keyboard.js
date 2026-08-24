// canvas-keyboard.js — keyboard shortcut handlers

import { state } from './canvas-state.js'
import { pushHistory, undo, redo } from './canvas-history.js'
import { renderObjects } from './canvas-render.js'
import { renderProposals, createProposal } from './canvas-proposals.js'
import { updateSelection } from './canvas-selection.js'
import { saveDraft } from './canvas-persistence.js'

export function setupKeyboard() {
  window.addEventListener('keydown', (event) => {
    // Escape — deselect all
    if (event.key === 'Escape') {
      event.preventDefault()
      selectObjects([])
      return
    }

    // Ctrl+S — save draft
    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
      event.preventDefault()
      saveDraft()
      return
    }

    // Delete key — remove selected objects via proposal
    if (event.key === 'Delete' && state.selectedIds.length) {
      const ids = [...state.selectedIds]
      pushHistory()
      createProposal('remove_objects', `Remove ${ids.length} selected objects.`, ids.map((id) => ({ kind: 'remove_object', id })))
    }

    // Ctrl+Z — Undo
    if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
      event.preventDefault()
      const changed = undo()
      if (changed) {
        renderObjects()
        renderProposals()
        updateSelection()
        saveDraft()
      }
    }

    // Ctrl+Shift+Z or Ctrl+Y — Redo
    if (
      ((event.ctrlKey || event.metaKey) && event.key === 'z' && event.shiftKey) ||
      ((event.ctrlKey || event.metaKey) && event.key === 'y')
    ) {
      event.preventDefault()
      const changed = redo()
      if (changed) {
        renderObjects()
        renderProposals()
        updateSelection()
        saveDraft()
      }
    }
  })
}
