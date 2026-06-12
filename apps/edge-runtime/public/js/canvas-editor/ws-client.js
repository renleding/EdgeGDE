/**
 * EdgeGDE Canvas Editor — WebSocket Client
 * Connects to CanvasSession_DO, dispatches server messages via EventBus.
 * Loads after EventBus + EditorState.
 */
(function () {
  'use strict';

  var ws = null;
  var wsUrl = null;

  function connect() {
    if (!wsUrl) return;
    ws = new WebSocket(wsUrl);
    ws.onopen = function () { console.log('[ws] connected'); };
    ws.onmessage = function (e) {
      try {
        var msg = JSON.parse(e.data);
        handleIncoming(msg);
      } catch (err) {
        console.warn('[ws] bad message', err);
      }
    };
    ws.onclose = function () { setTimeout(connect, 1000); };
    ws.onerror = function () { ws.close(); };
  }

  function handleIncoming(msg) {
    window.EventBus.emit('ws:message', msg);
    switch (msg.type) {
      case 'state':
        window.EditorState.set({ lastAppliedVersion: msg.doc.version });
        window.EventBus.emit('state:loaded', msg.doc);
        break;
      case 'broadcast':
        if (msg.version <= window.EditorState.get().lastAppliedVersion) return;
        window.EditorState.set({ lastAppliedVersion: msg.version });
        window.EventBus.emit('broadcast', msg);
        break;
      case 'mutation_rejected':
        console.warn('[ws] mutation rejected:', msg.reason);
        window.EventBus.emit('error', { type: 'mutation_rejected', reason: msg.reason });
        break;
      case 'mcp_call_accepted':
        console.log('[ws] mcp_call accepted at version', msg.version);
        break;
      case 'mcp_call_failed':
        console.warn('[ws] mcp_call failed:', msg.reason);
        window.EventBus.emit('error', { type: 'mcp_call_failed', reason: msg.reason });
        break;
      case 'compiled':
        console.log('[ws] compiled at livePointer', msg.livePointer);
        break;
    }
  }

  // Public API
  window.EditorWS = {
    init: function (url) {
      wsUrl = url;
      connect();
    },

    send: function (obj) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(obj));
      } else {
        console.warn('[ws] not connected');
      }
    },

    requestState: function () {
      this.send({ type: 'request_state' });
    },

    sendMutation: function (mutation) {
      this.send({
        type: 'mutation',
        mutation: mutation,
        expectedVersion: window.EditorState.get().lastAppliedVersion,
      });
    },

    sendMcpCall: function (tool, payload) {
      this.send({
        type: 'mcp_call',
        tool: tool,
        payload: payload,
        expectedVersion: window.EditorState.get().lastAppliedVersion,
      });
    },
  };
})();
