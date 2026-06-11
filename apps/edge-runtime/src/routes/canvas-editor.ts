/**
 * EdgeGDE Canvas — Canvas Editor Route
 * Canvas Platform v1.0.0
 * Phase 3: Inline visual editor with WebMCP runtime.
 *
 * Serves the editor page at GET /canvas/:id/edit
 * Includes:
 * - Compiled Canvas HTML rendered in #canvas-root
 * - Editor overlay for selection, drag, resize, text edit
 * - WebMCP runtime for intercepting mcp-tool interactions
 * - WebSocket connection to CanvasSession_DO
 *
 * @packageDocumentation
 */

import type { CanvasDocument } from '../canvas/canvas-types'
import { compileFromCanvas } from '../canvas/compile-from-canvas'

// ═══════════════════════════════════════════════════════════════════════════
// Editor Client JS (inline — served as part of the page)
// ═══════════════════════════════════════════════════════════════════════════

function editorClientJS(canvasId: string, doId: string): string {
  return `
(function(){
'use strict';
var canvasId = ${JSON.stringify(canvasId)};
var doId = ${JSON.stringify(doId)};
var wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws?do=' + doId;

// ── State ──────────────────────────────────────────────────────────────
var selectedNodeId = null;
var lastAppliedVersion = 0;
var savedScrollY = 0;
var activeTextNodeId = null;
var ws = null;
var isDragging = false;
var dropIndicator = null;

// ── WebSocket Connection ───────────────────────────────────────────────
function connect() {
  ws = new WebSocket(wsUrl);
  ws.onopen = function() { console.log('[CanvasEditor] connected'); };
  ws.onmessage = function(e) {
    var msg = JSON.parse(e.data);
    handleServerMessage(msg);
  };
  ws.onclose = function() { setTimeout(connect, 1000); };
  ws.onerror = function() { ws.close(); };
}
connect();

// ── Server Message Handler ─────────────────────────────────────────────
function handleServerMessage(msg) {
  if (msg.type === 'state') {
    lastAppliedVersion = msg.doc.version;
    renderCanvas(msg.doc);
  } else if (msg.type === 'broadcast') {
    if (msg.version <= lastAppliedVersion) return; // dedup
    lastAppliedVersion = msg.version;
    applyBroadcast(msg);
  } else if (msg.type === 'mutation_rejected') {
    console.warn('[CanvasEditor] mutation rejected:', msg.reason);
  } else if (msg.type === 'mcp_call_accepted') {
    console.log('[CanvasEditor] mcp_call accepted at version', msg.version);
  } else if (msg.type === 'mcp_call_failed') {
    console.warn('[CanvasEditor] mcp_call failed:', msg.reason);
  } else if (msg.type === 'compiled') {
    console.log('[CanvasEditor] compiled at livePointer', msg.livePointer);
  }
}

// ── Broadcasting (applying mutation from server) ────────────────────────
function applyBroadcast(msg) {
  // Re-render by fetching state from server or applying mutation locally
  if (msg.mutation && msg.mutation.type === 'add_node') {
    // For v1, we re-render from scratch
    requestState();
  } else if (msg.mutation && msg.mutation.type === 'update_node') {
    // For v1, re-render
    requestState();
  } else if (msg.mutation && msg.mutation.type === 'delete_node') {
    requestState();
  } else {
    requestState();
  }
}

function requestState() {
  ws.send(JSON.stringify({ type: 'request_state' }));
}

// ── Render ─────────────────────────────────────────────────────────────
function renderCanvas(doc) {
  savedScrollY = window.scrollY;
  var root = document.getElementById('canvas-root');
  if (!root) return;

  // Save active text edit state
  var activeTextEl = document.activeElement;
  var activeTextContent = '';
  if (activeTextEl && activeTextEl.isContentEditable) {
    activeTextNodeId = activeTextEl.getAttribute('data-node-id') || activeTextEl.id;
    activeTextContent = activeTextEl.textContent || '';
  }

  // Fetch re-compiled HTML from server
  var xhr = new XMLHttpRequest();
  xhr.open('GET', '/api/canvas/' + canvasId + '/html', false);
  xhr.send();
  if (xhr.status === 200) {
    root.innerHTML = xhr.responseText;
  }

  // Restore scroll
  window.scrollTo(0, savedScrollY);

  // Restore selected node highlight
  if (selectedNodeId) {
    highlightNode(selectedNodeId);
  }

  // Update version display
  var verEl = document.getElementById('canvas-version');
  if (verEl) verEl.textContent = 'v' + doc.version;
  var rootEl = document.getElementById('canvas-root');
  if (rootEl) rootEl.setAttribute('data-version', doc.version);

  // Restore active text edit
  if (activeTextNodeId && activeTextContent) {
    var textEl = document.getElementById(activeTextNodeId);
    if (textEl && textEl.isContentEditable) {
      textEl.focus();
      // Place cursor at end
      var sel = window.getSelection();
      var range = document.createRange();
      range.selectNodeContents(textEl);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
}

// ── Selection ──────────────────────────────────────────────────────────
function highlightNode(nodeId) {
  var overlay = document.getElementById('editor-overlay');
  if (!overlay) return;
  var el = document.getElementById(nodeId);
  if (!el) {
    overlay.style.display = 'none';
    return;
  }
  var rect = el.getBoundingClientRect();
  overlay.style.display = 'block';
  overlay.style.left = (rect.left + window.scrollX) + 'px';
  overlay.style.top = (rect.top + window.scrollY) + 'px';
  overlay.style.width = rect.width + 'px';
  overlay.style.height = rect.height + 'px';
}

// ═══════════════════════════════════════════════════════════════════════
// Canvas Node Validation
// ═══════════════════════════════════════════════════════════════════════

/** IDs that belong to the editor chrome, not canvas nodes */
var EDITOR_IDS = {'canvas-root':1, 'editor-overlay':1, 'editor-toolbar':1, 'canvas-container':1, 'drop-indicator':1};

/** Returns true if the element is a valid, selectable canvas node */
function isCanvasNode(el) {
  if (!el || !el.id) return false;
  if (EDITOR_IDS[el.id]) return false;
  if (el.closest('#editor-toolbar')) return false;
  // Must have an id that matches a canvas node (not editor chrome)
  return true;
}

// ═══════════════════════════════════════════════════════════════════════
// Drop Indicator
// ═══════════════════════════════════════════════════════════════════════

function createDropIndicator() {
  var el = document.getElementById('drop-indicator');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'drop-indicator';
  el.style.cssText = 'position:fixed;height:3px;background:#58a6ff;border-radius:2px;z-index:101;pointer-events:none;display:none;box-shadow:0 0 8px rgba(88,166,255,0.4);';
  document.body.appendChild(el);
  return el;
}

function showDropIndicator(x, y) {
  if (!dropIndicator) dropIndicator = createDropIndicator();
  dropIndicator.style.display = 'block';
  dropIndicator.style.left = '40px';
  dropIndicator.style.width = (window.innerWidth - 80) + 'px';
  dropIndicator.style.top = Math.max(0, y - 1) + 'px';
}

function hideDropIndicator() {
  if (dropIndicator) dropIndicator.style.display = 'none';
}

// ═══════════════════════════════════════════════════════════════════════
// Click Selection
// ═══════════════════════════════════════════════════════════════════════

document.addEventListener('click', function(e) {
  // If clicking an mcp-tool element, DO NOT select — let MCP runtime handle it
  if (e.target.closest('[mcp-tool]')) return;

  var el = e.target.closest('[id]');
  if (!isCanvasNode(el)) return;

  selectedNodeId = el.id;
  highlightNode(el.id);
  e.stopPropagation();
});

// Click on canvas background deselects
document.getElementById('canvas-root')?.addEventListener('click', function(e) {
  if (e.target === this && !e.target.closest('[id]')) {
    selectedNodeId = null;
    var overlay = document.getElementById('editor-overlay');
    if (overlay) overlay.style.display = 'none';
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Drag to Reorder
// ═══════════════════════════════════════════════════════════════════════

var dragState = null;

document.addEventListener('mousedown', function(e) {
  if (!selectedNodeId) return;
  if (e.target.closest('#editor-toolbar')) return;
  if (e.target.closest('[contenteditable]')) return;
  if (e.target.closest('[mcp-tool]')) return;

  var el = document.getElementById(selectedNodeId);
  if (!el || !el.contains(e.target)) return;

  dragState = {
    nodeId: selectedNodeId,
    startX: e.clientX,
    startY: e.clientY,
    moved: false,
  };
});

document.addEventListener('mousemove', function(e) {
  if (!dragState) return;
  var dx = e.clientX - dragState.startX;
  var dy = e.clientY - dragState.startY;
  if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
    dragState.moved = true;
    isDragging = true;
    document.body.style.cursor = 'grabbing';
  }
  if (isDragging) {
    showDropIndicator(e.clientX, e.clientY);
  }
});

document.addEventListener('mouseup', function(e) {
  if (!dragState) return;
  hideDropIndicator();
  document.body.style.cursor = '';
  isDragging = false;

  if (dragState.moved) {
    // Find the valid drop target under cursor — must be a canvas node
    // and must NOT be the dragged node or its descendant
    var dropEl = document.elementFromPoint(e.clientX, e.clientY);
    var validTarget = null;

    while (dropEl) {
      if (dropEl.id && isCanvasNode(dropEl) && dropEl.id !== dragState.nodeId) {
        // Verify we're not dropping into our own subtree
        var ancestor = dropEl;
        var isDescendant = false;
        while (ancestor) {
          if (ancestor.id === dragState.nodeId) { isDescendant = true; break; }
          ancestor = ancestor.parentElement;
        }
        if (!isDescendant) { validTarget = dropEl; break; }
      }
      dropEl = dropEl.parentElement;
    }

    if (validTarget) {
      ws.send(JSON.stringify({
        type: 'mutation',
        mutation: {
          type: 'move_node',
          nodeId: dragState.nodeId,
          newParentId: validTarget.id,
        },
        expectedVersion: lastAppliedVersion,
      }));
    }
  }
  dragState = null;
});

// ── Text Editing ───────────────────────────────────────────────────────
document.addEventListener('dblclick', function(e) {
  var el = e.target.closest('[id]');
  if (!el) return;

  // Only allow text editing on Text or Button nodes
  // (identified by tag — span = text, button = button)
  if (el.tagName === 'SPAN' || el.tagName === 'BUTTON') {
    el.contentEditable = 'plaintext-only';
    el.focus();
    selectedNodeId = el.id;
    highlightNode(el.id);
  }
});

document.addEventListener('blur', function(e) {
  var el = e.target;
  if (el.isContentEditable) {
    el.contentEditable = 'inherit';
    var newText = el.textContent || '';
    ws.send(JSON.stringify({
      type: 'mutation',
      mutation: {
        type: 'update_node',
        nodeId: el.id,
        props: { text: newText },
      },
      expectedVersion: lastAppliedVersion,
    }));
  }
}, true); // capture phase for blur

// ── Delete Node (Del key when node selected) ───────────────────────────
document.addEventListener('keydown', function(e) {
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (!selectedNodeId) return;
    // Don't delete while editing text
    if (document.activeElement && document.activeElement.isContentEditable) return;
    e.preventDefault();
    ws.send(JSON.stringify({
      type: 'mutation',
      mutation: {
        type: 'delete_node',
        nodeId: selectedNodeId,
      },
      expectedVersion: lastAppliedVersion,
    }));
    selectedNodeId = null;
    var overlay = document.getElementById('editor-overlay');
    if (overlay) overlay.style.display = 'none';
  }
});

// ── WebMCP Runtime ─────────────────────────────────────────────────────
function mcpExtractPayload(el) {
  // For forms: extract form data
  if (el.tagName === 'FORM' || el.tagName === 'FORM') {
    var data = {};
    var inputs = el.querySelectorAll('[name]');
    for (var i = 0; i < inputs.length; i++) {
      data[inputs[i].name] = inputs[i].value;
    }
    return data;
  }
  return {};
}

// Intercept form submits with mcp-tool
document.addEventListener('submit', function(e) {
  var el = e.target;
  var tool = el.getAttribute('mcp-tool');
  if (!tool) return;
  e.preventDefault();
  ws.send(JSON.stringify({
    type: 'mcp_call',
    tool: tool,
    payload: mcpExtractPayload(el),
    expectedVersion: lastAppliedVersion,
  }));
});

// Intercept clicks on elements with mcp-tool
document.addEventListener('click', function(e) {
  var el = e.target.closest('[mcp-tool]');
  if (!el) return;
  // Don't intercept during drag or selection
  if (isDragging) return;
  if (selectedNodeId) return;
  // Only intercept if it's a valid canvas node
  if (!isCanvasNode(el)) return;
  e.preventDefault();
  e.stopPropagation();
  ws.send(JSON.stringify({
    type: 'mcp_call',
    tool: el.getAttribute('mcp-tool'),
    payload: mcpExtractPayload(el),
    expectedVersion: lastAppliedVersion,
  }));
});

})();
`.trim()
}

