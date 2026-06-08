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

  const title = config.title || DEFAULT_CONFIG.title
  const greeting = config.greeting || DEFAULT_CONFIG.greeting
  const accent = config.colorAccent || DEFAULT_CONFIG.colorAccent

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
  <script>
try {
(function() {
  'use strict';
  var baseUrl = window.location.origin;
  var tenantId = '${escapeHtml(tenantId)}';
  var sid = '';
  var chat = document.getElementById('gde-chat');
  var header = document.getElementById('gde-header');
  var body = document.getElementById('gde-body');
  var ml = document.getElementById('message-list');
  var tx = document.getElementById('chat-text-input');
  var gn = document.getElementById('chat-guest-name');
  var minBtn = document.getElementById('gde-minimize-btn');
  var closeBtn = document.getElementById('gde-close-btn');

  function getDisplayName() {
    if (gn && gn.value) return gn.value;
    return 'You';
  }

  // ═══ DRAG ═══
  var isDragging = false, dragOffX = 0, dragOffY = 0;
  header.addEventListener('mousedown', function(e) {
    if (e.target.tagName === 'BUTTON') return;
    isDragging = true;
    var rect = chat.getBoundingClientRect();
    dragOffX = e.clientX - rect.left;
    dragOffY = e.clientY - rect.top;
    chat.style.position = 'fixed';
    chat.style.top = rect.top + 'px';
    chat.style.left = rect.left + 'px';
    chat.style.width = rect.width + 'px';
    chat.style.height = rect.height + 'px';
    chat.style.bottom = 'auto';
    chat.style.right = 'auto';
    e.preventDefault();
  });
  document.addEventListener('mousemove', function(e) {
    if (!isDragging) return;
    var vw = window.innerWidth, vh = window.innerHeight;
    var w = parseInt(chat.style.width) || chat.offsetWidth;
    var h = parseInt(chat.style.height) || chat.offsetHeight;
    var nx = Math.max(0, Math.min(vw - w, e.clientX - dragOffX));
    var ny = Math.max(0, Math.min(vh - h, e.clientY - dragOffY));
    chat.style.left = nx + 'px';
    chat.style.top = ny + 'px';
    chat.style.right = 'auto';
    chat.style.bottom = 'auto';
  });
  document.addEventListener('mouseup', function() { isDragging = false; });

  // ═══ RESIZE ═══
  var isResizing = false, resizeEdge = '', resizeStart = {};
  document.querySelectorAll('.resize-handle, .resize-grip').forEach(function(h) {
    h.addEventListener('mousedown', function(e) {
      isResizing = true;
      resizeEdge = h.className.indexOf('rh-nw')>=0?'nw':h.className.indexOf('rh-n')>=0&&h.className.indexOf('rh-ne')<0?'n':
                  h.className.indexOf('rh-ne')>=0?'ne':h.className.indexOf('rh-e')>=0?'e':
                  h.className.indexOf('rh-se')>=0||h.className.indexOf('grip')>=0?'se':
                  h.className.indexOf('rh-s')>=0?'s':h.className.indexOf('rh-sw')>=0?'sw':
                  h.className.indexOf('rh-w')>=0?'w':'se';
      var rect = chat.getBoundingClientRect();
      resizeStart = { x: e.clientX, y: e.clientY, w: rect.width, h: rect.height, l: rect.left, t: rect.top };
      e.preventDefault();
    });
  });
  document.addEventListener('mousemove', function(e) {
    if (!isResizing) return;
    var dx = e.clientX - resizeStart.x, dy = e.clientY - resizeStart.y;
    var minW = 260, minH = 300;
    var nw = resizeStart.w, nh = resizeStart.h, nl = resizeStart.l, nt = resizeStart.t;
    if (resizeEdge.indexOf('e')>=0) { nw = Math.max(minW, resizeStart.w + dx); }
    if (resizeEdge.indexOf('s')>=0) { nh = Math.max(minH, resizeStart.h + dy); }
    if (resizeEdge.indexOf('w')>=0) {
      var rw = Math.max(minW, resizeStart.w - dx);
      nl = resizeStart.l + resizeStart.w - rw;
      nw = rw;
    }
    if (resizeEdge.indexOf('n')>=0) {
      var rh = Math.max(minH, resizeStart.h - dy);
      nt = resizeStart.t + resizeStart.h - rh;
      nh = rh;
    }
    chat.style.left = nl + 'px'; chat.style.top = nt + 'px';
    chat.style.width = nw + 'px'; chat.style.height = nh + 'px';
    chat.style.right = 'auto'; chat.style.bottom = 'auto';
  });
  document.addEventListener('mouseup', function() { isResizing = false; });

  // ═══ MINIMIZE / CLOSE ═══
  var isMinimized = false;
  chat.style.minWidth = '260px'; chat.style.minHeight = '300px';
  minBtn.addEventListener('click', function() {
    isMinimized = !isMinimized;
    body.style.display = isMinimized ? 'none' : 'flex';
    minBtn.textContent = isMinimized ? '+' : '_';
  });
  closeBtn.addEventListener('click', function() { chat.style.display = 'none'; });

  // ═══ SESSION INIT ═══
  function initSession() {
    fetch(baseUrl + '/api/v1/chat/view?tenant=' + tenantId)
      .then(function(r) { return r.text(); })
      .then(function(html) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');
        var input = doc.getElementById('chat-session-id');
        if (input) sid = input.value;
        if (sid) document.getElementById('chat-session-id').value = sid;
      }).catch(function() {
            clearTimeout(streamTimeout);});
  }

  // ═══ SEND ═══
  function chatSend() {
    var msg = tx.value.trim();
    if (!msg) return;
    tx.value = '';

    var label = getDisplayName();
    ml.insertAdjacentHTML('beforeend',
      '<div class=msg msg-user><span class=msg-label style=color:#FFBF00>' + label.replace(/</g,'&lt;') + '</span><div class=msg-bubble>' + msg.replace(/</g,'&lt;') + '</div></div>');

    var typingId = 'typing-' + Date.now();
    ml.insertAdjacentHTML('beforeend', '<div class=msg msg-bot id=' + typingId + '><span class=msg-label style=color:#58a6ff>AFIRMICO</span><div class=msg-bubble><span class=typing-indicator><span></span><span></span><span></span></span></div></div>');
    if (body) body.scrollTop = body.scrollHeight;

    var isDebug = window.location.search.indexOf('debug=true') >= 0;
    var streamUrl = baseUrl + '/api/v1/chat/stream?tenant=' + tenantId + (isDebug ? '&debug=true' : '');
    var streamAborted = false;
      var streamTimeout = setTimeout(function() {
        streamAborted = true;
        var te = document.getElementById(typingId);
        if (te) { te.remove(); }
        ml.insertAdjacentHTML('beforeend', '<div class=msg msg-bot><span class=msg-label style=color:#da3633>AFIRMICO</span><div class=msg-bubble style=color:#da3633>\u26a0 Connection lost. Please try again.</div></div>');
        if (body) body.scrollTop = body.scrollHeight;
      }, 15000);
      fetch(streamUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'session_id=' + encodeURIComponent(sid) + '&text=' + encodeURIComponent(msg)
    }).then(function(r) {
      var reader = r.body.getReader();
      var decoder = new TextDecoder();
      var responseText = '';
      var typingEl = document.getElementById(typingId);

      function read() {
        reader.read().then(function(result) {
          clearTimeout(streamTimeout);
            if (result.done) {
            if (responseText) {
              try {
                var d = JSON.parse(responseText);
                // Extract name from done event for label update
                if (d && d.firstName && gn && !gn.value) {
                  gn.value = d.firstName;
                  var labels = ml.querySelectorAll('.msg-user .msg-label');
                  for (var ui = 0; ui < labels.length; ui++) {
                    if (labels[ui].textContent === 'You') labels[ui].textContent = d.firstName;
                  }
                } else if (d && d.fullName && gn && !gn.value) {
                  var fn = d.fullName.split(' ')[0];
                  if (fn.length > 1) { gn.value = fn;
                    var labels = ml.querySelectorAll('.msg-user .msg-label');
                    for (var ui = 0; ui < labels.length; ui++) {
                      if (labels[ui].textContent === 'You') labels[ui].textContent = fn;
                    }
                  }
                }
                if (isDebug && d && d.debug) {
                  try {
                    window.parent.postMessage({ type: 'debug', payload: d.debug }, '*');
                    var tmpl = document.getElementById('debug-data');
                    if (tmpl) tmpl.textContent = JSON.stringify(d.debug);
                  } catch(e) {}
                }
                if (gn && !gn.value && d.state && d.state.completedFields) {
                  var cf = d.state.completedFields;
                  if (cf.indexOf('firstName') >= 0) {
                    var nw = msg.split(' ')[0];
                    if (nw.length > 1) gn.value = nw;
                  }
                }
              } catch(e) {}
            }
            return;
          }
          var chunk = decoder.decode(result.value, { stream: true });
          var lines = chunk.split(/\\n/);
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line) continue;
            try {
              var parsed = JSON.parse(line);
              if (parsed.token !== undefined) {
                responseText += parsed.token;
                if (typingEl) {
                  var bubble = typingEl.querySelector('.msg-bubble');
                  if (bubble) bubble.textContent = responseText;
                }
                if (body) body.scrollTop = body.scrollHeight;
              }
              if (parsed.final) {
                responseText = parsed.final;
                if (typingEl) {
                  var bubble = typingEl.querySelector('.msg-bubble');
                  if (bubble) bubble.textContent = responseText;
                }
              }
            } catch(e) {}
          }
          read();
        });
      }
      read();
    }).catch(function() {
            clearTimeout(streamTimeout);
      var te = document.getElementById(typingId);
      if (te) te.remove();
    });
  }

  document.getElementById('chat-send-btn').addEventListener('click', chatSend);
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && document.activeElement === tx) {
      e.preventDefault();
      chatSend();
    }
  });



  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ═══ INIT ═══
  initSession();
  window.chatSend = chatSend;
})();
} catch(e) { console.error('[EdgeGDE widget]', e.message, e.stack); }
  </script>
</body>
</html>`

  c.header('Content-Type', 'text/html; charset=utf-8')
  c.header('X-Frame-Options', 'ALLOWALL')
  c.header('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline' https://unpkg.com; style-src 'unsafe-inline'; connect-src 'self' *")
  return c.body(html)
})

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export { embedRouter }
