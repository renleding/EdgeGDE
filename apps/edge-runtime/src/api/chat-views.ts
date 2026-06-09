/**
 * AFIRMICO — Chat Widget Views + Identity Integration
 * Phase 2.7: HTMX chat widget with embedded identity flow.
 * No redirects, no client-side state, no SPA.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'

export const chatViewsRouter = new Hono()

// ═══ CORS headers for cross-domain embedding ═══
chatViewsRouter.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*')
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  c.header('Access-Control-Allow-Headers', 'Content-Type')
  if (c.req.method === 'OPTIONS') return c.body(null, 204)
  await next()
})

// HMAC_KEY is injected via env.HMAC_KEY at runtime
function getHmacKey(env?: Record<string, unknown>): string {
  const key = env?.HMAC_KEY
  if (!key || typeof key !== 'string') {
    throw new Error('HMAC_KEY environment variable is required')
  }
  return key
}

// ═════════════════════════════════════════════════════════════════════════════
// Session cookie helpers
// ═════════════════════════════════════════════════════════════════════════════

function setSessionCookie(c: any, sessionId: string): void {
  c.header('Set-Cookie', `session_id=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/`)
}

function getSessionIdFromCookie(c: any): string | undefined {
  const cookie = c.req.header('cookie') || ''
  const match = cookie.match(/session_id=([^;]+)/)
  return match ? match[1] : undefined
}

// ═════════════════════════════════════════════════════════════════════════════
// id.ai token generation
// ═════════════════════════════════════════════════════════════════════════════

async function signToken(sessionId: string, email: string, env?: Record<string, unknown>): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(getHmacKey(env)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const data = encoder.encode(`${sessionId}:${email}:${Math.floor(Date.now() / 1000) + 300}`)
  const sig = await crypto.subtle.sign('HMAC', key, data)
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
  return `${sessionId}:${email}:${hex.substring(0, 16)}`
}

async function verifyToken(token: string, env?: Record<string, unknown>): Promise<{ sessionId: string; email: string; valid: boolean }> {
  try {
    const parts = token.split(':')
    if (parts.length !== 3) return { sessionId: '', email: '', valid: false }
    const [sessionId, email] = parts
    const expected = await signToken(sessionId, email, env)
    return { sessionId, email, valid: token === expected }
  } catch {
    return { sessionId: '', email: '', valid: false }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// GET /chat/events — SSE proxy to per-session DO stream
// Session resolved from cookie — client never passes session_id explicitly
// ═════════════════════════════════════════════════════════════════════════════

chatViewsRouter.get('/chat/events', async (c) => {
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  const sessionId = getSessionIdFromCookie(c)

  if (!sessionId) {
    return c.json({ error: 'No session — start a chat first' }, 400)
  }

  const doBinding = (c.env as any)?.AUDIT_LEDGER
  if (!doBinding || typeof doBinding.idFromName !== 'function') {
    return c.json({ error: 'AUDIT_LEDGER binding required' }, 500)
  }

  try {
    const doId = doBinding.idFromName(`tenant:${tenantId}`)
    const stub = doBinding.get(doId)

    // Proxy to the DO's per-session stream endpoint
    const doResponse = await stub.fetch(`http://do/stream?tenantId=${tenantId}&sessionId=${sessionId}`)

    // Return the ReadableStream directly — SSE headers already set by DO
    return new Response(doResponse.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (err: any) {
    return c.json({ error: 'SSE stream failed', details: err.message }, 500)
  }
})

function renderWidgetMessages(collected: Record<string, unknown>): string {
  const items: string[] = []
  const e = (v: unknown) => escapeHtml(String(v ?? ''))
  if (collected.fullName) items.push(`<div style="margin-bottom:8px"><span style="font-size:12px;color:#FFBF00">You</span><div style="padding:8px 12px;background:#2d3140;border-radius:8px;margin-top:2px;font-size:13px">${e(collected.fullName)}</div></div>`)
  if (collected.email) items.push(`<div style="margin-bottom:8px"><span style="font-size:12px;color:#FFBF00">You</span><div style="padding:8px 12px;background:#2d3140;border-radius:8px;margin-top:2px;font-size:13px">${e(collected.email)}</div></div>`)
  if (collected.phone) items.push(`<div style="margin-bottom:8px"><span style="font-size:12px;color:#FFBF00">You</span><div style="padding:8px 12px;background:#2d3140;border-radius:8px;margin-top:2px;font-size:13px">${e(collected.phone)}</div></div>`)
  if (collected.loanAmount) items.push(`<div style="margin-bottom:8px"><span style="font-size:12px;color:#FFBF00">You</span><div style="padding:8px 12px;background:#2d3140;border-radius:8px;margin-top:2px;font-size:13px">Loan: $${Number(collected.loanAmount).toLocaleString()}</div></div>`)
  if (collected.propertyValue) items.push(`<div style="margin-bottom:8px"><span style="font-size:12px;color:#FFBF00">You</span><div style="padding:8px 12px;background:#2d3140;border-radius:8px;margin-top:2px;font-size:13px">Property: $${Number(collected.propertyValue).toLocaleString()}</div></div>`)
  if (collected.employmentType) items.push(`<div style="margin-bottom:8px"><span style="font-size:12px;color:#FFBF00">You</span><div style="padding:8px 12px;background:#2d3140;border-radius:8px;margin-top:2px;font-size:13px">${e(collected.employmentType)}</div></div>`)
  return items.join('\n') || '<div style="font-size:12px;color:#4a4d55;text-align:center;padding:12px">No messages yet</div>'
}

// ═════════════════════════════════════════════════════════════════════════════
// POST /chat/widget-action — proxy tool dispatch, return message HTML
// ═════════════════════════════════════════════════════════════════════════════

chatViewsRouter.post('/chat/widget-action', async (c) => {
  const db = (c.env as any)?.DB
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  const sessionId = getSessionIdFromCookie(c)
  if (!sessionId) return c.html(renderWidgetMessages({}))

  let text = ''
  try {
    const fd = await c.req.formData()
    text = (fd.get('text') as string || '').trim()
  } catch { return c.html(renderWidgetMessages({})) }
  if (!text) return c.html(renderWidgetMessages({}))

  // Forward to tool dispatch and wait for result
  let responseCollected: Record<string, unknown> = {}
  try {
    const base = new URL(c.req.url)
    base.pathname = '/api/v1/chat/tool'
    base.search = `tenant=${tenantId}`
    const toolRes = await fetch(base.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `tool=chat&session_id=${encodeURIComponent(sessionId)}&text=${encodeURIComponent(text)}`,
    })
    if (toolRes.ok) {
      const body: any = await toolRes.json()
      console.log('[widget-action] tool response:', JSON.stringify(body))
      if (body.state?.collected && Object.keys(body.state.collected).length > 0) {
        responseCollected = body.state.collected
      } else {
        // Read from D1 as fallback
        responseCollected = await readCollected(db, sessionId, tenantId)
      }
      // If still no collected fields, render the tool's response as a system message
      if (Object.keys(responseCollected).length === 0) {
        const prompt = body.nextLabel
          ? `What is your ${body.nextLabel.toLowerCase()}?`
          : body.message || ''
        if (prompt) {
          return c.html(`<div style="margin-bottom:8px"><span style="font-size:12px;color:#FFBF00">You</span><div style="padding:8px 12px;background:#2d3140;border-radius:8px;margin-top:2px;font-size:13px">${escapeHtml(text)}</div></div><div style="margin-bottom:8px"><span style="font-size:12px;color:#58a6ff">AFIRMICO</span><div style="padding:8px 12px;background:#1c2128;border:1px solid #2d3140;border-radius:8px;margin-top:2px;font-size:13px">${escapeHtml(prompt)}</div></div>`)
        }
      }
    }
  } catch {
    responseCollected = await readCollected(db, sessionId, tenantId)
  }

  return c.html(renderWidgetMessages(Object.keys(responseCollected).length > 0 ? responseCollected : await readCollected(db, sessionId, tenantId)))
})

async function readCollected(db: any, sessionId: string, tenantId: string): Promise<Record<string, unknown>> {
  let collected: Record<string, unknown> = {}
  try {
    if (sessionId && db) {
      const s: any = await db.prepare(
        `SELECT collected_fields_json FROM chat_sessions WHERE id = ? AND tenant_id = ?`
      ).bind(sessionId, tenantId).first()
      if (s?.collected_fields_json) collected = JSON.parse(s.collected_fields_json as string)
    }
  } catch {}
  return collected
}

// ═════════════════════════════════════════════════════════════════════════════
// GET /chat/messages — returns just the message list HTML fragment
// Includes system prompts when no data has been collected yet
// ═════════════════════════════════════════════════════════════════════════════

chatViewsRouter.get('/chat/messages', async (c) => {
  const db = (c.env as any)?.DB
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  const sessionId = getSessionIdFromCookie(c)
  if (!sessionId) return c.html('')

  let collected: Record<string, unknown> = {}
  let stateJson: string = ''
  try {
    if (sessionId && db) {
      const session: any = await db.prepare(
        `SELECT collected_fields_json, state_json, objective FROM chat_sessions WHERE id = ? AND tenant_id = ?`
      ).bind(sessionId, tenantId).first()
      if (session?.collected_fields_json) {
        collected = JSON.parse(session.collected_fields_json as string)
      }
      if (session?.state_json) {
        stateJson = session.state_json as string
      }
    }
  } catch {}

  // If no data collected yet, show a welcome prompt
  if (Object.keys(collected).length === 0) {
    const items: string[] = []
    items.push(`<div style="margin-bottom:8px"><span style="font-size:12px;color:#58a6ff">AFIRMICO</span><div style="padding:8px 12px;background:#1c2128;border:1px solid #2d3140;border-radius:8px;margin-top:2px;font-size:13px">Welcome! Let's get started with your application. What is your full name?</div></div>`)
    return c.html(items.join('\n'))
  }

  // Return the last few collected fields as messages
  const msgsLabel = escapeHtml(getDisplayName(collected))
  const items: string[] = []
  if (collected.fullName) items.push(`<div style="margin-bottom:8px"><span style="font-size:12px;color:#FFBF00">${msgsLabel}</span><div style="padding:8px 12px;background:#2d3140;border-radius:8px;margin-top:2px;font-size:13px">${escapeHtml(String(collected.fullName))}</div></div>`)
  if (collected.email) items.push(`<div style="margin-bottom:8px"><span style="font-size:12px;color:#FFBF00">${msgsLabel}</span><div style="padding:8px 12px;background:#2d3140;border-radius:8px;margin-top:2px;font-size:13px">${escapeHtml(String(collected.email))}</div></div>`)
  if (collected.loanAmount) items.push(`<div style="margin-bottom:8px"><span style="font-size:12px;color:#FFBF00">${msgsLabel}</span><div style="padding:8px 12px;background:#2d3140;border-radius:8px;margin-top:2px;font-size:13px">Loan: $${Number(collected.loanAmount).toLocaleString()}</div></div>`)
  if (collected.phone) items.push(`<div style="margin-bottom:8px"><span style="font-size:12px;color:#FFBF00">${msgsLabel}</span><div style="padding:8px 12px;background:#2d3140;border-radius:8px;margin-top:2px;font-size:13px">${escapeHtml(String(collected.phone))}</div></div>`)

  return c.html(items.join('\n') || '<div style="font-size:12px;color:#4a4d55;text-align:center;padding:12px">No messages yet</div>')
})
// ═════════════════════════════════════════════════════════════════════════════

chatViewsRouter.get('/chat/view', async (c) => {
  const db = (c.env as any)?.DB
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'
  let sessionId = getSessionIdFromCookie(c)

  // Start fresh on every page load — only persist sessions for verified identities
  // Check if the existing session has a verified identity before reusing
  let existingVerified = false
  if (sessionId) {
    try {
      const existing = await (c.env as any)?.DB?.prepare(
        `SELECT collected_fields_json FROM chat_sessions WHERE id = ? AND tenant_id = ?`
      ).bind(sessionId, c.req.query('tenant') || 'au-mortgage-broker-afirmico').first()
      if (existing?.collected_fields_json) {
        const fields = JSON.parse(existing.collected_fields_json as string)
        if (fields.kyc_status === 'verified') existingVerified = true
      }
    } catch {}
  }
  if (!existingVerified) { sessionId = undefined as any }

  // Resolve session via identity levels
  let uiMode = 'chat'
  let collected: Record<string, unknown> = {}

  // If no session cookie, create a new session
  if (!sessionId) {
    sessionId = crypto.randomUUID()
    if (db) {
      await db.prepare(
        `INSERT INTO chat_sessions (id, tenant_id, objective, state_json, collected_fields_json, status, created_at, updated_at)
         VALUES (?, ?, 'chat_widget', '{}', '{}', 'active', ?, ?)`
      ).bind(sessionId, tenantId, Date.now(), Date.now()).run()
    }
    // Set cookie so subsequent requests have it
    setSessionCookie(c, sessionId)
  }

  try {
    // Priority 1: verified identity — find by session cookie
    if (sessionId) {
      const session: any = await db?.prepare(
        `SELECT collected_fields_json, status, objective FROM chat_sessions WHERE id = ? AND tenant_id = ?`
      ).bind(sessionId, tenantId).first()

      if (session) {
        if (session.status === 'complete') uiMode = 'resumed_session'
        if (session.collected_fields_json) {
          collected = JSON.parse(session.collected_fields_json as string)
        }
      }
    }

    // Determine if we need identity registration
    const hasIdentity = collected.email && collected.fullName
    if (hasIdentity && !collected.kyc_status) {
      // Check if identity_registered event exists in DO
      uiMode = 'awaiting_identity_registration'
    }
  } catch {}

  // Load chat config for branding
  let chatTitle = 'AFIRMICO Finance'
  let chatColor = '#58a6ff'
  try {
    const kv = (c.env as any)?.TENANT_KV
    if (kv) {
      const { loadChatConfig } = await import('../lib/chat-config')
      const cfg = await loadChatConfig(kv, tenantId)
      if (cfg.ui?.title) chatTitle = cfg.ui.title
      if (cfg.ui?.colorAccent) chatColor = cfg.ui.colorAccent
    }
  } catch {}

  return c.html(renderChat(uiMode, collected, sessionId || '', chatTitle, chatColor))
})

// ═════════════════════════════════════════════════════════════════════════════
// renderChat — produce HTMX chat widget HTML based on UI mode
// ═════════════════════════════════════════════════════════════════════════════

function renderChat(uiMode: string, collected: Record<string, unknown>, sessionId: string, title: string = 'AFIRMICO', colorAccent: string = '#58a6ff'): string {
  const messages = renderMessages(collected)

  switch (uiMode) {
    case 'awaiting_identity_registration':
      return renderWidget(
        renderIdAiStep(sessionId, collected.email as string || ''),
        'awaiting-identity',
        sessionId,
        title,
        colorAccent
      )

    case 'identity_verifying':
      return renderWidget(
        `<div style="text-align:center;padding:20px">
           <div style="font-size:14px;margin-bottom:8px">Verifying your identity...</div>
           <div style="width:24px;height:24px;border:2px solid #2d3140;border-top-color:${escapeHtml(colorAccent)};border-radius:50%;animation:spin 1s linear infinite;margin:0 auto"></div>
         </div>`,
        'verifying',
        sessionId,
        title,
        colorAccent
      )

    case 'resumed_session':
      return renderWidget(
        `<div style="padding:12px;font-size:13px;color:#FFBF00;border-bottom:1px solid #2d3140;margin-bottom:8px">Welcome back</div>
         ${messages}`,
        'resumed',
        sessionId,
        title,
        colorAccent
      )

    default:
      return renderWidget(
        `<div style="padding:12px;font-size:13px;color:#FFBF00;border-bottom:1px solid #2d3140;margin-bottom:8px">Start by telling us about yourself</div>
         ${messages}`,
        'chat',
        sessionId,
        title,
        colorAccent
      )
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

function getDisplayName(collected: Record<string, unknown>): string {
  if (collected.firstName && String(collected.firstName).trim()) return String(collected.firstName).trim()
  if (collected.fullName) {
    const first = String(collected.fullName).split(' ')[0]
    if (first.length > 1 && /^[A-Za-z]/.test(first)) return first
  }
  return 'You'
}

function renderMessages(collected: Record<string, unknown>): string {
  const nameLabel = escapeHtml(getDisplayName(collected))
  const items: string[] = []
  if (collected.fullName) items.push(`<div style="margin-bottom:6px"><span style="font-size:11px;color:#FFBF00">${nameLabel}</span><div style="padding:6px 10px;background:#2d3140;border-radius:8px;margin-top:2px;font-size:13px">${escapeHtml(String(collected.fullName))}</div></div>`)
  if (collected.email) items.push(`<div style="margin-bottom:6px"><span style="font-size:11px;color:#FFBF00">${nameLabel}</span><div style="padding:6px 10px;background:#2d3140;border-radius:8px;margin-top:2px;font-size:13px">${escapeHtml(String(collected.email))}</div></div>`)
  if (collected.loanAmount) items.push(`<div style="margin-bottom:6px"><span style="font-size:11px;color:#FFBF00">${nameLabel}</span><div style="padding:6px 10px;background:#2d3140;border-radius:8px;margin-top:2px;font-size:13px">Loan: $${Number(collected.loanAmount).toLocaleString()}</div></div>`)
  return items.join('\n') || ''
}

function renderIdAiStep(sessionId: string, email: string): string {
  return `<div style="text-align:center;padding:16px">
    <div style="font-size:16px;font-weight:600;margin-bottom:12px">Verify your identity</div>
    <div style="font-size:12px;color:#FFBF00;margin-bottom:16px">Scan with your phone to complete verification</div>
    <div style="width:160px;height:160px;margin:0 auto 12px;background:#1c2128;border:1px solid #2d3140;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:11px;color:#FFBF00">QR: ${escapeHtml(sessionId.substring(0, 8))}</div>
    <div style="font-size:11px;color:#FFBF00"><a href="/api/v1/idai/start?session=${escapeHtml(sessionId)}&email=${escapeHtml(email)}" style="color:#58a6ff">Or open verification link</a></div>
  </div>`
}

function renderWidget(content: string, mode: string, widgetSessionId: string = '', title: string = 'AFIRMICO', colorAccent: string = '#58a6ff'): string {
  return `<div id="gde-chat" style="position:fixed;bottom:20px;right:20px;width:360px;min-width:200px;min-height:200px;max-height:80vh;background:#161b22;border:1px solid #2d3140;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.5);z-index:9999;display:flex;flex-direction:column;overflow:hidden;resize:none;color:#e1e4e8;font-size:14px">
    <style>
      #gde-chat ::-webkit-scrollbar{width:4px}#gde-chat ::-webkit-scrollbar-track{background:transparent}#gde-chat ::-webkit-scrollbar-thumb{background:#2d3140;border-radius:2px}
      #gde-chat .resize-handle{position:absolute;z-index:10;background:transparent}
      #gde-chat .resize-nw{top:-3px;left:-3px;width:10px;height:10px;cursor:nw-resize}
      #gde-chat .resize-ne{top:-3px;right:-3px;width:10px;height:10px;cursor:ne-resize}
      #gde-chat .resize-sw{bottom:-3px;left:-3px;width:10px;height:10px;cursor:sw-resize}
      #gde-chat .resize-se{bottom:-3px;right:-3px;width:10px;height:10px;cursor:se-resize}
      #gde-chat .resize-n{top:-3px;left:10px;right:10px;height:6px;cursor:n-resize}
      #gde-chat .resize-s{bottom:-3px;left:10px;right:10px;height:6px;cursor:s-resize}
      #gde-chat .resize-w{left:-3px;top:10px;bottom:10px;width:6px;cursor:w-resize}
      #gde-chat .resize-e{right:-3px;top:10px;bottom:10px;width:6px;cursor:e-resize}
      #gde-chat .resize-grip{position:absolute;bottom:0;right:0;width:16px;height:16px;cursor:se-resize;z-index:11}
      #gde-chat .resize-grip::after{content:'';position:absolute;bottom:3px;right:3px;width:8px;height:8px;border-right:2px solid #484f58;border-bottom:2px solid #484f58}
      #gde-chat .typing-indicator{display:inline-flex;gap:3px;padding:4px 0}
      #gde-chat .typing-indicator span{width:6px;height:6px;background:#58a6ff;border-radius:50%;animation:gde-bounce 1.4s ease-in-out infinite}
      #gde-chat .typing-indicator span:nth-child(2){animation-delay:0.2s}
      #gde-chat .typing-indicator span:nth-child(3){animation-delay:0.4s}
      @keyframes gde-bounce{0%,80%,100%{opacity:0.3;transform:scale(0.8)}40%{opacity:1;transform:scale(1)}}
    </style>
    <!-- Resize handles -->
    <div class="resize-handle resize-nw"></div><div class="resize-handle resize-n"></div><div class="resize-handle resize-ne"></div>
    <div class="resize-handle resize-w"></div><div class="resize-handle resize-e"></div>
    <div class="resize-handle resize-sw"></div><div class="resize-handle resize-s"></div><div class="resize-handle resize-se"></div>
    <div class="resize-handle resize-se resize-grip"></div>
    <div id="gde-chat-header" style="padding:10px 12px;background:#1c2128;border-bottom:1px solid #2d3140;display:flex;align-items:center;justify-content:space-between;cursor:move;user-select:none">
      <span style="font-weight:600;font-size:14px;color:#f0f6fc">${escapeHtml(title)}</span>
      <div style="display:flex;gap:6px">
        <span id="gde-minimize-btn" style="cursor:pointer;color:#FFBF00;font-size:14px;padding:0 4px">_</span>
        <span id="gde-close-btn" style="cursor:pointer;color:#FFBF00;font-size:14px;padding:0 4px">&#x2715;</span>
      </div>
    </div>
    <div id="gde-chat-body" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column">
      <div id="message-list">
        ${content}
      </div>
      <div id="chat-input-area" style="padding:12px 0 0;border-top:1px solid #2d3140;margin-top:8px">
        <div style="display:flex;gap:6px">
          <input type="hidden" id="chat-session-id" value="${escapeHtml(widgetSessionId)}">
          <input type="hidden" id="chat-guest-name" value="">
          <input type="text" id="chat-text-input" placeholder="Type a message..." style="flex:1;padding:8px 12px;border-radius:8px;border:1px solid #2d3140;background:#0f1117;color:#e1e4e8" autocomplete="off" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();document.getElementById('chat-send-btn').click()}">
          <button id="chat-send-btn" style="padding:8px 12px;border-radius:8px;border:1px solid #2d3140;background:#1c2128;color:${escapeHtml(colorAccent)};cursor:pointer;font-size:16px;line-height:1" onclick="var si=document.getElementById('chat-session-id').value,tx=document.getElementById('chat-text-input'),msg=tx.value.trim();if(!msg)return;tx.value='';var um=msg,ml=document.getElementById('message-list'),bd=document.getElementById('gde-chat-body');if(!ml)return;var gn=document.getElementById('chat-guest-name'),lb=(gn&&gn.value)?gn.value:'You';ml.insertAdjacentHTML('beforeend','<div style=margin-bottom:8px><span style=font-size:12px;color:#FFBF00>'+lb+'</span><div style=padding:8px 12px;background:#2d3140;border-radius:8px;margin-top:2px;font-size:13px>'+um.replace(/</g,'&lt;')+'</div></div>');if(bd)bd.scrollTop=bd.scrollHeight;fetch('/api/v1/chat/tool?tenant=au-mortgage-broker-afirmico',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'tool=chat&session_id='+encodeURIComponent(si)+'&text='+encodeURIComponent(msg)}).then(function(r){return r.json()}).then(function(d){var rp=d.message;if(!rp&&d.nextLabel)rp='Thanks! Could you provide your '+d.nextLabel.toLowerCase()+'?';if(!rp)rp='Thanks!';ml.insertAdjacentHTML('beforeend','<div style=margin-bottom:8px><span style=font-size:12px;color:#58a6ff>AFIRMICO</span><div style=padding:8px 12px;background:#1c2128;border:1px solid #2d3140;border-radius:8px;margin-top:2px;font-size:13px>'+rp.replace(/</g,'&lt;')+'</div></div>');if(bd)bd.scrollTop=bd.scrollHeight;if(gn&&!gn.value){var cf=d.state&&d.state.completedFields;if(cf&&cf.indexOf('firstName')>=0){var nw=um.split(' ')[0];if(nw.length>1)gn.value=nw}}})">→</button>
        </div>
      </div>
    </div>
    <div id="unread-badge" style="display:none"></div>
  <script>
    (function(){
      var w = document.getElementById('gde-chat');
      if (!w) return;
      // Minimize toggle
      var minBtn = document.getElementById('gde-minimize-btn');
      var body = document.getElementById('gde-chat-body');
      if (minBtn && body) {
        minBtn.onclick = function(e) {
          e.stopPropagation();
          var hidden = body.style.display === 'none';
          body.style.display = hidden ? 'block' : 'none';
          w.style.maxHeight = hidden ? '560px' : 'auto';
          minBtn.textContent = hidden ? '_' : '□';
        };
      }
      // Close
      var closeBtn = document.getElementById('gde-close-btn');
      if (closeBtn) {
        closeBtn.onclick = function(e) {
          e.stopPropagation();
          w.style.display = 'none';
        };
      }
      // Dragging
      var header = document.getElementById('gde-chat-header');
      if (header) {
        var dx = 0, dy = 0, mx = 0, my = 0;
        header.onmousedown = function(e) {
          e.preventDefault();
          dx = e.clientX; dy = e.clientY;
          mx = w.offsetLeft || 0; my = w.offsetTop || 0;
          document.onmousemove = function(ev) {
            var nx = mx + ev.clientX - dx;
            var ny = my + ev.clientY - dy;
            w.style.left = Math.max(0, Math.min(window.innerWidth - 100, nx)) + 'px';
            w.style.top = Math.max(0, Math.min(window.innerHeight - 50, ny)) + 'px';
            w.style.right = 'auto'; w.style.bottom = 'auto';
          };
          document.onmouseup = function() { document.onmousemove = null; document.onmouseup = null; };
        };
      }
      // Resize handles
      var handles = w.querySelectorAll('.resize-handle');
      var rx = 0, ry = 0, rw = 0, rh = 0, rt = 0, rl = 0;
      handles.forEach(function(h) {
        h.addEventListener('mousedown', function(e) {
          e.preventDefault();
          var rect = w.getBoundingClientRect();
          rx = e.clientX; ry = e.clientY;
          rw = w.offsetWidth; rh = w.offsetHeight;
          rt = rect.top;
          rl = rect.left;
          w.style.width = rw + 'px';
          w.style.height = rh + 'px';
          w.style.maxHeight = 'none';
          var cls = h.className;
          document.onmousemove = function(ev) {
            var dx = ev.clientX - rx, dy = ev.clientY - ry;
            // East resize (right edge)
            if (cls.includes('resize-e') || cls.includes('resize-se') || cls.includes('resize-ne')) {
              w.style.width = Math.max(200, rw + dx) + 'px';
            }
            // West resize (left edge)
            if (cls.includes('resize-w') || cls.includes('resize-sw') || cls.includes('resize-nw')) {
              w.style.width = Math.max(200, rw - dx) + 'px';
              w.style.left = Math.max(0, rl + dx) + 'px';
              w.style.right = '';
            }
            // South resize (bottom edge)
            if (cls.includes('resize-s') || cls.includes('resize-se') || cls.includes('resize-sw')) {
              w.style.height = Math.max(200, rh + dy) + 'px';
            }
            // North resize (top edge)
            if (cls.includes('resize-n') || cls.includes('resize-ne') || cls.includes('resize-nw')) {
              var newH = Math.max(200, rh - dy);
              w.style.height = newH + 'px';
              w.style.top = Math.max(0, rt + dy) + 'px';
              w.style.bottom = '';
            }
          };
          document.onmouseup = function() { document.onmousemove = null; document.onmouseup = null; };
        });
      });

      // Send message + stream response
            window.chatSend = function() {
        var sid=document.getElementById('chat-session-id').value;
        var txt=document.getElementById('chat-text-input');
        var msg=txt.value.trim();
        if(!msg)return;
        txt.value='';
        var userMsg=msg;
        var gn=document.getElementById('chat-guest-name');
        var label=gn&&gn.value?gn.value:'You';
        var ml=document.getElementById('message-list');
        if(!ml)return;
        var bd=document.getElementById('gde-chat-body');
        var uHtml='<div style=margin-bottom:8px><span style=font-size:12px;color:#FFBF00>'+label+'</span><div style=padding:8px 12px;background:#2d3140;border-radius:8px;margin-top:2px;font-size:13px>'+userMsg.replace(/</g,'&lt;')+'</div></div>';
        ml.insertAdjacentHTML('beforeend',uHtml);
        if(bd)bd.scrollTop=bd.scrollHeight;
        fetch('/api/v1/chat/tool?tenant=au-mortgage-broker-afirmico',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'tool=chat&session_id='+encodeURIComponent(sid)+'&text='+encodeURIComponent(msg)}).then(function(r){return r.json()}).then(function(d){var rp=d.message;if(!rp&&d.nextLabel)rp='Thanks! Could you provide your '+d.nextLabel.toLowerCase()+'?';if(!rp)rp='Thanks!';var rHtml='<div style=margin-bottom:8px><span style=font-size:12px;color:#58a6ff>AFIRMICO</span><div style=padding:8px 12px;background:#1c2128;border:1px solid #2d3140;border-radius:8px;margin-top:2px;font-size:13px>'+rp.replace(/</g,'&lt;')+'</div></div>';ml.insertAdjacentHTML('beforeend',rHtml);if(bd)bd.scrollTop=bd.scrollHeight;if(gn&&!gn.value){var cf=d.state&&d.state.completedFields;if(cf&&cf.includes('firstName')){var nw=userMsg.split(' ')[0];if(nw.length>1)gn.value=nw}}})
    })();
  </script>
  </div>`
}
