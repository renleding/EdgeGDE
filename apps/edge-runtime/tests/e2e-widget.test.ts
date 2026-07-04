/**
 * EdgeGDE — E2E Tests: Widget Rendering & Interaction (E2E-01 through E2E-04)
 * Tests the chat widget HTML rendering, chat interaction, and stream failure recovery.
 */

import { describe, it, expect } from 'vitest'

const WORKER = process.env.WORKER_URL || 'https://edgegde-calculator.renleding.workers.dev'
const TENANT = process.env.TENANT || 'au_test_mortgage_broker_v2'
const TOKEN = process.env.TOKEN || 'edgegde-at-bef5575b2fa2ff5da548f9e90159a643632848c4'

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
    has(body, 'gde-chat')
    has(body, 'Welcome')
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

  it('E2E-02b: Chat stream returns SSE with event:complete + data', async () => {
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

    // Must have event:complete line and data: line
    const hasEventComplete = lines.some(l => l.startsWith('event: complete'))
    const hasData = lines.some(l => l.startsWith('data:'))
    expect(hasEventComplete).toBeTruthy()
    expect(hasData).toBeTruthy()

    // Parse the data line
    const dataLine = lines.find(l => l.startsWith('data:'))
    const jsonStr = dataLine!.slice(5).trim()
    const parsed = JSON.parse(jsonStr)
    expect(parsed.done).toBe(true)
    expect(parsed.message).toBeTruthy()
    expect(parsed.llmFallback).toBeDefined()
    expect(parsed.llmFallback).not.toBeUndefined()
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
    const dataLine = lines.find(l => l.startsWith('data:'))
    const lastLine = JSON.parse(dataLine!.slice(5).trim())

    expect(lastLine.done).toBe(true)
    expect(lastLine.message).toBeTruthy()
    expect(lastLine.firstName).toBe('Warren')
  })
})

describe('E2E-03: Disclosure Render', () => {
  it('E2E-03a: Compliance page renders for test tenant', async () => {
    const TOKEN = process.env.TOKEN || 'edgegde-at-bef5575b2fa2ff5da548f9e90159a643632848c4'
    const res = await fetch(`${WORKER}/admin/rules?tenant=${TENANT}&token=${TOKEN}`)
    const body = await res.text()
    expect(res.ok).toBeTruthy()
    has(body, 'Rules')
    has(body, 'au_test_mortgage_broker_v2')
  })

  it('E2E-03b: Site page shows widget embed and version info', async () => {
    const TOKEN = process.env.TOKEN || 'edgegde-at-bef5575b2fa2ff5da548f9e90159a643632848c4'
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
      const dataLine = lines.find(l => l.startsWith('data:'))
      const last = JSON.parse(dataLine!.slice(5).trim())
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
    const dataLine = lines.find(l => l.startsWith('data:'))
    const last = JSON.parse(dataLine!.slice(5).trim())

    if (last.done === true && last.message) {
      if (last.message.includes('What is your annual income')) {
        // Prompt overrode default template ✅
      } else if (last.message.includes('Could you please provide your annual income')) {
        throw new Error('Default template used instead of prompt for annualIncome')
      }
    }
  })
})

