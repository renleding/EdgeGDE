// canvas-history.js — undo/redo stack (new feature)

import { state } from './canvas-state.js'

const MAX_HISTORY = 50
const undoStack = []
const redoStack = []

/**
 * Capture the current state for undo. Call this before making a mutation.
 * We store a deep copy of objects and the current version.
 */
export function pushHistory() {
  undoStack.push({
    version: state.version,
    objects: JSON.parse(JSON.stringify(state.objects)),
    proposals: JSON.parse(JSON.stringify(state.proposals))
  })
  // Clear redo stack on new action
  redoStack.length = 0
  // Enforce max history
  if (undoStack.length > MAX_HISTORY) {
    undoStack.shift()
  }
}

/** Undo: restore the previous state snapshot. */
export function undo() {
  if (!undoStack.length) return
  // Save current state to redo stack
  redoStack.push({
    version: state.version,
    objects: JSON.parse(JSON.stringify(state.objects)),
    proposals: JSON.parse(JSON.stringify(state.proposals))
  })
  const snapshot = undoStack.pop()
  state.version = snapshot.version
  state.objects = snapshot.objects
  state.proposals = snapshot.proposals
  state.selectedIds = []
  state.selectedId = null
  return true // signal to caller to re-render
}

/** Redo: restore the next state snapshot. */
export function redo() {
  if (!redoStack.length) return
  // Save current state to undo stack
  undoStack.push({
    version: state.version,
    objects: JSON.parse(JSON.stringify(state.objects)),
    proposals: JSON.parse(JSON.stringify(state.proposals))
  })
  const snapshot = redoStack.pop()
  state.version = snapshot.version
  state.objects = snapshot.objects
  state.proposals = snapshot.proposals
  state.selectedIds = []
  state.selectedId = null
  return true // signal to caller to re-render
}
