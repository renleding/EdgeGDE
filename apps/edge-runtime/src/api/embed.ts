/**
 * EdgeGDE — Embed Chat Endpoint (/embed/chat)
 * Renders the full chat widget as an isolated HTML document for iframe embedding.
 * Includes drag, 8-direction resize, minimize/close, streaming, name labeling.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'

const embedRouter = new Hono()

const DEFAULT_CONFIG = {
  title: 'AFIRMICO Finance',
  greeting: "Welcome! Let's get started with your application. What is your full name?",
  colorAccent: '#58a6ff',
  ui: {
    title: 'AFIRMICO Finance',
    greeting: "Welcome! Let's get started with your application. What is your full name?",
    colorAccent: '#58a6ff',
  },
  fields: [
    { fieldName: 'fullName', label: 'Full Name', fieldType: 'text', validation: { required: true } },
    { fieldName: 'email', label: 'Email Address', fieldType: 'email', validation: { required: true } },
  ],
  priorityOrder: ['fullName', 'email'],
  knowledgeBase: { topics: ['rates', 'compliance'] },
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /embed/chat — isolated chat widget document
// ═══════════════════════════════════════════════════════════════════════════

embedRouter.get('/chat', async (c) => {
  const tenantId = c.req.query('tenant') || 'au-mortgage-broker-afirmico'

  let config = DEFAULT_CONFIG
  try {
    const kv = (c.env as any)?.TENANT_KV
    if (kv) {
      const raw = await kv.get(`tenant:${tenantId}:chat:config`, 'json')
      if (raw) {
        config = typeof raw === 'object' ? raw : JSON.parse(raw)
      }
    }
  } catch {}

  const title = config.ui?.title || config.title || DEFAULT_CONFIG.title
  const greeting = config.ui?.greeting || config.greeting || DEFAULT_CONFIG.greeting
  const accent = config.ui?.colorAccent || config.colorAccent || DEFAULT_CONFIG.colorAccent

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#0d1117;color:#e1e4e8;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px}
    #gde-chat{display:flex;flex-direction:column;height:100vh;max-height:100vh;position:relative;background:#0d1117;border-radius:12px;border:1px solid #2d3140;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.4)}
    #gde-header{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:#1c2128;border-bottom:1px solid #2d3140;cursor:move;flex-shrink:0;user-select:none}
    #gde-header h1{font-size:14px;color:#f0f6fc;font-weight:600;pointer-events:none}
    #gde-header .hdr-btns{display:flex;gap:2px}
    #gde-header .hdr-btns button{background:none;border:none;color:#8b949e;cursor:pointer;padding:4px 8px;font-size:14px;line-height:1;border-radius:4px}
    #gde-header .hdr-btns button:hover{color:#e1e4e8;background:#2d3140}
    #gde-body{flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;min-height:0}
    #message-list{flex:1}
    #message-list .welcome{font-size:12px;color:#8b949e;border-bottom:1px solid #2d3140;padding-bottom:8px;margin-bottom:8px}
    .msg{margin-bottom:8px;animation:fadeIn 0.2s ease}
    @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
    .msg-label{font-size:11px;display:block;margin-bottom:2px}
    .msg-bubble{padding:8px 12px;border-radius:8px;font-size:13px;line-height:1.4;word-wrap:break-word}
    .msg-user .msg-bubble{background:#2d3140;border-bottom-right-radius:2px}
    .msg-bot .msg-bubble{background:#1c2128;border:1px solid #2d3140;border-bottom-left-radius:2px}
    #chat-input-area{padding:8px 12px;border-top:1px solid #2d3140;flex-shrink:0;display:flex;gap:6px;align-items:center}
    #chat-text-input{flex:1;padding:8px 12px;border-radius:8px;border:1px solid #2d3140;background:#0f1117;color:#e1e4e8;font-size:13px;outline:none}
    #chat-text-input:focus{border-color:${escapeHtml(accent)}}
    #chat-send-btn{padding:8px 12px;border-radius:8px;border:1px solid #2d3140;background:#1c2128;color:${escapeHtml(accent)};cursor:pointer;font-size:16px;line-height:1}
    #chat-send-btn:hover{background:#2d3140}
    .typing-indicator{display:inline-flex;gap:4px;padding:4px 0}
    .typing-indicator span{width:6px;height:6px;border-radius:50%;background:#8b949e;animation:gde-bounce 1.4s ease-in-out infinite}
    .typing-indicator span:nth-child(2){animation-delay:0.2s}
    .typing-indicator span:nth-child(3){animation-delay:0.4s}
    @keyframes gde-bounce{0%,80%,100%{opacity:0.3;transform:scale(0.8)}40%{opacity:1;transform:scale(1)}}
    .resize-handle{position:absolute;z-index:10}
    .rh-nw{top:-3px;left:-3px;width:10px;height:10px;cursor:nw-resize}
    .rh-n{top:-3px;left:3px;right:3px;height:6px;cursor:n-resize}
    .rh-ne{top:-3px;right:-3px;width:10px;height:10px;cursor:ne-resize}
    .rh-e{right:-3px;top:3px;bottom:3px;width:6px;cursor:e-resize}
    .rh-se{bottom:-3px;right:-3px;width:10px;height:10px;cursor:se-resize}
    .rh-s{bottom:-3px;left:3px;right:3px;height:6px;cursor:s-resize}
    .rh-sw{bottom:-3px;left:-3px;width:10px;height:10px;cursor:sw-resize}
    .rh-w{left:-3px;top:3px;bottom:3px;width:6px;cursor:w-resize}
    .resize-grip{position:absolute;bottom:2px;right:2px;width:12px;height:12px;cursor:se-resize;z-index:10}
    .resize-grip::after{content:'';position:absolute;bottom:2px;right:2px;width:8px;height:8px;border-right:2px solid #4a4d55;border-bottom:2px solid #4a4d55}
    .debug-panel{position:fixed;top:0;left:0;width:100%;height:100%;z-index:998;background:rgba(0,0,0,0.85);overflow-y:auto;display:none;padding:16px;font-family:monospace;font-size:11px;color:#e1e4e8;line-height:1.5}
    .debug-panel.open{display:block}
    .debug-panel h3{font-size:13px;color:#58a6ff;margin:8px 0 4px}
    .debug-panel .key{color:#8b949e}
    .debug-panel .val{color:#3fb950}
  </style>
</head>
<body>
  <div id="gde-chat">
    <div id="gde-header">
      <h1>${escapeHtml(title)}</h1>
      <div class="hdr-btns">
        <button id="gde-minimize-btn" title="Minimize">_</button>
        <button id="gde-close-btn" title="Close">&#x2715;</button>
      </div>
    </div>
    <div id="gde-body">
      <div id="message-list">
        <div class="welcome">${escapeHtml(greeting)}</div>
      </div>
      <div id="chat-input-area">
        <input type="hidden" id="chat-session-id" value="">
        <input type="hidden" id="chat-guest-name" value="">
        <input type="text" id="chat-text-input" placeholder="Type a message..." autocomplete="off">
        <button id="chat-send-btn">→</button>
      </div>
    </div>
    <span id="chat-tenant-id" data-tenant="${escapeHtml(tenantId)}" style="display:none"></span>
    <div class="resize-handle rh-nw"></div>
    <div class="resize-handle rh-n"></div>
    <div class="resize-handle rh-ne"></div>
    <div class="resize-handle rh-e"></div>
    <div class="resize-handle rh-se"></div>
    <div class="resize-handle rh-s"></div>
    <div class="resize-handle rh-sw"></div>
    <div class="resize-handle rh-w"></div>
    <div class="resize-grip"></div>
  </div>
  <!-- debug toggle removed from production -->

  <template id="debug-data"></template>
    <script src="/widget.js?v=v1.1.0"></script>
</body>
</html>`

  c.header('Content-Type', 'text/html; charset=utf-8')
  c.header('X-Frame-Options', 'ALLOWALL')
  c.header('Content-Security-Policy', "default-src 'self'; script-src 'self' https://unpkg.com; style-src 'unsafe-inline'; connect-src 'self' *")
  return c.body(html)
})

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export { embedRouter }
