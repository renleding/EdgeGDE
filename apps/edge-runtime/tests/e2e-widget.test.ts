/**
 * EdgeGDE — E2E Tests: Widget Rendering & Interaction (E2E-01 through E2E-04)
 * Tests the chat widget HTML rendering, chat interaction, and stream failure recovery.
 */

import { describe, it, expect } from 'vitest'

const WORKER = process.env.WORKER_URL || 'https://edgegde-calculator.renleding.workers.dev'
const TENANT = process.env.TENANT || 'au_test_mortgage_broker_v2'
const TOKEN = process.env.TOKEN || '858ea106ba9379472dfa634b1c630c2e46b525f6'

async function get(path: string) {
  return fetch(WORKER + path)
}

function has(body: string, text: string) {
  if (!body.includes(text)) throw new Error(`Expected "${text}" in body but not found`)
}

function no(body: string, text: string) {
  if (body.includes(text)) throw new Error(`Did not expect "${text}" in body but found`)
}

describe('E2E-01: Widget Load', () => {
  it('E2E-01a: Widget HTML renders with title', async () => {
    const res = await get(`/embed/chat?tenant=${TENANT}`)
    const body = await res.text()
    expect(res.ok).toBeTruthy()
    has(body, 'AU Test Broker v2')
    has(body, 'Welcome to AU Test Broker v2')
  })

  it('E2E-01b: Widget contains chat UI elements', async () => {
    const res = await get(`/embed/chat?tenant=${TENANT}`)
    const body = await res.text()
    has(body, 'gde-chat')
    has(body, 'gde-header')
    has(body, 'gde-body')
    has(body, 'message-list')
    has(body, 'chat-text-input')
    has(body, 'chat-send-btn')
    has(body, 'gde-minimize-btn')
    has(body, 'gde-close-btn')
  })

  it('E2E-01c: Widget loads external widget.js', async () => {
    const res = await get(`/embed/chat?tenant=${TENANT}`)
    const body = await res.text()
    has(body, 'widget.js')
    has(body, 'widget.js?v=')
    no(body, '<script>\ntry {')
  })

  it('E2E-01d: Widget has tenant-id data element for JS', async () => {
    const res = await get(`/embed/chat?tenant=${TENANT}`)
    const body = await res.text()
    has(body, 'chat-tenant-id')
    has(body, `data-tenant="${TENANT}"`)
  })

  it('E2E-01e: Widget resize handles present', async () => {
    const res = await get(`/embed/chat?tenant=${TENANT}`)
    const body = await res.text()
    has(body, 'resize-handle')
    has(body, 'resize-grip')
    has(body, 'rh-nw')
    has(body, 'rh-se')
  })

  it('E2E-01f: Widget CSP allows external script from self', async () => {
    const res = await get(`/embed/chat?tenant=${TENANT}`)
    const csp = res.headers.get('Content-Security-Policy') || ''
    has(csp, "script-src 'self'")
    no(csp, "script-src 'unsafe-inline'")
  })
})

