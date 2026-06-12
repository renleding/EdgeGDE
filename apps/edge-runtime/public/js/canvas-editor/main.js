/**
 * EdgeGDE Canvas Editor — Main Bootstrap
 * Initializes all subsystems in dependency order.
 * This file runs last, after all modules are loaded.
 */
(function () {
  'use strict';

  // Guard: verify all dependencies loaded
  if (!window.EventBus) throw new Error('EventBus not loaded');
  if (!window.EditorState) throw new Error('EditorState not loaded');
  if (!window.EditorWS) throw new Error('EditorWS not loaded');
  if (!window.EditorNodes) throw new Error('EditorNodes not loaded');

  // Read config from data attributes
  var mainEl = document.getElementById('canvas-root');
  var canvasId = mainEl ? mainEl.getAttribute('data-canvas-id') : null;
  var doId = mainEl ? mainEl.getAttribute('data-do-id') : null;

  if (!canvasId || !doId) {
    console.warn('[Editor] canvas-id or do-id missing');
    return;
  }

  // Initialize state
  window.EditorState.set({ canvasId: canvasId, doId: doId });

  // Connect WebSocket
  var wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws?do=' + doId;
  window.EditorWS.init(wsUrl);

  // Request initial state
  window.EditorWS.requestState();

  // Wire EventBus → render cycle
  window.EventBus.on('state:loaded', function () {
    window.EditorNodes.renderCanvas();
  });

  window.EventBus.on('broadcast', function () {
    window.EditorWS.requestState();
  });

  // Wire re-render after requestState completes
  window.EventBus.on('ws:message', function (msg) {
    if (msg.type === 'state') {
      window.EditorNodes.renderCanvas();
    }
  });

  // Init chat panel
  if (window.ChatPanel) {
    window.ChatPanel.init();
  }

  console.log('[Editor] bootstrapped — canvas:', canvasId);
})();