// ═══════════════════════════════════════════════════════════════════════════
// Canvas Landing Page
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Render the Canvas landing page — clone or create.
 */
export function renderCanvasLanding(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>EdgeGDE Canvas</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  background: #0d1117;
  color: #e1e4e8;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 60px 20px;
}
h1 { font-size: 28px; margin-bottom: 8px; }
.subtitle { color: #8b949e; margin-bottom: 40px; font-size: 15px; }
.cards { display: flex; gap: 24px; flex-wrap: wrap; justify-content: center; max-width: 800px; }
.card {
  background: #1c2128;
  border: 1px solid #2d3140;
  border-radius: 12px;
  padding: 32px;
  width: 340px;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}
.card:hover { border-color: #58a6ff; background: #21262d; }
.card h2 { font-size: 18px; margin-bottom: 12px; }
.card p { color: #8b949e; font-size: 13px; line-height: 1.5; margin-bottom: 16px; }
.card input, .card textarea {
  width: 100%;
  padding: 10px 12px;
  background: #0d1117;
  border: 1px solid #2d3140;
  border-radius: 6px;
  color: #e1e4e8;
  font-size: 13px;
  outline: none;
  margin-bottom: 12px;
}
.card input:focus, .card textarea:focus { border-color: #58a6ff; }
.card button {
  padding: 8px 20px;
  background: #238636;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}
.card button:hover { background: #2ea043; }
.card .error { color: #f85149; font-size: 12px; margin-top: 8px; display: none; }
.status-badge {
  margin-top: 40px;
  padding: 8px 16px;
  background: #1c2128;
  border: 1px solid #2d3140;
  border-radius: 6px;
  font-size: 12px;
  color: #8b949e;
}
</style>
</head>
<body>
<h1>EdgeGDE Canvas</h1>
<p class="subtitle">Clone a website or generate from a prompt</p>
<div class="cards">
  <div class="card" id="card-clone">
    <h2>🌐 Clone Website</h2>
    <p>Enter a URL to clone an existing website into an editable CanvasDocument.</p>
    <input type="url" id="clone-url" placeholder="https://example.com" />
    <button id="btn-clone" onclick="cloneWebsite()">Clone</button>
    <div class="error" id="clone-error"></div>
  </div>
  <div class="card" id="card-generate">
    <h2>✨ Generate from Prompt</h2>
    <p>Describe the website you want, and AI will generate a CanvasDocument.</p>
    <textarea id="gen-prompt" rows="3" placeholder="A landing page for a financial services company with a hero section, contact form, and footer..."></textarea>
    <button id="btn-generate" onclick="generateWebsite()">Generate</button>
    <div class="error" id="gen-error"></div>
  </div>
  <div class="card" id="card-empty" style="width:100%;max-width:340px;text-align:center;">
    <h2>📄 Start Empty</h2>
    <p>Create a blank canvas to build from scratch.</p>
    <button onclick="createEmpty()">Create Empty Canvas</button>
  </div>
</div>
<div class="status-badge">Canvas Platform v1.0.0</div>
<script>
function createEmpty() {
  var btn = document.querySelector('#card-empty button');
  btn.disabled = true;
  btn.textContent = 'Creating...';
  fetch('/api/canvas/create', { method: 'POST', body: '{}' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      window.location.href = '/canvas/' + data.id + '/edit';
    })
    .catch(function(e) {
      btn.disabled = false;
      btn.textContent = 'Create Empty Canvas';
      document.querySelector('#gen-error').textContent = 'Error: ' + e.message;
      document.querySelector('#gen-error').style.display = 'block';
    });
}
function cloneWebsite() {
  var url = document.getElementById('clone-url').value.trim();
  var err = document.getElementById('clone-error');
  if (!url) { err.textContent = 'Please enter a URL'; err.style.display = 'block'; return; }
  err.style.display = 'none';
  document.getElementById('btn-clone').disabled = true;
  document.getElementById('btn-clone').textContent = 'Cloning...';
  fetch('/api/canvas/clone', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: url }),
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) {
        err.textContent = data.error;
        err.style.display = 'block';
        document.getElementById('btn-clone').disabled = false;
        document.getElementById('btn-clone').textContent = 'Clone';
        return;
      }
      window.location.href = '/canvas/' + data.id + '/edit';
    })
    .catch(function(e) {
      err.textContent = 'Error: ' + e.message;
      err.style.display = 'block';
      document.getElementById('btn-clone').disabled = false;
      document.getElementById('btn-clone').textContent = 'Clone';
    });
}
function generateWebsite() {
  var prompt = document.getElementById('gen-prompt').value.trim();
  var err = document.getElementById('gen-error');
  if (!prompt) { err.textContent = 'Please enter a prompt'; err.style.display = 'block'; return; }
  err.style.display = 'none';
  document.getElementById('btn-generate').disabled = true;
  document.getElementById('btn-generate').textContent = 'Generating...';
  fetch('/api/canvas/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: prompt }),
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.id) {
        // Cache hit — immediate redirect
        window.location.href = '/canvas/' + data.id + '/edit';
        return;
      }
      if (data.jobId) {
        // Streaming — poll for completion
        pollGenerateStatus(data.jobId);
      } else if (data.error) {
        throw new Error(data.error);
      }
    })
    .catch(function(e) {
      err.textContent = 'Error: ' + e.message;
      err.style.display = 'block';
      document.getElementById('btn-generate').disabled = false;
      document.getElementById('btn-generate').textContent = 'Generate';
    });
}

function pollGenerateStatus(jobId) {
  var btn = document.getElementById('btn-generate');
  var statusEl = document.getElementById('gen-status') || (function() {
    var el = document.createElement('div');
    el.id = 'gen-status';
    el.style.cssText = 'color:#8b949e;font-size:12px;margin-top:8px;';
    document.getElementById('gen-error').parentNode.appendChild(el);
    return el;
  })();
  statusEl.textContent = 'Generating layout... (this may take 30-60s)';

  var poll = setInterval(function() {
    fetch('/api/canvas/generate/status/' + jobId)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.status === 'complete') {
          clearInterval(poll);
          window.location.href = '/canvas/' + data.id + '/edit';
        } else if (data.status === 'error') {
          clearInterval(poll);
          btn.disabled = false;
          btn.textContent = 'Generate';
          statusEl.textContent = '';
          document.getElementById('gen-error').textContent = data.error || 'Generation failed';
          document.getElementById('gen-error').style.display = 'block';
        }
      })
      .catch(function() {
        // Poll retries on next interval
      });
  }, 2000);
}