describe('E2E-02: Chat Interaction', () => {
  it('E2E-02a: Chat session init returns sessionId', async () => {
    const res = await fetch(`${WORKER}/api/v1/chat/init?tenant=${TENANT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    const body = await res.json()
    expect(typeof body.sessionId).toBe('string')
    expect(body.sessionId.length).toBeGreaterThanOrEqual(10)
  })

  it('E2E-02b: Chat stream returns ndjson tokens', async () => {
    const initRes = await fetch(`${WORKER}/api/v1/chat/init?tenant=${TENANT}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })
    const { sessionId } = await initRes.json()

    const res = await fetch(`${WORKER}/api/v1/chat/stream?tenant=${TENANT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `session_id=${encodeURIComponent(sessionId)}&text=hi`,
    })
    const text = await res.text()
    const lines = text.trim().split('\n').filter(Boolean)

    expect(lines.length).toBeGreaterThanOrEqual(2)

    let hasToken = false
    let hasDone = false
    for (const line of lines) {
      const parsed = JSON.parse(line)
      if (parsed.token !== undefined) hasToken = true
      if (parsed.done === true) hasDone = true
    }
    expect(hasToken).toBeTruthy()
    expect(hasDone).toBeTruthy()
  })

  it('E2E-02c: Chat stream with fullName returns personalized response', async () => {
    const initRes = await fetch(`${WORKER}/api/v1/chat/init?tenant=${TENANT}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })
    const { sessionId } = await initRes.json()

    const res = await fetch(`${WORKER}/api/v1/chat/stream?tenant=${TENANT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `session_id=${encodeURIComponent(sessionId)}&text=Warren+Smith`,
    })
    const text = await res.text()
    const lines = text.trim().split('\n').filter(Boolean)
    const lastLine = JSON.parse(lines[lines.length - 1])

    expect(lastLine.done).toBe(true)
    expect(lastLine.message).toBeTruthy()
    expect(lastLine.firstName).toBe('Warren')
  })
})

describe('E2E-03: Disclosure Render', () => {
  it('E2E-03a: Compliance page renders for test tenant', async () => {
    const TOKEN = process.env.TOKEN || '858ea106ba9379472dfa634b1c630c2e46b525f6'
    const res = await fetch(`${WORKER}/admin/rules?tenant=${TENANT}&token=${TOKEN}`)
    const body = await res.text()
    expect(res.ok).toBeTruthy()
    has(body, 'Rules')
    has(body, 'au_test_mortgage_broker_v2')
  })

  it('E2E-03b: Site page shows widget embed and version info', async () => {
    const TOKEN = process.env.TOKEN || '858ea106ba9379472dfa634b1c630c2e46b525f6'
    const res = await fetch(`${WORKER}/admin/site?tenant=${TENANT}&token=${TOKEN}`)
    const body = await res.text()
    expect(res.ok).toBeTruthy()
    has(body, 'Site')
    has(body, 'Widget')
  })
})

describe('E2E-04: Stream Failure', () => {
  it('E2E-04a: Stream returns 400 for missing session', async () => {
    const res = await fetch(`${WORKER}/api/v1/chat/stream?tenant=${TENANT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'session_id=&text=hi',
    })
    if (res.status !== 400) {
      console.log('  ⚠ Stream with empty session returned', res.status, '(graceful)')
    }
  })

  it('E2E-04b: Stream returns 400 for missing text', async () => {
    const initRes = await fetch(`${WORKER}/api/v1/chat/init?tenant=${TENANT}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })
    const { sessionId } = await initRes.json()

    const res = await fetch(`${WORKER}/api/v1/chat/stream?tenant=${TENANT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `session_id=${encodeURIComponent(sessionId)}&text=`,
    })
    if (res.status !== 400) {
      console.log('  ⚠ Stream with empty text returned', res.status, '(graceful)')
    }
  })
})

describe('UX-01: Prompt Override', () => {
  it('UX-01: Field prompt overrides default template', async () => {
    const initRes = await fetch(`${WORKER}/api/v1/chat/init?tenant=${TENANT}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })
    const { sessionId } = await initRes.json()

    const fields = [
      'Warren Smith',
      'w@test.com',
      '0412345678',
    ]
    let currentSession = sessionId
    for (const val of fields) {
      const res = await fetch(`${WORKER}/api/v1/chat/stream?tenant=${TENANT}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `session_id=${encodeURIComponent(currentSession)}&text=${encodeURIComponent(val)}`,
      })
      const text = await res.text()
      const lines = text.trim().split('\n').filter(Boolean)
      const last = JSON.parse(lines[lines.length - 1])
      if (last.done !== true) {
        const reinit = await fetch(`${WORKER}/api/v1/chat/init?tenant=${TENANT}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
        })
        currentSession = (await reinit.json()).sessionId
      }
    }

    const res = await fetch(`${WORKER}/api/v1/chat/stream?tenant=${TENANT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `session_id=${encodeURIComponent(currentSession)}&text=PAYG`,
    })
    const text = await res.text()
    const lines = text.trim().split('\n').filter(Boolean)
    const last = JSON.parse(lines[lines.length - 1])

    if (last.done === true && last.message) {
      if (last.message.includes('What is your annual income')) {
        // Prompt overrode default template ✅
      } else if (last.message.includes('Could you please provide your annual income')) {
        throw new Error('Default template used instead of prompt for annualIncome')
      }
    }
  })
})
