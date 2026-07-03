// canvas-interactions.js — drag, resize, snap, pan, rectangle select

import {
  state, canvasStage, canvasViewport,
  SNAP_THRESHOLD, SNAP_GAP, MIN_OBJECT_WIDTH, MIN_OBJECT_HEIGHT
} from './canvas-state.js'
import { isSelected, selectObjects, selectObject, toggleMultiSelect, updateSelection } from './canvas-selection.js'
import { updateObjectElement, applyTransform } from './canvas-render.js'
import { saveDraft } from './canvas-persistence.js'
import { uid } from './canvas-state.js'
import { createProposal } from './canvas-proposals.js'

// ── Helpers ──

function clientToCanvasPoint(event) {
  const rect = canvasStage.getBoundingClientRect()
  return {
    x: (event.clientX - rect.left - state.transform.x) / state.transform.scale,
    y: (event.clientY - rect.top - state.transform.y) / state.transform.scale
  }
}

function normalizeCanvasRect(start, end) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  }
}

function boxesIntersect(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

// ── Selection Rectangle rendering ──

function ensureSelectionRectangle() {
  let el = canvasViewport.querySelector('.selection-rectangle')
  if (!el) {
    el = document.createElement('div')
    el.className = 'selection-rectangle'
    el.hidden = true
    canvasViewport.appendChild(el)
  }
  return el
}

function updateSelectionRectangle(start, end) {
  const rect = normalizeCanvasRect(start, end)
  const el = ensureSelectionRectangle()
  el.hidden = rect.width < 2 || rect.height < 2
  if (el.hidden) return
  el.style.transform = `translate(${rect.x}px, ${rect.y}px)`
  el.style.width = `${rect.width}px`
  el.style.height = `${rect.height}px`
}

function hideSelectionRectangle() {
  const el = canvasViewport.querySelector('.selection-rectangle')
  if (el) el.hidden = true
}

function applyRectangleSelection(rectangle) {
  const rect = normalizeCanvasRect({ x: rectangle.startX, y: rectangle.startY }, { x: rectangle.endX, y: rectangle.endY })
  const ids = state.objects
    .filter((object) => boxesIntersect({ x: object.x, y: object.y, width: object.width, height: object.height }, rect))
    .map((object) => object.id)
  if (!ids.length) return
  if (rectangle.mode === 'remove') {
    selectObjects(state.selectedIds.filter((id) => !ids.includes(id)))
  } else {
    selectObjects([...state.selectedIds, ...ids])
  }
}

// ── Snap ──

function snapObject(object, candidates) {
  const free = { x: object.x, y: object.y, snapped: false }
  if (!candidates.length) return free

  const current = {
    left: object.x,
    right: object.x + object.width,
    top: object.y,
    bottom: object.y + object.height,
    centerX: object.x + object.width / 2,
    centerY: object.y + object.height / 2
  }

  let bestX = null
  let bestY = null

  for (const other of candidates) {
    const otherBox = {
      left: other.x,
      right: other.x + other.width,
      top: other.y,
      bottom: other.y + other.height,
      centerX: other.x + other.width / 2,
      centerY: other.y + other.height / 2
    }

    const xGuides = [
      { x: otherBox.left, score: Math.abs(current.left - otherBox.left), label: 'left-left' },
      { x: otherBox.right - object.width, score: Math.abs(current.right - otherBox.right), label: 'right-right' },
      { x: otherBox.centerX - object.width / 2, score: Math.abs(current.centerX - otherBox.centerX), label: 'center-center' },
      { x: otherBox.right + SNAP_GAP, score: Math.abs(current.left - (otherBox.right + SNAP_GAP)), label: 'left-of-right' },
      { x: otherBox.left - object.width - SNAP_GAP, score: Math.abs(current.right - (otherBox.left - SNAP_GAP)), label: 'right-of-left' }
    ]
    const yGuides = [
      { y: otherBox.top, score: Math.abs(current.top - otherBox.top), label: 'top-top' },
      { y: otherBox.bottom - object.height, score: Math.abs(current.bottom - otherBox.bottom), label: 'bottom-bottom' },
      { y: otherBox.centerY - object.height / 2, score: Math.abs(current.centerY - otherBox.centerY), label: 'center-center' },
      { y: otherBox.bottom + SNAP_GAP, score: Math.abs(current.top - (otherBox.bottom + SNAP_GAP)), label: 'top-of-bottom' },
      { y: otherBox.top - object.height - SNAP_GAP, score: Math.abs(current.bottom - (otherBox.top - SNAP_GAP)), label: 'bottom-of-top' }
    ]

    for (const guide of xGuides) {
      if (!bestX || guide.score < bestX.score) bestX = guide
    }
    for (const guide of yGuides) {
      if (!bestY || guide.score < bestY.score) bestY = guide
    }
  }

  const result = { x: object.x, y: object.y, snapped: false }
  if (bestX && bestX.score <= SNAP_THRESHOLD) {
    result.x = bestX.x
    result.snapped = true
  }
  if (bestY && bestY.score <= SNAP_THRESHOLD) {
    result.y = bestY.y
    result.snapped = true
  }
  return result
}

// ── Begin interactions ──

export function beginObjectPointerDown(event, id) {
  const resizeHandle = event.target.closest('[data-resize]')
  const inObject = event.target.closest('.canvas-object')
  if (event.shiftKey) {
    if (resizeHandle || inObject) {
      beginRectangleSelect(event, isSelected(id) ? 'remove' : 'add')
      return
    }
  }
  if (resizeHandle) {
    state.pendingSelectId = id
    beginResize(event, id, resizeHandle.dataset.resize)
    return
  }
  if (event.target.closest('[data-handle="true"]')) {
    state.pendingSelectId = id
    beginObjectDrag(event, id)
    return
  }
  selectObject(id)
}

function beginObjectDrag(event, id) {
  event.preventDefault()
  event.stopPropagation()
  selectObject(id)
  const object = state.objects.find((item) => item.id === id)
  if (!object) return
  const objectEl = event.currentTarget.closest('.canvas-object')
  const rect = objectEl.getBoundingClientRect()
  const pointerOffset = {
    x: (event.clientX - rect.left) / state.transform.scale,
    y: (event.clientY - rect.top) / state.transform.scale
  }
  state.dragging = { id, pointerOffset, hasMoved: false, lastX: event.clientX, lastY: event.clientY }
  event.currentTarget.setPointerCapture(event.pointerId)
}

function beginResize(event, id, direction) {
  event.preventDefault()
  event.stopPropagation()
  selectObject(id)
  const object = state.objects.find((item) => item.id === id)
  if (!object) return
  const stageRect = canvasStage.getBoundingClientRect()
  const pointerX = (event.clientX - stageRect.left - state.transform.x) / state.transform.scale
  const pointerY = (event.clientY - stageRect.top - state.transform.y) / state.transform.scale
  const start = {
    pointerX,
    pointerY,
    objectX: object.x,
    objectY: object.y,
    width: object.width,
    height: object.height,
    offsets: {
      e: pointerX - (object.x + object.width),
      s: pointerY - (object.y + object.height),
      w: pointerX - object.x,
      n: pointerY - object.y
    }
  }
  state.resizing = { id, direction, start }
  event.currentTarget.closest('.canvas-object').setPointerCapture(event.pointerId)
}

function beginRectangleSelect(event, mode) {
  event.preventDefault()
  event.stopPropagation()
  const point = clientToCanvasPoint(event)
  state.rectangleSelect = {
    mode,
    startX: point.x,
    startY: point.y,
    endX: point.x,
    endY: point.y,
    startTargetId: event.target.closest?.('.canvas-object')?.dataset.id || null,
    lastX: event.clientX,
    lastY: event.clientY
  }
  canvasStage.classList.add('selecting')
  updateSelectionRectangle(point, point)
}

function beginPan(event) {
  if (event.target.closest('.canvas-object')) return
  if (event.shiftKey) {
    beginRectangleSelect(event, 'add')
    return
  }
  state.panning = { x: event.clientX, y: event.clientY, startX: state.transform.x, startY: state.transform.y }
  canvasStage.classList.add('panning')
  canvasStage.setPointerCapture(event.pointerId)
}

// ── Move / End ──

function movePointer(event) {
  if (state.rectangleSelect) {
    const point = clientToCanvasPoint(event)
    const drag = Math.hypot(event.clientX - state.rectangleSelect.lastX, event.clientY - state.rectangleSelect.lastY)
    if (drag >= 3) state.rectangleSelect.moved = true
    state.rectangleSelect.endX = point.x
    state.rectangleSelect.endY = point.y
    state.rectangleSelect.lastX = event.clientX
    state.rectangleSelect.lastY = event.clientY
    updateSelectionRectangle({ x: state.rectangleSelect.startX, y: state.rectangleSelect.startY }, point)
    return
  }
  if (state.resizing) {
    const { id, direction, start } = state.resizing
    const object = state.objects.find((item) => item.id === id)
    if (object) {
      const stageRect = canvasStage.getBoundingClientRect()
      const currentX = (event.clientX - stageRect.left - state.transform.x) / state.transform.scale
      const currentY = (event.clientY - stageRect.top - state.transform.y) / state.transform.scale
      let x = start.objectX
      let y = start.objectY
      let width = start.width
      let height = start.height

      if (direction.includes('e')) {
        const newRight = currentX - start.offsets.e
        width = Math.max(MIN_OBJECT_WIDTH, newRight - x)
      }
      if (direction.includes('s')) {
        const newBottom = currentY - start.offsets.s
        height = Math.max(MIN_OBJECT_HEIGHT, newBottom - y)
      }
      if (direction.includes('w')) {
        const newLeft = currentX - start.offsets.w
        const nextWidth = Math.max(MIN_OBJECT_WIDTH, start.objectX + start.width - newLeft)
        x = start.objectX + start.width - nextWidth
        width = nextWidth
      }
      if (direction.includes('n')) {
        const newTop = currentY - start.offsets.n
        const nextHeight = Math.max(MIN_OBJECT_HEIGHT, start.objectY + start.height - newTop)
        y = start.objectY + start.height - nextHeight
        height = nextHeight
      }

      object.x = x
      object.y = y
      object.width = Math.max(MIN_OBJECT_WIDTH, width)
      object.height = Math.max(MIN_OBJECT_HEIGHT, height)
      updateObjectElement(object)
    }
    return
  }
  if (state.dragging) {
    const { id, pointerOffset, hasMoved, lastX, lastY } = state.dragging
    const rawDx = event.clientX - lastX
    const rawDy = event.clientY - lastY
    if (!hasMoved && Math.hypot(rawDx, rawDy) < 8) return
    const object = state.objects.find((item) => item.id === id)
    if (object) {
      const stageRect = canvasStage.getBoundingClientRect()
      const pointerX = (event.clientX - stageRect.left - state.transform.x) / state.transform.scale
      const pointerY = (event.clientY - stageRect.top - state.transform.y) / state.transform.scale
      object.x = pointerX - pointerOffset.x
      object.y = pointerY - pointerOffset.y
      const snap = hasMoved ? snapObject(object, state.objects.filter((candidate) => candidate.id !== object.id)) : { x: object.x, y: object.y, snapped: false }
      object.x = snap.x
      object.y = snap.y
      state.snappingId = snap.snapped ? object.id : null
      state.dragging.hasMoved = true
      state.dragging.lastX = event.clientX
      state.dragging.lastY = event.clientY
      updateObjectElement(object)
    }
    return
  }
  if (state.panning) {
    state.transform.x = state.panning.startX + event.clientX - state.panning.x
    state.transform.y = state.panning.startY + event.clientY - state.panning.y
    applyTransform()
  }
}

function endPointer(event) {
  if (state.rectangleSelect) {
    const rectangle = state.rectangleSelect
    state.rectangleSelect = null
    hideSelectionRectangle()
    canvasStage.classList.remove('selecting')
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch {}
    if (!rectangle.moved && rectangle.startTargetId) {
      toggleMultiSelect(rectangle.startTargetId)
    } else {
      applyRectangleSelection(rectangle)
    }
    saveDraft()
  }
  if (state.resizing) {
    state.resizing = null
    try { event.currentTarget.closest('.canvas-object').releasePointerCapture(event.pointerId) } catch {}
    if (state.pendingSelectId) {
      selectObject(state.pendingSelectId)
      state.pendingSelectId = null
    }
    saveDraft()
  }
  if (state.dragging) {
    state.dragging = null
    state.snappingId = null
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch {}
    if (state.pendingSelectId) {
      selectObject(state.pendingSelectId)
      state.pendingSelectId = null
    }
    saveDraft()
  }
  if (state.panning) {
    state.panning = null
    canvasStage.classList.remove('panning')
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch {}
  }
}

function zoomAt(event) {
  event.preventDefault()
  const rect = canvasStage.getBoundingClientRect()
  const beforeX = (event.clientX - rect.left - state.transform.x) / state.transform.scale
  const beforeY = (event.clientY - rect.top - state.transform.y) / state.transform.scale
  const delta = event.deltaY > 0 ? -0.08 : 0.08
  const nextScale = Math.max(0.35, Math.min(2.2, state.transform.scale + delta))
  state.transform.x = event.clientX - rect.left - beforeX * nextScale
  state.transform.y = event.clientY - rect.top - beforeY * nextScale
  state.transform.scale = nextScale
  applyTransform()
}

// ── Button actions ──

export function addNote() {
  const object = {
    id: uid('note'),
    type: 'note',
    x: 120 + state.objects.length * 18,
    y: 120 + state.objects.length * 18,
    width: 280,
    height: 170,
    title: 'New governed note',
    status: 'draft',
    body: 'Local note draft. Persist through IndexedDB only until EdgeGDE applies a server-side mutation.'
  }
  createProposal('add_note', 'Add a local note object to the canvas.', [{ kind: 'add_object', object }])
}

export function addSandboxApp() {
  const object = {
    id: uid('app'),
    type: 'mcp-app',
    x: 180 + state.objects.length * 22,
    y: 160 + state.objects.length * 22,
    width: 420,
    height: 260,
    title: 'Sandboxed MCP App shell',
    status: 'pending_policy',
    body: 'App UI is sandboxed. MCP calls require EdgeGDE broker, policy, audit, and explicit permission scope.'
  }
  createProposal('add_sandbox_mcp_app', 'Add a sandboxed MCP App shell.', [{ kind: 'add_object', object }])
}

export function fitSelected() {
  const selected = state.objects.filter((object) => isSelected(object.id))
  if (!selected.length) return
  const rect = canvasStage.getBoundingClientRect()
  const bounds = selected.reduce((result, object) => {
    result.left = Math.min(result.left, object.x)
    result.top = Math.min(result.top, object.y)
    result.right = Math.max(result.right, object.x + object.width)
    result.bottom = Math.max(result.bottom, object.y + object.height)
    return result
  }, { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity })
  const width = bounds.right - bounds.left
  const height = bounds.bottom - bounds.top
  state.transform.scale = Math.min(1.6, Math.max(0.6, rect.width / (width + 120), rect.height / (height + 120)))
  state.transform.x = rect.width / 2 - (bounds.left + width / 2) * state.transform.scale
  state.transform.y = rect.height / 2 - (bounds.top + height / 2) * state.transform.scale
  applyTransform()
}

export function resetView() {
  state.transform = { x: 0, y: 0, scale: 1 }
  applyTransform()
}

// ── Template loaders ──

export function loadEmptyTemplate() {
  createProposal('load_empty_canvas_template', 'Load empty-canvas onboarding template.', [{ kind: 'clear_objects' }])
}

export function loadBundleTemplate() {
  const object = {
    id: uid('bundle'),
    type: 'bundle-review',
    x: 150,
    y: 150,
    width: 420,
    height: 260,
    title: 'Workspace bundle import review',
    status: 'pending_review',
    body: 'Review manifest, permissions, provenance, and restore target before importing.'
  }
  createProposal('review_workspace_bundle', 'Create workspace bundle review object.', [{ kind: 'add_object', object }])
}

export function loadCalculatorTemplate() {
  const object = {
    id: uid('calculator'),
    type: 'mcp-app',
    x: 180,
    y: 180,
    width: 460,
    height: 300,
    title: 'Mortgage calculator iframe',
    status: 'trusted_native_or_sandbox',
    variant: 'edge-calculator',
    body: 'Mortgage calculator rendered inside the sandboxed iframe window. Inputs calculate locally; EdgeGDE policy/audit governs any action.'
  }
  createProposal('add_edge_calculator_sandbox', 'Add Edge Calculator as sandboxed iframe.', [{ kind: 'add_object', object }])
}

// ── Setup: wire up event listeners using event delegation ──

export function setupInteractionHandlers() {
  // Use event delegation on canvasViewport for object pointerdown
  canvasViewport.addEventListener('pointerdown', (event) => {
    const objectEl = event.target.closest('.canvas-object')
    if (objectEl) {
      beginObjectPointerDown(event, objectEl.dataset.id)
    }
  })

  canvasStage.addEventListener('pointerdown', beginPan)
  document.addEventListener('pointermove', movePointer)
  document.addEventListener('pointerup', endPointer)
  document.addEventListener('pointercancel', endPointer)
  canvasStage.addEventListener('wheel', zoomAt, { passive: false })

  document.getElementById('add-note').addEventListener('click', addNote)
  document.getElementById('add-app').addEventListener('click', addSandboxApp)
  document.getElementById('fit-selected').addEventListener('click', fitSelected)
  document.getElementById('reset-view').addEventListener('click', resetView)
  document.getElementById('empty-template').addEventListener('click', loadEmptyTemplate)
  document.getElementById('bundle-template').addEventListener('click', loadBundleTemplate)
  document.getElementById('calculator-template').addEventListener('click', loadCalculatorTemplate)
}