// ── Canvas Chat ────────────────────────────────────────────────────────
function sendChatMessage() {
  var input = document.getElementById('chat-input');
  var msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  input.disabled = true;
  document.getElementById('chat-send-btn').disabled = true;

  addChatMessage(msg, 'user');
  addChatMessage('Thinking...', 'agent');

  fetch('/api/canvas/' + canvasId + '/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: msg, selectedNodeId: selectedNodeId || undefined }),
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      removeLastThinking();
      if (data.success) {
        addChatMessage('✅ ' + data.intent + ' (' + data.mutCount + ' mutation' + (data.mutCount > 1 ? 's' : '') + ')', 'agent');
        // Update version display
        var verEl = document.getElementById('canvas-version');
        if (verEl && data.version) verEl.textContent = 'v' + data.version;
        requestState();
      } else {
        addChatMessage('Error: ' + (data.error || 'Unknown error'), 'error');
      }
    })
    .catch(function(e) {
      removeLastThinking();
      addChatMessage('Error: ' + e.message, 'error');
    })
    .finally(function() {
      input.disabled = false;
      document.getElementById('chat-send-btn').disabled = false;
      input.focus();
    });
}

function addChatMessage(text, cls) {
  var el = document.createElement('div');
  el.className = 'chat-msg ' + cls;
  el.textContent = text;
  document.getElementById('chat-messages').appendChild(el);
  el.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function removeLastThinking() {
  var msgs = document.getElementById('chat-messages');
  var last = msgs.lastElementChild;
  if (last && last.textContent === 'Thinking...') msgs.removeChild(last);
}

// Enter key sends chat
document.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && document.activeElement === document.getElementById('chat-input')) {
    e.preventDefault();
    sendChatMessage();
  }
});

