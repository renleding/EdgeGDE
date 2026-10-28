// @vitest-environment happy-dom
/**
 * Tests for the in-page Design Mode confirmation loop (IDD-016 §13.1 item 7).
 *
 * design-mode.js is a browser IIFE (no module exports) — it is executed via
 * indirect eval against the happy-dom global, then driven through its public
 * surface: window.orcaDesignMode, window.__orcaDesignModeRenderConfirmation,
 * window.__orcaDesignModeDeliverPick.
 *
 * Covers the frozen badge decisions from the IDD-016 bridge review:
 *  - verdict badges: verified vs no_state_change (NEVER a success badge),
 *    false_positive_detected, not_verified
 *  - error envelope → error card with code/retryable/retry_policy
 *  - in-band ACTION_REJECTED → rejection card
 *  - interim notice + sessionStorage pending stash (kept across reloads,
 *    consumed by the full post-reload render)
 *  - execution guard pauses picking; picker own-UI pass-through; overlay is
 *    pointer-events:none so elementFromPoint sees the real page
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import DESIGN_MODE_JS from '../public/design-mode.js?raw'

// The script is a browser IIFE — execute it in global scope (indirect eval)
// where `document`/`window`/`sessionStorage` resolve to the happy-dom globals.
const loadScript = () => {
  // eslint-disable-next-line no-eval
  ;(0, eval)(DESIGN_MODE_JS)
}

// Loose typings for the script's global surface (it is not a module, and this
// tsconfig has no DOM lib — happy-dom provides the runtime globals).
const g = globalThis as any
const document = g.document
const sessionStorage = g.sessionStorage
const MouseEventCtor = g.MouseEvent
const wm = g.window as {
  orcaDesignMode: { enable(): void; disable(): void; isActive(): boolean; setExecutionGuard(b: boolean): void }
  __orcaDesignModeRenderConfirmation(session: unknown): void
  __orcaDesignModeDeliverPick: unknown
  __orcaDesignModePick?: unknown
}
const renderConfirmation = (session: unknown) => wm.__orcaDesignModeRenderConfirmation(session)

// ── fixtures ────────────────────────────────────────────────────────────────

const SHOT = (label: string) => ({
  storage: 'data_uri',
  data_uri: `data:image/png;base64,${label}`,
  mime_type: 'image/png',
  width: 168,
  height: 40,
  sha256: 'a'.repeat(64),
})

const RESOLUTION = {
  status: 'resolved',
  resolution_path: 'exact_backend_node',
  confidence: 1.0,
  element_ref: { backend_dom_node_id: 4821, selector: 'button#sync-toggle', bounds: { x: 640, y: 812, width: 168, height: 40 }, target_id: 'A1B2C3D4E5F6A7B8C9D0' },
  strategy: 'backend_node_exact',
  element_type: 'button',
  action_hints: ['click'],
  known_bug_flags: [],
  known_bug_workarounds: [],
  fallback_match: null,
  action_outcome: null,
}

const baseSession = (over: Record<string, unknown> = {}) => ({
  request_id: '3f6b2a1e-7c4d-4e5f-9a8b-1c2d3e4f5a6b',
  session_id: 'sess-1',
  phase: 'confirmed',
  verdict: 'verified',
  resolution: RESOLUTION,
  element: { tag: 'button', in_portal: false },
  action: { requested_action: { type: 'click' }, executed: true, action_tier: 'CDP' },
  verification: { method: 'state_diff', state_changed: true, diff_summary: 'state changed: url, buttons (2 key(s))', false_positive_guard: null },
  known_bug_flags: [],
  known_bug_workarounds: [],
  before: SHOT('BEFORE'),
  after: SHOT('AFTER'),
  after_element: { via: 'selector', dom_changed: true },
  recapture_error: null,
  reload: { reloaded: true, wait: 'loadEventFired' },
  transport: 'mcp',
  resolver: { version: 'state-engine@1.4.2', latency_ms: 42, node_live: true },
  policy: { decision: 'auto_execute', hint: null },
  warnings: [],
  stage_log: [{ stage: 'pick' }, { stage: 'rendered' }],
  ...over,
})

const panel = () => document.getElementById('confirmationContent')
const panelText = () => (panel()?.textContent || '')
const clickAt = (el: any, x = 100, y = 50) => {
  const ev = new MouseEventCtor('click', { bubbles: true, cancelable: true, clientX: x, clientY: y })
  el.dispatchEvent(ev)
  return ev
}

// ── suite ───────────────────────────────────────────────────────────────────

describe('design-mode.js action confirmation panel (IDD-016 §13.1 item 7)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    sessionStorage.clear()
    loadScript()
  })

  afterEach(() => {
    // detach document-level listeners + controller binding so cases stay isolated
    wm.orcaDesignMode?.disable()
    delete wm.__orcaDesignModePick
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('renders VERIFIED badge + before/after thumbs for a verified session', () => {
    renderConfirmation(baseSession())

    expect(panel()).toBeTruthy()
    const text = panelText()
    expect(text).toContain('VERIFIED — state change confirmed')
    expect(text).toContain('exact_backend_node')
    expect(text).toContain('state changed: url, buttons (2 key(s))')
    expect(text).toContain('CDP') // action tier
    expect(text).toContain('loadEventFired') // hot-reload evidence
    expect(text).toContain('mcp') // transport
    expect(panel()?.querySelector('.badge-green')).toBeTruthy()

    const figs = panel()?.querySelectorAll('figcaption')
    expect(figs?.length).toBe(2)
    expect(figs?.[0]?.textContent).toContain('BEFORE')
    expect(figs?.[1]?.textContent).toContain('AFTER')
    const imgs = panel()?.querySelectorAll('img')
    expect(imgs?.length).toBe(2)
    expect(imgs?.[0]?.src).toContain('BEFORE')
    expect(imgs?.[1]?.src).toContain('AFTER')

    // full render consumes the pending stash
    expect(sessionStorage.getItem('orcaDesignMode.pending')).toBeNull()
  })

  it('shows diff evidence and NEVER a success badge on no_state_change (frozen decision 5)', () => {
    renderConfirmation(baseSession({
      verdict: 'no_state_change',
      verification: { method: 'state_diff', state_changed: false, diff_summary: 'no keys changed', false_positive_guard: null },
    }))

    const text = panelText()
    expect(text).toContain('UNVERIFIED — NO STATE CHANGE')
    expect(text).toContain('NOT a success')
    expect(text).toContain('no keys changed') // diff evidence surfaced
    expect(text).not.toContain('VERIFIED — state change confirmed')
    // identical thumbs still rendered (before == after region)
    expect(panel()?.querySelectorAll('img').length).toBe(2)
  })

  it('renders false_positive_detected and not_verified without a success badge', () => {
    for (const verdict of ['false_positive_detected', 'not_verified'] as const) {
      sessionStorage.clear()
      document.body.innerHTML = ''
      loadScript()
      renderConfirmation(baseSession({ verdict }))
      const text = panelText()
      expect(text).not.toContain('VERIFIED — state change confirmed')
      expect(sessionStorage.getItem('orcaDesignMode.pending')).toBeNull()
    }
    expect(panelText()).toContain('NOT VERIFIED')
  })

  it('renders the resolver error envelope as an error card (frozen decision 4)', () => {
    renderConfirmation(baseSession({
      phase: 'error',
      verdict: null,
      error: {
        code: 'RESOLVER_UNREACHABLE',
        message: 'Design Mode transport failed: both transports failed',
        retryable: true,
        retry_policy: 'backoff',
        details: { transports_attempted: ['mcp', 'http'], ladder_ms: [5000, 15000] },
        known_bug_flags: [],
      },
    }))

    const text = panelText()
    expect(text).toContain('ERROR RESOLVER_UNREACHABLE')
    expect(text).toContain('retryable')
    expect(text).toContain('true')
    expect(text).toContain('backoff')
    expect(text).toContain('transports_attempted') // details collapsible
    // error phase: no resolution provenance section, no success badge
    expect(text).not.toContain('VERIFIED — state change confirmed')
  })

  it('renders in-band ACTION_REJECTED as a rejection card', () => {
    renderConfirmation(baseSession({
      phase: 'rejection',
      verdict: null,
      rejection: { code: 'ACTION_REJECTED', reason_code: 'no_action_hint', reason: 'Resolver declined the action in-band' },
    }))

    const text = panelText()
    expect(text).toContain('ACTION REJECTED')
    expect(text).toContain('ACTION_REJECTED')
    expect(text).toContain('Resolver declined the action in-band')
    expect(text).not.toContain('VERIFIED — state change confirmed')
  })

  it('a reloading-phase session renders the interim notice and clears the stash (full render)', () => {
    // The controller writes the stash itself before the hot-reload; a FULL
    // render (interim=false) always consumes it — even for a reloading phase.
    sessionStorage.setItem('orcaDesignMode.pending', JSON.stringify(baseSession({ phase: 'reloading' })))

    renderConfirmation(baseSession({ phase: 'reloading' }))

    expect(panelText()).toContain('re-capturing')
    expect(sessionStorage.getItem('orcaDesignMode.pending')).toBeNull()
  })

  it('hot-reload round-trip: stash → restore interim (kept) → injected full render (consumed)', () => {
    // 1) controller stashes the interim payload before Page.reload
    sessionStorage.setItem('orcaDesignMode.active', '1')
    sessionStorage.setItem('orcaDesignMode.pending', JSON.stringify(baseSession({ phase: 'reloading' })))

    // 2) fresh document: the script re-executes at document-start and restores
    document.body.innerHTML = ''
    loadScript()

    expect(wm.orcaDesignMode.isActive()).toBe(true)
    const fab = document.getElementById('orca-design-mode-fab')
    expect(fab?.textContent).toContain('Design Mode ON')
    // interim notice from the stash is visible until the controller injects
    // the full payload — interim semantics keep the stash alive
    expect(panelText()).toContain('re-capturing')
    expect(sessionStorage.getItem('orcaDesignMode.pending')).toBeTruthy()

    // 3) controller injects the full payload post-reload → consumes the stash
    renderConfirmation(baseSession())
    expect(panelText()).toContain('VERIFIED — state change confirmed')
    expect(sessionStorage.getItem('orcaDesignMode.pending')).toBeNull()
  })

  it('execution guard pauses picking; release resumes it', async () => {
    wm.orcaDesignMode.enable()
    // simulate the attached Orca CDP controller binding
    wm.__orcaDesignModePick = () => {}
    const deliver = vi.fn()
    wm.__orcaDesignModeDeliverPick = deliver
    const btn = document.createElement('button')
    btn.id = 'sync-toggle'
    btn.textContent = 'Enable sync'
    document.body.appendChild(btn)
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(btn)

    wm.orcaDesignMode.setExecutionGuard(true)
    clickAt(btn)
    await new Promise((r) => setTimeout(r, 10))
    expect(deliver).not.toHaveBeenCalled()

    wm.orcaDesignMode.setExecutionGuard(false)
    clickAt(btn)
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1))
    const payload = deliver.mock.calls[0][0]
    expect(payload.schema_version).toBe('1.0.0')
    expect(payload.element.dom_snapshot.tag).toBe('button')
    expect(payload.element.backend_dom_node_id).toBe(0) // upgraded by the CDP controller
  })

  it('picker clicks suppress the page’s own handlers; own-UI clicks pass through', async () => {
    wm.orcaDesignMode.enable()
    wm.__orcaDesignModePick = () => {}
    const deliver = vi.fn()
    wm.__orcaDesignModeDeliverPick = deliver

    const btn = document.createElement('button')
    btn.id = 'save'
    document.body.appendChild(btn)
    const pageHandler = vi.fn()
    btn.addEventListener('click', pageHandler)
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(btn)

    const ev = clickAt(btn, 10, 10)
    expect(ev.defaultPrevented).toBe(true) // pick is not an activation
    expect(pageHandler).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1))

    // own-UI click: elementFromPoint returns the FAB → passes through unsuppressed
    deliver.mockClear()
    const fab = document.getElementById('orca-design-mode-fab')
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(fab)
    const ev2 = clickAt(fab, 5, 5)
    expect(ev2.defaultPrevented).toBe(false)
    expect(deliver).not.toHaveBeenCalled()
  })

  it('overlay is pointer-events:none so elementFromPoint sees the real page (picker dead-zone fix)', () => {
    wm.orcaDesignMode.enable()
    const overlay = document.getElementById('orca-design-mode-overlay')
    expect(overlay).toBeTruthy()
    expect(overlay?.style.pointerEvents).toBe('none')
    // highlight is also non-interactive
    const highlight = document.getElementById('orca-design-mode-highlight')
    expect(highlight?.style.pointerEvents).toBe('none')
  })

  it('disable() removes the overlay and clears Design Mode session state', () => {
    wm.orcaDesignMode.enable()
    sessionStorage.setItem('orcaDesignMode.pending', '{"phase":"reloading"}')
    expect(document.getElementById('orca-design-mode-root')).toBeTruthy()

    wm.orcaDesignMode.disable()
    expect(document.getElementById('orca-design-mode-root')).toBeNull()
    expect(sessionStorage.getItem('orcaDesignMode.active')).toBeNull()
    expect(sessionStorage.getItem('orcaDesignMode.pending')).toBeNull()
    expect(wm.orcaDesignMode.isActive()).toBe(false)
  })

  it('falls back to the same-origin proxy when no CDP binding is attached', async () => {
    wm.orcaDesignMode.enable()
    const btn = document.createElement('button')
    btn.id = 'save'
    document.body.appendChild(btn)
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(btn)

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ transport: 'http_proxy', response: { schema_version: '1.0.0' } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    clickAt(btn)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/design-mode/resolve')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body.schema_version).toBe('1.0.0')
    expect(body.element.screenshot.storage).toBe('data_uri')
  })
})
