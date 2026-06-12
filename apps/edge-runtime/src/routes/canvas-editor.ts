/**
 * EdgeGDE Canvas — Canvas Editor Route
 * Canvas Platform v1.0.0
 * Phase 3: Inline visual editor with WebMCP runtime.
 *
 * Serves the editor page at GET /canvas/:id/edit.
 * Client JS is loaded from public/js/canvas-editor/ as modular files.
 *
 * @packageDocumentation
 */

import type { CanvasDocument } from '../canvas/canvas-types'
import { compileFromCanvas } from '../canvas/compile-from-canvas'

// ═══════════════════════════════════════════════════════════════════════════
// Editor Client JS (modular — loaded from public/js/canvas-editor/)
// Files served automatically by Cloudflare Workers static assets.
// ═══════════════════════════════════════════════════════════════════════════

function editorClientScripts(canvasId: string, doId: string): string {
  const files = ['event-bus.js','editor-state.js','ws-client.js','nodes.js','interactions.js','mcp-runtime.js','chat-panel.js','main.js']
  // Set canvasId and doId as config before loading scripts
  var html = '<script id="editor-config" type="application/json">' + JSON.stringify({canvasId,doId}) + '</scr' + 'ipt>\n'
  for (const f of files) {
    html += '<script src="/js/canvas-editor/' + f + '"></scr' + 'ipt>\n'
  }
  return html
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

  const clientJS = editorClientScripts(canvasId, doId)

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
  <div id="canvas-root" data-canvas-id="${canvasId}" data-do-id="${doId}" data-version="${version}">
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
