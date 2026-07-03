// canvas-properties.js — property editor panel UI (new feature)
// Double-click an object title to edit it inline.

import { state, canvasViewport, safeText } from './canvas-state.js'
import { renderObjects, updateObjectElement } from './canvas-render.js'
import { pushHistory } from './canvas-history.js'
import { saveDraft } from './canvas-persistence.js'

export function setupPropertyEditor() {
  // Use event delegation for double-click on object handles
  canvasViewport.addEventListener('dblclick', (event) => {
    const handle = event.target.closest('[data-handle="true"]')
    if (!handle) return
    const objectEl = handle.closest('.canvas-object')
    if (!objectEl) return
    const id = objectEl.dataset.id
    const object = state.objects.find((o) => o.id === id)
    if (!object) return

    // Start inline editing of the title
    startTitleEdit(objectEl, object)
  })
}

function startTitleEdit(objectEl, object) {
  const handleEl = objectEl.querySelector('[data-handle="true"]')
  const titleEl = handleEl?.querySelector('strong')
  if (!titleEl) return

  const currentTitle = object.title || ''

  // Replace the title text with an input field
  const input = document.createElement('input')
  input.type = 'text'
  input.value = currentTitle
  input.className = 'property-editor-input'
  input.style.cssText = `
    font: inherit;
    font-size: 13px;
    font-weight: bold;
    color: var(--text);
    background: rgba(2, 8, 23, 0.9);
    border: 1px solid var(--accent);
    border-radius: 6px;
    padding: 2px 6px;
    width: 100%;
    min-width: 60px;
    outline: none;
  `

  titleEl.replaceWith(input)
  input.focus()
  input.select()

  function finishEdit(save) {
    if (save && input.value.trim()) {
      const newTitle = input.value.trim()
      if (newTitle !== object.title) {
        // Capture undo state before mutation
        pushHistory()
        object.title = newTitle
        // Update the handle text (restore the strong element)
        const newStrong = document.createElement('strong')
        newStrong.textContent = safeText(newTitle)
        input.replaceWith(newStrong)
        updateObjectElement(object)
        saveDraft()
      } else {
        // No change — restore original
        const newStrong = document.createElement('strong')
        newStrong.textContent = safeText(currentTitle)
        input.replaceWith(newStrong)
      }
    } else {
      // Cancel — restore original
      const newStrong = document.createElement('strong')
      newStrong.textContent = safeText(currentTitle)
      input.replaceWith(newStrong)
    }
  }

  // Finish on blur or Enter
  input.addEventListener('blur', () => finishEdit(true))
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      input.blur()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      finishEdit(false)
    }
  })
}