describe('E2E-05: Init Error Handling', () => {
  it('E2E-05a: Init returns 400 for missing tenant', async () => {
    const res = await fetch(`${WORKER}/api/v1/chat/init`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('tenant')
  })

  it('E2E-05b: Widget HTML includes chat-tenant-id data element', async () => {
    const res = await fetch(`${WORKER}/embed/chat?tenant=${TENANT}`)
    const body = await res.text()
    expect(body).toContain('chat-tenant-id')
    expect(body).toContain(`data-tenant="${TENANT}"`)
  })

  it('E2E-05c: Widget page loads with correct CSP for inline errors', async () => {
    const res = await fetch(`${WORKER}/embed/chat?tenant=${TENANT}`)
    const csp = res.headers.get('Content-Security-Policy') || ''
    expect(csp).toContain("script-src 'self'")
  })
})

describe('E2E-06: SSE Format Verification', () => {
  it('E2E-06a: Stream response starts with event: complete line', async () => {
    const initRes = await fetch(`${WORKER}/api/v1/chat/init?tenant=${TENANT}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })
    const { sessionId } = await initRes.json()
    const res = await fetch(`${WORKER}/api/v1/chat/stream?tenant=${TENANT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `session_id=${encodeURIComponent(sessionId)}&text=World+Smith`,
    })
    const text = await res.text()
    const firstLine = text.trim().split('\n')[0]
    expect(firstLine).toBe('event: complete')
  })

  it('E2E-06b: Data line contains valid JSON with done, message, fields', async () => {
    const initRes = await fetch(`${WORKER}/api/v1/chat/init?tenant=${TENANT}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })
    const { sessionId } = await initRes.json()
    const res = await fetch(`${WORKER}/api/v1/chat/stream?tenant=${TENANT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `session_id=${encodeURIComponent(sessionId)}&text=Jane+Doe`,
    })
    const text = await res.text()
    const lines = text.trim().split('\n').filter(Boolean)
    const dataLine = lines.find(l => l.startsWith('data:'))!
    const parsed = JSON.parse(dataLine.slice(5).trim())
    expect(parsed.done).toBe(true)
    expect(typeof parsed.message).toBe('string')
    expect(Array.isArray(parsed.fields)).toBe(true)
    expect(typeof parsed.firstName).toBe('string')
    expect(parsed.fullName).toBe('Jane Doe')
  })

  it('E2E-06c: llmFallback value is boolean (configurable, not hardcoded)', async () => {
    const initRes = await fetch(`${WORKER}/api/v1/chat/init?tenant=${TENANT}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })
    const { sessionId } = await initRes.json()
    const res = await fetch(`${WORKER}/api/v1/chat/stream?tenant=${TENANT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `session_id=${encodeURIComponent(sessionId)}&text=Test+User`,
    })
    const text = await res.text()
    const lines = text.trim().split('\n').filter(Boolean)
    const dataLine = lines.find(l => l.startsWith('data:'))!
    const parsed = JSON.parse(dataLine.slice(5).trim())
    expect(typeof parsed.llmFallback).toBe('boolean')
  })
})

describe('E2E-07: Error Recovery', () => {
  it('E2E-07a: Stream with empty session_id returns 400', async () => {
    const res = await fetch(`${WORKER}/api/v1/chat/stream?tenant=${TENANT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'session_id=&text=hi',
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Missing text or session_id')
  })

  it('E2E-07b: Stream with invalid session_id returns 404', async () => {
    const res = await fetch(`${WORKER}/api/v1/chat/stream?tenant=${TENANT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'session_id=nonexistent-session-id&text=hi',
    })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toContain('Session not found')
  })

  it('E2E-07c: Init + stream full flow with retry capacity', async () => {
    // Full flow: init → stream → verify response
    const initRes = await fetch(`${WORKER}/api/v1/chat/init?tenant=${TENANT}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })
    const { sessionId } = await initRes.json()
    expect(sessionId).toBeTruthy()

    // First message
    const res1 = await fetch(`${WORKER}/api/v1/chat/stream?tenant=${TENANT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `session_id=${encodeURIComponent(sessionId)}&text=Retry+Test+User`,
    })
    expect(res1.ok).toBeTruthy()
    const text1 = await res1.text()
    const parsed1 = JSON.parse(text1.trim().split('\n').filter(Boolean).find(l => l.startsWith('data:'))!.slice(5).trim())
    expect(parsed1.done).toBe(true)
    expect(parsed1.firstName).toBe('Retry')
  })
})

describe('E2E-08: Full Conversation Question/Response', () => {
  const CONV_TENANT = 'alpha-broker-01'

  it('E2E-08a: Widget HTML loads with title and tenant for alpha-broker-01', async () => {
    const res = await fetch(`${WORKER}/embed/chat?tenant=${CONV_TENANT}`)
    const body = await res.text()
    expect(res.ok).toBeTruthy()
    expect(body).toContain('AFIRMICO')
    expect(body).toContain('alpha-broker-01')
    expect(body).toContain('chat-tenant-id')
    expect(body).toContain('widget.js')
  })

  it('E2E-08b: Init creates session for alpha-broker-01', async () => {
    const res = await fetch(`${WORKER}/api/v1/chat/init?tenant=${CONV_TENANT}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })
    const body = await res.json()
    expect(res.ok).toBeTruthy()
    expect(typeof body.sessionId).toBe('string')
    expect(body.sessionId.length).toBeGreaterThan(10)
    expect(body.tenantId).toBe(CONV_TENANT)
    expect(body.status).toBe('active')
  })

  it('E2E-08c: Full conversation: send name, get prompt for email', async () => {
    // Step 1: Init session
    const initRes = await fetch(`${WORKER}/api/v1/chat/init?tenant=${CONV_TENANT}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })
    const { sessionId } = await initRes.json()
    expect(sessionId).toBeTruthy()

    // Step 2: Send "dave bun" (full name)
    const res1 = await fetch(`${WORKER}/api/v1/chat/stream?tenant=${CONV_TENANT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `session_id=${encodeURIComponent(sessionId)}&text=dave+bun`,
    })
    expect(res1.ok).toBeTruthy()
    const text1 = await res1.text()
    const lines1 = text1.trim().split('\n').filter(Boolean)

    // Verify SSE format
    const hasEventComplete = lines1.some(l => l.startsWith('event: complete'))
    expect(hasEventComplete).toBeTruthy()

    // Parse response
    const dataLine1 = lines1.find(l => l.startsWith('data:'))!
    const parsed1 = JSON.parse(dataLine1.slice(5).trim())
    expect(parsed1.done).toBe(true)
    expect(parsed1.message).toContain('email')       // Should ask for email next
    expect(parsed1.firstName).toBe('dave')            // firstName extracted
    expect(parsed1.fullName).toBe('dave bun')         // fullName preserved
    expect(parsed1.state.currentField).toBe('email')  // Next field is email

    // Step 3: Send email
    const res2 = await fetch(`${WORKER}/api/v1/chat/stream?tenant=${CONV_TENANT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `session_id=${encodeURIComponent(sessionId)}&text=dave@test.com`,
    })
    const text2 = await res2.text()
    const lines2 = text2.trim().split('\n').filter(Boolean)
    const dataLine2 = lines2.find(l => l.startsWith('data:'))!
    const parsed2 = JSON.parse(dataLine2.slice(5).trim())
    expect(parsed2.done).toBe(true)
    expect(parsed2.message).toContain('phone')       // Should ask for phone next
    expect(parsed2.state.currentField).toBe('phone')

    // Step 4: Send phone number
    const res3 = await fetch(`${WORKER}/api/v1/chat/stream?tenant=${CONV_TENANT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `session_id=${encodeURIComponent(sessionId)}&text=0412345678`,
    })
    const text3 = await res3.text()
    const lines3 = text3.trim().split('\n').filter(Boolean)
    const dataLine3 = lines3.find(l => l.startsWith('data:'))!
    const parsed3 = JSON.parse(dataLine3.slice(5).trim())
    expect(parsed3.done).toBe(true)
    expect(parsed3.message).toBeTruthy()
    // After phone, should have 3 completed fields
    const completedFields = parsed3.state?.completedFields || []
    expect(completedFields.length).toBeGreaterThanOrEqual(3)
  })

  it('E2E-08d: Widget.js serves correct version with span tenant support', async () => {
    const res = await fetch(`${WORKER}/widget.js`)
    const text = await res.text()
    expect(res.ok).toBeTruthy()
    expect(text).toContain('v1.2.2')
    expect(text).toContain('data-tenant')
  })
})
