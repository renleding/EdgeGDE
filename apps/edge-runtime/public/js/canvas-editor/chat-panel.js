/**
 * EdgeGDE Canvas Editor — Chat Panel
 * Sends messages to the canvas chat API, displays responses.
 * Standalone UI module — no dependencies beyond EventBus + EditorState.
 */
(function () {
  'use strict';

  function addMessage(text, className) {
    var container = document.getElementById('chat-messages');
    if (!container) return;
    var msg = document.createElement('div');
    msg.className = 'chat-msg ' + (className || '');
    msg.textContent = text;
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
  }

  window.ChatPanel = {
    init: function () {
      var input = document.getElementById('chat-input');
      if (input) {
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.send();
          }
        }.bind(this));
      }
    },

    send: function () {
      var input = document.getElementById('chat-input');
      if (!input) return;
      var msg = input.value.trim();
      if (!msg) return;

      input.value = '';
      addMessage(msg, 'user');

      var canvasId = window.EditorState.get().canvasId;
      if (!canvasId) return;

      var selectedNodeId = window.EditorState.get().selectedNodeId;

      fetch('/api/canvas/' + canvasId + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, selectedNodeId: selectedNodeId || undefined }),
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.success) {
            addMessage('\u2705 ' + data.intent + ' (' + data.mutCount + ' mutation' + (data.mutCount > 1 ? 's' : '') + ')', 'agent');
            var verEl = document.getElementById('canvas-version');
            if (verEl && data.version) verEl.textContent = 'v' + data.version;
            window.EditorWS.requestState();
          } else {
            addMessage('\u274c Error: ' + (data.error || 'Unknown'), 'agent error');
          }
        })
        .catch(function (err) {
          addMessage('\u274c Network error: ' + err.message, 'agent error');
        });
    },
  };
})();