// Chat panel toggle
document.getElementById('chat-toggle')?.addEventListener('click', function() {
  var panel = document.getElementById('chat-panel');
  var minimized = panel.getAttribute('data-minimized') === 'true';
  panel.setAttribute('data-minimized', minimized ? 'false' : 'true');
  if (minimized) {
    panel.style.height = '50vh';
  } else {
    panel.style.height = '36px';
  }
});
</script>
</body>
</html>`
}

// ═══════════════════════════════════════════════════════════════════════════
// Editor HTML Page
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Render the full editor HTML page for a CanvasDocument.
 *
 * @param doc - The CanvasDocument to edit
 * @param canvasId - The canvas ID (used for WebSocket routing)
 * @returns Full HTML page as a string
 */
export function renderEditorPage(doc: CanvasDocument, canvasId: string): string {
  const compiledHtml = compileFromCanvas(doc) || '<div class="empty-state">Empty canvas — add nodes via chat or cloner</div>'
  const doId = canvasId // DO instance ID matches canvas ID
  const version = doc.version

  const clientJS = editorClientJS(canvasId, doId)

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Canvas Editor — ${canvasId}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  background: #0d1117;
  color: #e1e4e8;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  min-height: 100vh;
}
#canvas-container {
  position: relative;
  width: 1440px;
  min-height: 100vh;
  margin: 0 auto;
  background: #161b22;
}
#canvas-root {
  min-height: 100vh;
  padding: 20px;
  position: relative;
}
#canvas-root > main { min-height: calc(100vh - 40px); }
.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 60vh;
  color: #8b949e;
  font-size: 18px;
}
#editor-overlay {
  position: absolute;
  pointer-events: none;
  border: 2px solid #58a6ff;
  background: rgba(88, 166, 255, 0.08);
  border-radius: 4px;
  display: none;
  z-index: 100;
  transition: all 0.1s ease;
}
#editor-toolbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 40px;
  background: #1c2128;
  border-bottom: 1px solid #2d3140;
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 12px;
  z-index: 200;
  font-size: 13px;
}
#editor-toolbar .title { color: #8b949e; font-weight: 600; }
#editor-toolbar .status { color: #3fb950; margin-left: auto; }
#canvas-container { margin-top: 40px; }
#chat-panel {
  position: fixed;
  bottom: 0;
  right: 0;
  width: 340px;
  height: 50vh;
  background: #1c2128;
  border-left: 1px solid #2d3140;
  border-top: 1px solid #2d3140;
  border-radius: 8px 0 0 0;
  display: flex;
  flex-direction: column;
  z-index: 300;
  font-size: 13px;
}
#chat-panel .chat-header {
  padding: 8px 12px;
  border-bottom: 1px solid #2d3140;
  font-weight: 600;
  color: #8b949e;
  cursor: pointer;
  user-select: none;
}
#chat-panel .chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
}
#chat-panel .chat-msg {
  margin-bottom: 6px;
  padding: 6px 10px;
  border-radius: 6px;
  line-height: 1.4;
}
#chat-panel .chat-msg.user {
  background: #2d3140;
  color: #e1e4e8;
}
#chat-panel .chat-msg.agent {
  background: #0d1117;
  border: 1px solid #2d3140;
  color: #3fb950;
}
#chat-panel .chat-msg.error {
  background: #0d1117;
  border: 1px solid #f85149;
  color: #f85149;
}
#chat-panel .chat-input-area {
  display: flex;
  border-top: 1px solid #2d3140;
  padding: 6px;
  gap: 4px;
}
#chat-panel .chat-input-area input {
  flex: 1;
  padding: 6px 10px;
  background: #0d1117;
  border: 1px solid #2d3140;
  border-radius: 4px;
  color: #e1e4e8;
  font-size: 13px;
  outline: none;
}
#chat-panel .chat-input-area input:focus { border-color: #58a6ff; }
#chat-panel .chat-input-area button {
  padding: 6px 12px;
  background: #238636;
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}
#chat-panel .chat-input-area button:disabled { opacity: 0.5; cursor: default; }
</style>
</head>
<body>
<div id="editor-toolbar">
  <span class="title">Canvas Editor</span>
  <span id="canvas-id-display">${canvasId}</span>
  <span class="status"><span id="canvas-version">v${version}</span></span>
</div>
<div id="canvas-container">
  <div id="canvas-root" data-canvas-id="${canvasId}" data-version="${version}">
    ${compiledHtml}
  </div>
  <div id="editor-overlay"></div>
</div>
<div id="chat-panel" data-minimized="false">
  <div class="chat-header" id="chat-toggle">💬 Agent Chat</div>
  <div class="chat-messages" id="chat-messages">
    <div class="chat-msg agent">Ask me to edit the canvas. Try "add a hero section with a blue background" or "change the title to Hello World".</div>
  </div>
  <div class="chat-input-area">
    <input type="text" id="chat-input" placeholder="Describe the change..." />
    <button id="chat-send-btn" onclick="sendChatMessage()">Send</button>
  </div>
</div>
<script>
${clientJS}
</script>
</body>
</html>`
}
