(() => {
  'use strict'

  const canvasStage = document.getElementById('canvas-stage')
  const canvasViewport = document.getElementById('canvas-viewport')
  const selectionSummary = document.getElementById('selection-summary')
  const workspaceTransient = document.getElementById('workspace-transient')
  const proposalList = document.getElementById('proposal-list')
  const offlineBadge = document.getElementById('offline-badge')
  const missionForm = document.getElementById('mission-form')
  const missionInput = document.getElementById('mission')

  const state = {
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

  const SNAP_THRESHOLD = 22
  const SNAP_GAP = 10
  const MIN_OBJECT_WIDTH = 160
  const MIN_OBJECT_HEIGHT = 120

  const initialObjects = [
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

  function now() {
    return new Date().toISOString()
  }

  function uid(prefix) {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
  }

  function normalizeObject(object) {
    if (object.id === 'edge-calculator-sandbox' || /calculator/i.test(object.title || '')) {
      return {
        ...object,
        title: object.title === 'Edge Calculator sandbox iframe' ? 'Mortgage calculator iframe' : object.title,
        variant: 'edge-calculator'
      }
    }
    return object
  }

  function safeText(value) {
    return String(value || '').replace(/[<>&]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[char]))
  }

  function updateOfflineBadge() {
    offlineBadge.textContent = navigator.onLine ? 'online' : 'offline draft'
    offlineBadge.style.color = navigator.onLine ? 'var(--good)' : 'var(--warn)'
    offlineBadge.style.borderColor = navigator.onLine ? 'rgba(52, 211, 153, 0.35)' : 'rgba(251, 191, 36, 0.35)'
    offlineBadge.style.background = navigator.onLine ? 'rgba(52, 211, 153, 0.08)' : 'rgba(251, 191, 36, 0.08)'
  }

  function mortgageCalculatorSrcdoc() {
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
html,body{width:100%;min-width:0;height:100%;min-height:0}
body{margin:0;padding:clamp(6px,2.5vw,12px);font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#020617;color:#dbeafe;font-size:12px;line-height:1.35;word-break:break-word;overflow-wrap:anywhere;white-space:normal;overflow-x:hidden}
h1{font-size:16px;margin:0 0 8px;color:#66e3ff;overflow-wrap:anywhere}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
label{display:grid;gap:3px;min-width:0;padding:6px;border:1px solid rgba(148,163,184,.14);border-radius:8px;background:rgba(15,23,42,.52)}
label span{color:#9fb3c8;font-size:11px;line-height:1.2;overflow-wrap:anywhere}
input{width:100%;min-width:0;border:1px solid rgba(148,163,184,.28);border-radius:7px;background:#0f172a;color:#e5eefb;padding:7px 8px;font:inherit;font-size:12px}
.results{margin-top:8px;padding:8px;border:1px solid rgba(102,227,255,.25);border-radius:10px;background:rgba(8,47,73,.45);min-width:0;overflow-wrap:anywhere}
.row{display:flex;justify-content:space-between;gap:8px;margin:4px 0;min-width:0}
.total{margin-top:6px;padding-top:6px;border-top:1px solid rgba(226,232,240,.18);font-size:14px;font-weight:800;color:#bbf7d0}
.hint{margin:8px 0 0;color:#94a3b8;font-size:11px}
@media(max-width:520px){.grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<h1>Mortgage Calculator</h1>
<div class="grid">
<label><span>Home price</span><input id="price" data-currency type="text" inputmode="decimal" value="$500,000"></label>
<label><span>Down payment</span><input id="down" data-currency type="text" inputmode="decimal" value="$100,000"></label>
<label><span>Interest rate %</span><input id="rate" type="number" min="0" step="0.01" value="6.5"></label>
<label><span>Term years</span><input id="term" type="number" min="1" step="1" value="30"></label>
<label><span>Property tax / yr</span><input id="tax" data-currency type="text" inputmode="decimal" value="$6,000"></label>
<label><span>Insurance / yr</span><input id="insurance" data-currency type="text" inputmode="decimal" value="$1,800"></label>
<label><span>HOA / mo</span><input id="hoa" data-currency type="text" inputmode="decimal" value="$0"></label>
</div>
<div class="results" id="results"></div>
<p class="hint">Local iframe calculation only. EdgeGDE policy/audit governs any saved or submitted action.</p>
<script>
const $=id=>document.getElementById(id);
const money=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
function rawNumber(id){return Number(String($(id).value).replace(/[^0-9.-]/g,''))||0}
function num(id){return rawNumber(id)}
function calc(){
  const price=num('price'), down=num('down'), rate=num('rate')/100/12, term=num('term')*12;
  const principal=Math.max(0,price-down);
  const payment=principal===0||rate===0?principal/Math.max(1,term):principal*rate/(1-Math.pow(1+rate,-Math.max(1,term)));
  const tax=num('tax')/12, ins=num('insurance')/12, hoa=num('hoa');
  const total=payment+tax+ins+hoa;
  $('results').innerHTML='<div class="row"><span>Principal</span><strong>'+money.format(principal)+'</strong></div>'+
    '<div class="row"><span>Principal & interest</span><strong>'+money.format(payment)+'/mo</strong></div>'+
    '<div class="row"><span>Tax + insurance + HOA</span><strong>'+money.format(tax+ins+hoa)+'/mo</strong></div>'+
    '<div class="row total"><span>Estimated monthly</span><strong>'+money.format(total)+'</strong></div>';
}
function formatCurrencyValue(id){$(id).value=money.format(rawNumber(id))}
document.querySelectorAll('input').forEach(input=>{
  input.addEventListener('input',calc);
  input.addEventListener('keydown',event=>{
    if(event.key==='Enter'){
      event.preventDefault();
      if(input.hasAttribute('data-currency')) formatCurrencyValue(input.id);
      calc();
      input.blur();
    }
  });
});
document.querySelectorAll('[data-currency]').forEach(input=>formatCurrencyValue(input.id));
calc();
</script>
</body>
</html>`
  }

  function objectBody(object) {
    if (object.variant === 'edge-calculator') {
      const srcdoc = mortgageCalculatorSrcdoc().replace(/"/g, '&quot;')
      return `<iframe title="Mortgage calculator iframe" srcdoc="${srcdoc}"></iframe>`
    }
    if (object.type === 'mcp-app') {
      return '<iframe title="Sandboxed MCP App preview" srcdoc="<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><style>html,body{width:100%;min-width:0;height:100%;min-height:0}*{box-sizing:border-box}body{margin:0;padding:clamp(8px,3vw,18px);font-family:system-ui,sans-serif;background:#020617;color:#cbd5e1;word-break:break-word;overflow-wrap:anywhere;line-break:anywhere;white-space:normal;overflow-x:hidden}h1{font-size:18px;margin:0 0 10px;color:#66e3ff;overflow-wrap:anywhere}p{margin:0;max-width:100%;line-height:1.5}</style></head><body><h1>Sandboxed MCP App</h1><p>EdgeGDE brokers policy, audit, and MCP calls. This iframe cannot call MCP servers directly. Text wraps to the iframe width while the window is resized.</p></body></html>"></iframe>'
    }
    if (object.type === 'bundle-review') {
      return '<strong>Bundle review</strong><br>Manifest, permission diff, trust boundary, snapshot target, and restore path are shown before activation.'
    }
    return safeText(object.body || 'Local object draft. Authoritative state remains in EdgeGDE workspace state.')
  }

  function renderObjects() {
    canvasViewport.innerHTML = ''
    for (const object of state.objects) {
      const el = document.createElement('article')
      el.className = `canvas-object${isSelected(object.id) ? ' selected' : ''}${state.snappingId === object.id ? ' snapping' : ''}`
      el.dataset.id = object.id
      el.style.width = `${object.width}px`
      el.style.height = `${object.height}px`
      el.style.transform = `translate(${object.x}px, ${object.y}px)`
      el.innerHTML = `
        <div class="object-handle" data-handle="true">
          <strong>${safeText(object.title)}</strong>
          <span class="object-badge">${safeText(object.type)}</span>
        </div>
        <div class="object-body">${objectBody(object)}</div>
        <div class="resize-handle n" data-resize="n" aria-hidden="true"></div>
        <div class="resize-handle ne" data-resize="ne" aria-hidden="true"></div>
        <div class="resize-handle e" data-resize="e" aria-hidden="true"></div>
        <div class="resize-handle se" data-resize="se" aria-hidden="true"></div>
        <div class="resize-handle s" data-resize="s" aria-hidden="true"></div>
        <div class="resize-handle sw" data-resize="sw" aria-hidden="true"></div>
        <div class="resize-handle w" data-resize="w" aria-hidden="true"></div>
        <div class="resize-handle nw" data-resize="nw" aria-hidden="true"></div>
      `
      el.addEventListener('pointerdown', (event) => beginObjectPointerDown(event, object.id))
      canvasViewport.appendChild(el)
    }
    applyTransform()
    updateSelection()
  }

  function applyTransform() {
    const { x, y, scale } = state.transform
    canvasViewport.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
    canvasStage.style.setProperty('--scale', String(scale))
  }

  function isSelected(id) {
    return state.selectedIds.includes(id)
  }

  function applySelectionClasses() {
    for (const el of canvasViewport.querySelectorAll('.canvas-object')) {
      el.classList.toggle('selected', isSelected(el.dataset.id))
    }
  }

  function selectObjects(ids) {
    const unique = Array.from(new Set(ids.filter((id) => state.objects.some((object) => object.id === id))))
    state.selectedIds = unique
    state.selectedId = unique[0] || null
    applySelectionClasses()
    updateSelection()
  }

  function toggleMultiSelect(id) {
    const selected = isSelected(id)
    const next = selected ? state.selectedIds.filter((item) => item !== id) : [...state.selectedIds, id]
    selectObjects(next)
  }

  function updateSelection() {
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

  function updateObjectElement(object) {
    const el = canvasViewport.querySelector(`[data-id="${object.id}"]`)
    if (!el) return
    el.style.width = `${object.width}px`
    el.style.height = `${object.height}px`
    el.style.transform = `translate(${object.x}px, ${object.y}px)`
    el.classList.toggle('selected', isSelected(object.id))
    el.classList.toggle('snapping', state.snappingId === object.id)
    updateSelection()
  }

  function renderProposals() {
    if (!state.proposals.length) {
      proposalList.innerHTML = '<p class="muted">No pending proposals. Compose an agent instruction to create one.</p>'
      return
    }
    proposalList.innerHTML = state.proposals.map((proposal) => `
      <div class="proposal">
        <div class="proposal-header">
          <strong>${safeText(proposal.intent)}</strong>
          <span class="proposal-status ${safeText(proposal.status)}">${safeText(proposal.status)}</span>
        </div>
        <p class="muted">${safeText(proposal.description)}</p>
        <pre>expectedVersion: ${proposal.expectedVersion}
correlationId: ${proposal.correlationId}
policyDecision: ${proposal.policyDecision}</pre>
        <div class="proposal-actions">
          <button type="button" data-apply="${proposal.correlationId}">Apply</button>
          <button type="button" data-deny="${proposal.correlationId}">Deny</button>
        </div>
      </div>
    `).join('')
  }

  function createProposal(intent, description, mutations) {
    const proposal = {
      intent,
      description,
      mutations,
      expectedVersion: state.version,
      correlationId: uid('proposal'),
      policyDecision: 'pending_review',
      status: 'pending_review',
      createdAt: now()
    }
    state.proposals.unshift(proposal)
    renderProposals()
    saveDraft()
    return proposal
  }

  function applyProposal(proposal) {
    if (proposal.status !== 'pending_review') return
    proposal.status = 'applied'
    proposal.policyDecision = 'approved_by_user'
    for (const mutation of proposal.mutations) {
      if (mutation.kind === 'add_object') {
        state.objects.push(mutation.object)
      }
      if (mutation.kind === 'update_object' && mutation.patch) {
        const object = state.objects.find((item) => item.id === mutation.patch.id)
        if (object) Object.assign(object, mutation.patch)
      }
      if (mutation.kind === 'remove_object') {
        state.objects = state.objects.filter((item) => item.id !== mutation.id)
      }
      if (mutation.kind === 'clear_objects') {
        state.objects = []
        state.selectedId = null
        state.selectedIds = []
      }
    }
    state.version += 1
    state.transient.recentResults = `${proposal.intent} applied locally at ${now()}`
    state.transient.policyState = `approved:${proposal.correlationId}`
    renderObjects()
    renderProposals()
    updateSelection()
    saveDraft()
  }

  function denyProposal(proposal) {
    if (proposal.status !== 'pending_review') return
    proposal.status = 'denied'
    proposal.policyDecision = 'denied_by_user'
    renderProposals()
    saveDraft()
  }

  function beginObjectPointerDown(event, id) {
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

  function selectObject(id) {
    selectObjects([id])
  }

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

  function boxesIntersect(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
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
      const { id } = state.dragging
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

  function addNote() {
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

  function addSandboxApp() {
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

  function fitSelected() {
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

  function resetView() {
    state.transform = { x: 0, y: 0, scale: 1 }
    applyTransform()
  }

  function loadEmptyTemplate() {
    createProposal('load_empty_canvas_template', 'Load empty-canvas onboarding template.', [{ kind: 'clear_objects' }])
  }

  function loadBundleTemplate() {
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

  function loadCalculatorTemplate() {
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

  async function loadTransient() {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 1200)
      const response = await fetch('/api/pwa/workspaces/default/transient', {
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      })
      clearTimeout(timeout)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      state.transient = {
        selected: data.selected || state.transient.selected,
        recentResults: data.recentResults || state.transient.recentResults,
        policyState: data.policyState || state.transient.policyState
      }
      workspaceTransient.textContent = JSON.stringify(state.transient, null, 2)
    } catch {
      workspaceTransient.textContent = JSON.stringify(state.transient, null, 2)
    }
  }

  async function loadProposals() {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 1200)
      const response = await fetch('/api/pwa/workspaces/default/action-proposals', {
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      })
      clearTimeout(timeout)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      if (Array.isArray(data.proposals)) state.proposals = data.proposals.concat(state.proposals)
    } catch {
      // Offline/local draft mode.
    }
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('edgegde-pwa-canvas', 1)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains('drafts')) {
          db.createObjectStore('drafts', { keyPath: 'id' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async function saveDraft() {
    try {
      const db = await openDatabase()
      const tx = db.transaction('drafts', 'readwrite')
      tx.objectStore('drafts').put({
        id: 'canvas-draft',
        version: state.version,
        objects: state.objects,
        proposals: state.proposals,
        transform: state.transform,
        savedAt: now(),
        authority: 'local_draft_only'
      })
      tx.oncomplete = () => db.close()
    } catch {
      // Ignore IndexedDB failures; draft is never authoritative.
    }
  }

  async function loadDraft() {
    try {
      const db = await openDatabase()
      const tx = db.transaction('drafts', 'readonly')
      const request = tx.objectStore('drafts').get('canvas-draft')
      request.onsuccess = () => {
        const draft = request.result
        if (draft && Array.isArray(draft.objects)) {
          state.version = draft.version || 0
          state.objects = draft.objects.map(normalizeObject)
          state.proposals = draft.proposals || []
          state.selectedIds = []
          state.selectedId = null
          state.transform = draft.transform || state.transform
          applyTransform()
        }
        db.close()
      }
    } catch {
      state.objects = initialObjects
    }
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return
    try {
      await navigator.serviceWorker.register('/pwa-canvas/sw.js', { scope: '/pwa-canvas/' })
    } catch {
      // PWA remains functional without service worker registration.
    }
  }

  missionForm.addEventListener('submit', (event) => {
    event.preventDefault()
    const text = missionInput.value.trim()
    if (!text) return
    missionInput.value = ''
    const object = {
      id: uid('agent'),
      type: 'agent-panel',
      x: 220 + state.objects.length * 20,
      y: 140 + state.objects.length * 20,
      width: 360,
      height: 220,
      title: 'Agent mission response',
      status: 'proposal_required',
      body: safeText(text)
    }
    createProposal('agent_canvas_mutation', text, [{ kind: 'add_object', object }])
  })

  proposalList.addEventListener('click', (event) => {
    const applyButton = event.target.closest('[data-apply]')
    const denyButton = event.target.closest('[data-deny]')
    if (applyButton) {
      const proposal = state.proposals.find((item) => item.correlationId === applyButton.dataset.apply)
      if (proposal) applyProposal(proposal)
    }
    if (denyButton) {
      const proposal = state.proposals.find((item) => item.correlationId === denyButton.dataset.deny)
      if (proposal) denyProposal(proposal)
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
  document.getElementById('save-draft').addEventListener('click', saveDraft)
  document.getElementById('empty-template').addEventListener('click', loadEmptyTemplate)
  document.getElementById('bundle-template').addEventListener('click', loadBundleTemplate)
  document.getElementById('calculator-template').addEventListener('click', loadCalculatorTemplate)
  window.addEventListener('online', updateOfflineBadge)
  window.addEventListener('offline', updateOfflineBadge)
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Delete' && state.selectedIds.length) {
      const ids = [...state.selectedIds]
      createProposal('remove_objects', `Remove ${ids.length} selected objects.`, ids.map((id) => ({ kind: 'remove_object', id })))
    }
  })

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
})()
