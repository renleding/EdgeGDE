console.log("EdgeGDE Widget v1.1.0");
/**
 * EdgeGDE — Chat Widget Runtime (client-side)
 * Loaded by /embed/chat endpoint. Handles drag, resize, streaming, label updates.
 *
 * @packageDocumentation
 */

(function() {
  'use strict';
  var baseUrl = window.location.origin;
  var tenantId = document.getElementById('chat-tenant-id')?.getAttribute('data-tenant') || '';
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
  var isDragging = false, lastMX = 0, lastMY = 0;
  header.addEventListener('mousedown', function(e) {
    if (e.target.tagName === 'BUTTON') return;
    isDragging = true;
    lastMX = e.clientX;
    lastMY = e.clientY;
    e.preventDefault();
  });
  document.addEventListener('mousemove', function(e) {
    if (!isDragging) return;
    var dx = e.clientX - lastMX;
    var dy = e.clientY - lastMY;
    lastMX = e.clientX;
    lastMY = e.clientY;
    window.parent.postMessage({ type: 'move', dx: dx, dy: dy }, '*');
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
    chat.style.position = 'fixed';
    chat.style.left = nl + 'px'; chat.style.top = nt + 'px';
    chat.style.width = nw + 'px'; chat.style.height = nh + 'px';
    chat.style.right = 'auto'; chat.style.bottom = 'auto';
  });
  document.addEventListener('mouseup', function() { isResizing = false; });

  // ═══ MINIMIZE / CLOSE ═══
  // Widget handles drag/resize internally. Body is transparent so
  // only the chat element (with dark background) moves freely.
  // Minimize/close send hide signal to parent for reopen button.
  minBtn.addEventListener('click', function() {
    window.parent.postMessage({ type: 'hide' }, '*');
  });
  closeBtn.addEventListener('click', function() {
    window.parent.postMessage({ type: 'hide' }, '*');
  });
  // Listen for parent to show us again
  window.addEventListener('message', function(ev) {
    if (ev.data && ev.data.type === 'show') {
      chat.style.display = 'flex';
    }
  });

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
      }).catch(function() {});
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
          var lines = chunk.split(/\n/);
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
              if (parsed.done) {
                if (parsed.firstName && gn && !gn.value) {
                  gn.value = parsed.firstName;
                  var labels = ml.querySelectorAll('.msg-user .msg-label');
                  for (var ui = 0; ui < labels.length; ui++) {
                    if (labels[ui].textContent === 'You') labels[ui].textContent = parsed.firstName;
                  }
                }
                // Render option pills if present
                if (parsed.options && parsed.options.length > 0 && typingEl) {
                  var pillContainer = document.createElement('div');
                  pillContainer.className = 'option-pills';
                  pillContainer.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:8px';
                  for (var oi = 0; oi < parsed.options.length; oi++) {
                    (function(opt) {
                      var pill = document.createElement('button');
                      pill.textContent = opt;
                      pill.className = 'option-pill';
                      pill.style.cssText = 'background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:16px;padding:6px 14px;cursor:pointer;font-size:13px;transition:all 0.15s';
                      pill.addEventListener('mouseenter', function() { this.style.background = '#334155'; });
                      pill.addEventListener('mouseleave', function() { this.style.background = '#1e293b'; });
                      pill.addEventListener('click', function() {
                        tx.value = opt;
                        chatSend();
                      });
                      pillContainer.appendChild(pill);
                    })(parsed.options[oi]);
                  }
                  typingEl.querySelector('.msg-bubble').after(pillContainer);
                }
                if (isDebug && parsed.debug) {
                  try {
                    window.parent.postMessage({ type: 'debug', payload: parsed.debug }, '*');
                    var tmpl = document.getElementById('debug-data');
                    if (tmpl) tmpl.textContent = JSON.stringify(parsed.debug);
                  } catch(e) {}
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

  // ═══ INIT ═══
  initSession();
  window.chatSend = chatSend;
})();
