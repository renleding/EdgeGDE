console.log("EdgeGDE Widget v1.2.2 — Reliability Overhaul");
(function(){
  'use strict';
  var baseUrl = window.location.origin;
  var tenantId = document.getElementById('chat-tenant-id')?.value || document.getElementById('chat-tenant-id')?.getAttribute('data-tenant') || '';
  var sid = '';
  var chat = document.getElementById('gde-chat');
  var header = document.getElementById('gde-header');
  var body = document.getElementById('gde-body');
  var ml = document.getElementById('message-list');
  var tx = document.getElementById('chat-text-input');
  var gn = document.getElementById('chat-guest-name');
  var closeBtn = document.getElementById('gde-close-btn');
  var errorBar = null;
  var sidReady = false;
  var pendingMsg = null;

  function showError(msg) {
    if (!errorBar) {
      errorBar = document.createElement('div');
      errorBar.id = 'chat-error-bar';
      errorBar.style.cssText = 'background:#3d1a1a;color:#ff8a8a;padding:6px 12px;font-size:12px;text-align:center;border-bottom:1px solid #5c2a2a;flex-shrink:0';
      chat.insertBefore(errorBar, chat.firstChild);
    }
    errorBar.innerHTML = msg + ' <button id="chat-retry-btn" style="background:#5c2a2a;color:white;border:1px solid #8a3a3a;border-radius:4px;padding:2px 10px;margin-left:8px;cursor:pointer">Retry</button>';
    errorBar.style.display = 'block';
    var retryBtn = document.getElementById('chat-retry-btn');
    if (retryBtn) {
      retryBtn.onclick = function() { errorBar.style.display = 'none'; initSession(); };
    }
  }
  function hideError() { if (errorBar) errorBar.style.display = 'none'; }

  function enableInput() {
    sidReady = true;
    if (tx) tx.disabled = false;
    if (sendBtn) sendBtn.disabled = false;
    hideError();
    // If there's a pending message, send it now
    if (pendingMsg) {
      chatSend();
    }
  }

  function initSession() {
    var sidInput = document.getElementById('chat-session-id');
    if (sidInput && sidInput.value) { sid = sidInput.value; enableInput(); return; }
    if (!tenantId) return;
    if (tx) tx.disabled = true;
    if (sendBtn) sendBtn.disabled = true;
    var timedOut = false;
    var initTimeout = setTimeout(function() {
      timedOut = true;
      showError('Connection timed out');
      if (tx) tx.disabled = false;
      if (sendBtn) sendBtn.disabled = false;
    }, 5000);
    fetch(baseUrl + '/api/v1/chat/init?tenant=' + tenantId, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    }).then(function(r) { return r.json(); }).then(function(d) {
      clearTimeout(initTimeout);
      if (timedOut) return;
      if (d.sessionId) {
        sid = d.sessionId;
        if (sidInput) sidInput.value = d.sessionId;
        enableInput();
      }
    }).catch(function() {
      clearTimeout(initTimeout);
      if (!timedOut) {
        // Init failed — show retry bar but keep input enabled
        showError('Connection failed');
        if (tx) tx.disabled = false;
        if (sendBtn) sendBtn.disabled = false;
      }
    });
  }

  var isStreaming = false;
  var sendBtn = document.getElementById('chat-send-btn');

  function getDisplayName() {
    return (gn && gn.value) ? gn.value : 'You';
  }

  function chatSend() {
    if (isStreaming) return;
    if (!sid || !sidReady) {
      // Session not ready — queue message and try init again
      pendingMsg = (tx && tx.value.trim()) || pendingMsg;
      if (!sidReady) { initSession(); return; }
    }
    pendingMsg = null;
    hideError();
    isStreaming = true;
    if (sendBtn) sendBtn.disabled = true;
    var msg = tx.value.trim();
    if (!msg) { isStreaming = false; if (sendBtn) sendBtn.disabled = false; return; }
    tx.value = '';
    var label = getDisplayName();
    ml.insertAdjacentHTML('beforeend',
      '<div class=msg msg-user><span class=msg-label style=color:#FFBF00>' + label.replace(/</g,'&lt;') + '</span><div class=msg-bubble>' + msg.replace(/</g,'&lt;') + '</div></div>');
    var typingId = 'typing-' + Date.now();
    ml.insertAdjacentHTML('beforeend', '<div class=msg msg-bot id=' + typingId + '><span class=msg-label style=color:#58a6ff>AFIRMICO</span><div class=msg-bubble><span class=typing-indicator><span></span><span></span><span></span></span></div></div>');
    if (body) body.scrollTop = body.scrollHeight;
    var isDebug = window.location.search.indexOf('debug=true') >= 0;
    var streamUrl = baseUrl + '/api/v1/chat/stream?tenant=' + tenantId + (isDebug ? '&debug=true' : '');

    function doStream(attempt) {
      var streamAborted = false;
      var streamTimeout = setTimeout(function() {
        streamAborted = true;
        if (attempt < 3) {
          var delay = [0, 2000, 6000][attempt] || 10000;
          setTimeout(function() { doStream(attempt + 1); }, delay);
        } else {
          isStreaming = false;
          if (sendBtn) sendBtn.disabled = false;
          var te = document.getElementById(typingId);
          if (te) { te.remove(); }
          ml.insertAdjacentHTML('beforeend', '<div class=msg msg-bot><span class=msg-label style=color:#da3633>AFIRMICO</span><div class=msg-bubble style=color:#da3633>Unable to connect after 3 attempts. Please try again later.</div></div>');
          if (body) body.scrollTop = body.scrollHeight;
        }
      }, 30000);
      fetch(streamUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'session_id=' + encodeURIComponent(sid) + '&text=' + encodeURIComponent(msg)
      }).then(function(r) {
        var reader = r.body.getReader();
        var decoder = new TextDecoder();
        var responseText = '';
        var typingEl = document.getElementById(typingId);
        var streamCompleted = false;
        function read() {
          reader.read().then(function(result) {
            clearTimeout(streamTimeout);
            if (streamAborted) return;
            if (result.done) {
              isStreaming = false;
              if (sendBtn) sendBtn.disabled = false;
              if (!streamCompleted) {
                var te2 = document.getElementById(typingId);
                if (result.value) {
                  try { var lc2 = decoder.decode(result.value, { stream: true }); if (lc2.startsWith('data:')) lc2 = lc2.slice(5).trim(); var lp2 = JSON.parse(lc2); if (lp2.done && lp2.message && typingEl) { var lb2 = typingEl.querySelector('.msg-bubble'); if (lb2) lb2.textContent = lp2.message; streamCompleted = true; } } catch(e) {}
                }
              }
              if (responseText) {
                try {
                  var d = JSON.parse(responseText);
                  if (d && d.firstName) {
                    if (gn) gn.value = d.firstName;
                    var labels = ml.querySelectorAll('.msg-user .msg-label');
                    for (var ui = 0; ui < labels.length; ui++) {
                      if (labels[ui].textContent === 'You') labels[ui].textContent = d.firstName;
                    }
                  } else if (d && d.fullName) {
                    var fn = d.fullName.split(' ')[0];
                    if (fn.length > 1) { if (gn) gn.value = fn;
                      var labels = ml.querySelectorAll('.msg-user .msg-label');
                      for (var ui = 0; ui < labels.length; ui++) {
                        if (labels[ui].textContent === 'You') labels[ui].textContent = fn;
                      }
                    }
                  }
                } catch(e) {}
              }
              if (!streamCompleted) {
                var te = document.getElementById(typingId);
                if (te) { te.remove(); }
                ml.insertAdjacentHTML('beforeend', '<div class=msg msg-bot><span class=msg-label style=color:#da3633>AFIRMICO</span><div class=msg-bubble style=color:#da3633>Connection lost. Please try again.</div></div>');
                if (body) body.scrollTop = body.scrollHeight;
              }
              return;
            }
            var chunk = decoder.decode(result.value, { stream: true });
            var lines = chunk.split(String.fromCharCode(10));
            for (var i = 0; i < lines.length; i++) {
              var line = lines[i].trim();
              if (!line) continue;
              if (line.startsWith('event:')) {
                if (line.slice(6).trim() === 'complete') streamCompleted = true;
                continue;
              }
              if (line.startsWith('data:')) line = line.slice(5).trim();
              try {
                var parsed = JSON.parse(line);
                if (parsed.done) {
                  streamCompleted = true;
                  if (parsed.message && typingEl) { var bubble = typingEl.querySelector('.msg-bubble'); if (bubble) bubble.textContent = parsed.message; }
                  if (parsed.firstName) {
                    if (gn) gn.value = parsed.firstName;
                    var labels = ml.querySelectorAll('.msg-user .msg-label');
                    for (var ui = 0; ui < labels.length; ui++) {
                      if (labels[ui].textContent === 'You') labels[ui].textContent = parsed.firstName;
                    }
                  }
                  if (parsed.options && parsed.options.length > 0 && typingEl) {
                    var pillContainer = document.createElement('div');
                    pillContainer.className = 'option-pills';
                    pillContainer.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:8px';
                    for (var oi = 0; oi < parsed.options.length; oi++) {
                      (function(opt) {
                        var pill = document.createElement('button');
                        pill.textContent = opt;
                        pill.style.cssText = 'background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:16px;padding:6px 14px;cursor:pointer;font-size:13px';
                        pill.addEventListener('click', function() { tx.value = opt; chatSend(); });
                        pillContainer.appendChild(pill);
                      })(parsed.options[oi]);
                    }
                    typingEl.querySelector('.msg-bubble').after(pillContainer);
                  }
                  // ── P4: Completion state — disable input, show checkmark ──
                  if (parsed.complete === true || (parsed.state && parsed.state.phase === 'complete')) {
                    if (tx) { tx.disabled = true; tx.placeholder = 'Application complete \u2713'; }
                    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '\u2713'; }
                    if (chat) chat.classList.add('chat-complete');
                  }
                  // ── P3: Summary card ──
                  if (parsed.summary && parsed.summary.sessionRef && typingEl) {
                    var sc = document.createElement('div');
                    sc.className = 'summary-card';
                    sc.style.cssText = 'background:#1c2128;border:1px solid #2d3140;border-radius:8px;padding:12px;margin-top:8px;font-size:12px;line-height:1.6';
                    var s = parsed.summary;
                    var scHtml = '<div style="font-weight:600;color:#f0f6fc;margin-bottom:8px">📋 Application Summary</div>';
                    var refDiv = document.createElement('div');
                    refDiv.style.cssText = 'color:#8b949e';
                    refDiv.textContent = 'Ref: ' + s.sessionRef;
                    scHtml += refDiv.outerHTML;
                    var timeDiv = document.createElement('div');
                    timeDiv.style.cssText = 'color:#8b949e';
                    timeDiv.textContent = 'Completed: ' + (s.completedAt ? new Date(s.completedAt).toLocaleString() : 'just now');
                    scHtml += timeDiv.outerHTML;
                    scHtml += '<div style="margin-top:8px;height:4px;background:#2d3140;border-radius:2px;overflow:hidden">'
                      + '<div style="height:100%;width:' + (s.completionPercentage || 100) + '%;background:#238636;border-radius:2px;transition:width 0.3s"></div></div>';
                    var fieldsDiv = document.createElement('div');
                    fieldsDiv.style.cssText = 'color:#8b949e;font-size:11px;margin-top:4px';
                    fieldsDiv.textContent = s.fieldsCollected + '/' + s.totalFields + ' fields collected';
                    scHtml += fieldsDiv.outerHTML;
                    sc.innerHTML = scHtml;
                    typingEl.querySelector('.msg-bubble')?.after(sc);
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
        if (attempt < 3) {
          var delay = [0, 2000, 6000][attempt] || 10000;
          setTimeout(function() { doStream(attempt + 1); }, delay);
        } else {
          isStreaming = false;
          if (sendBtn) sendBtn.disabled = false;
          var te = document.getElementById(typingId);
          if (te) { te.remove(); }
          ml.insertAdjacentHTML('beforeend', '<div class=msg msg-bot><span class=msg-label style=color:#da3633>AFIRMICO</span><div class=msg-bubble style=color:#da3633>Network error. Please check your connection and try again.</div></div>');
          if (body) body.scrollTop = body.scrollHeight;
        }
      });
    }
    doStream(0);
  }

  document.getElementById('chat-send-btn').addEventListener('click', chatSend);
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && document.activeElement === tx) {
      e.preventDefault();
      chatSend();
    }
  });

  initSession();
  window.chatSend = chatSend;
})();
