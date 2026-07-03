// canvas-selection.js — single/multi selection logic

import { state, selectionSummary, workspaceTransient, canvasViewport } from './canvas-state.js'

export function isSelected(id) {
  return state.selectedIds.includes(id)
}

export function applySelectionClasses() {
  for (const el of canvasViewport.querySelectorAll('.canvas-object')) {
    el.classList.toggle('selected', isSelected(el.dataset.id))
  }
}

export function selectObjects(ids) {
  const unique = Array.from(new Set(ids.filter((id) => state.objects.some((object) => object.id === id))))
  state.selectedIds = unique
  state.selectedId = unique[0] || null
  applySelectionClasses()
  updateSelection()
}

export function selectObject(id) {
  selectObjects([id])
}

export function toggleMultiSelect(id) {
  const selected = isSelected(id)
  const next = selected ? state.selectedIds.filter((item) => item !== id) : [...state.selectedIds, id]
  selectObjects(next)
}

export function updateSelection() {
  const selected = state.objects.filter((object) => isSelected(object.id))
  if (!selected.length) {
    selectionSummary.textContent = 'No object selected.'
    state.transient.selected = 'none'
  } else if (selected.length === 1) {
    const object = selected[0]
    selectionSummary.textContent = `${object.title}\n${object.type}\n${Math.round(object.width)}×${Math.round(object.height)} at ${Math.round(object.x)}, ${Math.round(object.y)}\nversion ${state.version}\nlocal draft only; EdgeGDE server state is authoritative.`
    state.transient.selected = object.id
  } else {
    selectionSummary.textContent = `${selected.length} objects selected.\n${selected.map((object) => `- ${object.title}`).join('\n')}\nversion ${state.version}\nlocal draft only; EdgeGDE server state is authoritative.`
    state.transient.selected = `${selected.length} objects`
  }
  workspaceTransient.textContent = JSON.stringify(state.transient, null, 2)
}
