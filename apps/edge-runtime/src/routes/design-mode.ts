/**
 * EdgeGDE — Orca Design Mode routes.
 *
 * Admin-console surface for the Orca→Resolver bridge (contract IDD-016):
 *  - GET  /design-mode            — Design Mode console page (loads /design-mode.js)
 *  - POST /design-mode/resolve    — resolver proxy: MCP tool mcp_resolve_element
 *                                   first (§5.1), byte-identical HTTP fallback
 *                                   (§5.2), caller-synthesized RESOLVER_UNREACHABLE
 *                                   when both transports fail (§5.3 rule 3).
 *
 * The in-page script (public/design-mode.js) owns the toggle, overlay, pick
 * handling and in-page capture fields. The CDP half of the capture recipe
 * (§6.2: exact backendDOMNodeId, DOM.getOuterHTML, CSS.getComputedStyleForNode,
 * box model, clipped screenshot) runs in the Orca automation controller
 * (automation/orca/design_mode_capture.py) which upgrades picks via a Runtime
 * binding before transport.
 */
import { Hono } from 'hono'
import { requireSession, SessionContext } from '../middleware/session'
import { envFromContext } from '../lib/env'

const router = new Hono()

// ═══════════════════════════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════════════════════════

const DESIGN_MODE_STYLES = `
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0d1117;color:#e1e4e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.5}
  a{color:#58a6ff;text-decoration:none}
  .container{max-width:1200px;margin:0 auto;padding:24px}
  .card{background:#161b22;border:1px solid #2d3140;border-radius:8px;padding:16px;margin-bottom:16px}
  .card h2{font-size:15px;color:#f0f6fc;margin-bottom:12px}
  .label{font-size:11px;color:#4a4d55;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;display:block}
  .value{font-size:13px;color:#e1e4e8;margin-bottom:8px;font-family:monospace}
  .row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #1c2128}
  .row:last-child{border-bottom:none}
  .btn{padding:6px 12px;border-radius:6px;font-size:12px;font-weight:500;border:none;cursor:pointer}
  .btn-primary{background:#238636;color:#fff}
  .btn-secondary{background:#1c2128;color:#e1e4e8;border:1px solid #2d3140}
  .badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:500}
  .badge-green{background:#23863620;color:#3fb950;border:1px solid #238636}
  .badge-yellow{background:#d2992220;color:#d29922;border:1px solid #d29922}
  .badge-red{background:#da363320;color:#f85149;border:1px solid #da3633}
  .badge-blue{background:#1f6feb20;color:#58a6ff;border:1px solid #1f6feb}
  .topbar{background:#161b22;border-bottom:1px solid #2d3140;padding:12px 24px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:100}
  .topbar h1{font-size:16px;color:#f0f6fc}
  .topbar a{margin-left:auto;font-size:12px}
  .flex{display:flex;gap:12px;flex-wrap:wrap}
  .flex-1{flex:1;min-width:280px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
  .monospace{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
  pre{background:#0d1117;border:1px solid #2d3140;border-radius:6px;padding:12px;overflow:auto;max-height:400px;font-size:11px;line-height:1.5}
  .status-dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:8px}
  .status-dot.active{background:#3fb950;box-shadow:0 0 8px #3fb950}
  .status-dot.inactive{background:#4a4d55}
  .status-dot.error{background:#f85149;box-shadow:0 0 8px #f85149}
  .status-dot.pending{background:#d29922;box-shadow:0 0 8px #d29922;animation:pulse 1s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}
  .overlay-info{background:#1c2128;border:1px solid #388bfd20;border-radius:6px;padding:12px;margin-bottom:12px;font-size:12px}
  .overlay-info.warning{border-color:#d2992240;background:#2d2716}
  .overlay-info.error{border-color:#da363340;background:#2d1616}
  .log-entry{font-size:11px;font-family:monospace;padding:4px 8px;border-bottom:1px solid #1c2128}
  .log-entry.error{color:#f85149}
  .log-entry.warning{color:#d29922}
  .log-entry.success{color:#3fb950}
  .log-entry.info{color:#58a6ff}
  .log-entry.debug{color:#8b949e}
  .capture-preview{border:1px solid #2d3140;border-radius:6px;overflow:hidden;max-height:300px;overflow:auto}
  .capture-preview img{max-width:100%;height:auto;display:block}
  .key-value{display:flex;gap:8px;margin:4px 0}
  .key-value .key{color:#8b949e;min-width:160px}
  .key-value .value{color:#e1e4e8;word-break:break-all}
  .tabs{display:flex;gap:4px;border-bottom:1px solid #2d3140;margin-bottom:12px}
  .tab{padding:8px 16px;background:transparent;border:none;color:#8b949e;font-size:12px;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}
  .tab.active{color:#f0f6fc;border-bottom-color:#58a6ff}
  .tab-panel{display:none}
  .tab-panel.active{display:block}
  .collapsible{margin-top:8px}
  .collapsible summary{cursor:pointer;color:#8b949e;font-size:12px;padding:4px 0}
  .json-highlight .key{color:#79c0ff}
  .json-highlight .string{color:#a5d6ff}
  .json-highlight .number{color:#79c0ff}
  .json-highlight .boolean{color:#ff7b72}
`

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function layout(title: string, body: string, stateEnginePort: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} — EdgeGDE</title>
  <style>${DESIGN_MODE_STYLES}</style>
</head>
<body data-state-engine-port="${stateEnginePort}">
  <script src="/design-mode.js"></script>
  <div class="topbar">
    <h1>Orca Design Mode</h1>
    <a href="/tenant/dashboard">← Back to Dashboard</a>
  </div>
  <div class="container">
    ${body}
  </div>
</body>
</html>`
}

/** Design Mode console page HTML (exported for tests). */
export function renderDesignModePage(stateEnginePort: string): string {
  const body = `
    <div class="card">
      <h2>Design Mode Element Capture</h2>
      <p style="font-size:13px;color:#8b949e;margin-bottom:16px">
        Enable Design Mode to pick elements on this page. Click any element — including
        Radix portal elements — to capture its IDD-016 payload and resolve it via the
        Hermes State Engine Resolver (MCP first, HTTP fallback).
      </p>
      <div class="flex" style="align-items:center;gap:16px;margin-bottom:16px">
        <button id="designModeToggle" class="btn btn-primary" onclick="toggleDesignMode()">
          <span id="toggleIcon">◉</span> <span id="toggleText">Enable Design Mode</span>
        </button>
        <span id="designModeStatus" class="status-dot inactive"></span>
        <span id="designModeStatusText" style="color:#8b949e">Inactive</span>
      </div>
      <div id="overlayInfo" class="overlay-info" style="display:none">
        <strong>Design Mode Active</strong> — Hover elements to highlight. Click to capture and resolve.
        Press <kbd>Esc</kbd> to cancel.
      </div>
    </div>

    <div class="grid">
      <div class="card flex-1">
        <h2>Last Capture</h2>
        <div id="captureStatus" class="overlay-info">
          <span class="status-dot inactive"></span> No capture yet. Enable Design Mode and click an element.
        </div>
        <div id="capturePreview" class="capture-preview" style="display:none"></div>
        <details class="collapsible" id="captureDetails" style="display:none">
          <summary>Capture Payload (JSON)</summary>
          <pre id="capturePayload" class="json-highlight"></pre>
        </details>
      </div>

      <div class="card flex-1">
        <h2>Resolver Response</h2>
        <div id="resolverStatus" class="overlay-info">
          <span class="status-dot inactive"></span> Awaiting capture...
        </div>
        <div class="tabs">
          <button class="tab active" data-tab="resolution" onclick="showTab('resolution')">Resolution</button>
          <button class="tab" data-tab="error" onclick="showTab('error')">Error</button>
          <button class="tab" data-tab="raw" onclick="showTab('raw')">Raw JSON</button>
        </div>
        <div id="tab-resolution" class="tab-panel active">
          <div id="resolutionContent" style="font-size:13px">No resolution yet.</div>
        </div>
        <div id="tab-error" class="tab-panel">
          <div id="errorContent" style="font-size:13px">No error.</div>
        </div>
        <div id="tab-raw" class="tab-panel">
          <pre id="rawResponse" class="json-highlight" style="display:none"></pre>
          <p id="rawEmpty" style="color:#8b949e;font-size:12px">No response yet.</p>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Transport Log</h2>
      <div id="transportLog" style="max-height:200px;overflow:auto;font-size:11px;font-family:monospace;background:#0d1117;border:1px solid #2d3140;border-radius:6px;padding:8px">
        <div class="log-entry debug">Design Mode initialized. State Engine: http://127.0.0.1:${stateEnginePort} (MCP :/mcp, HTTP fallback :/api/v1/resolver/resolve)</div>
      </div>
    </div>

    <div class="card">
      <h2>Action Confirmation</h2>
      <div id="confirmationStatus" class="overlay-info">
        <span class="status-dot inactive"></span> No action yet. Pick an element to resolve it; when the Orca CDP controller executes a bridged action, the tab hot-reloads and the before/after evidence panel lands here.
      </div>
      <div id="confirmationContent" style="font-size:13px"></div>
    </div>

    <div class="card">
      <h2>Settings</h2>
      <div class="grid">
        <div>
          <label class="label">State Engine Port</label>
          <div class="value">${escapeHtml(stateEnginePort)}</div>
        </div>
        <div>
          <label class="label">Request Timeout</label>
          <div class="value"><input type="number" id="timeoutMs" value="10000" min="1000" max="30000" style="width:100px"> ms</div>
        </div>
        <div>
          <label class="label">App Context</label>
          <div class="value"><input type="text" id="appContext" value="salestrekker" style="width:200px"></div>
        </div>
        <div>
          <label class="label">Locale</label>
          <div class="value"><input type="text" id="localeContext" value="en-AU" style="width:100px"></div>
        </div>
        <div>
          <label class="label">Action Policy</label>
          <div class="value" style="display:flex;align-items:center;gap:6px;font-family:inherit">
            <input type="checkbox" id="autoExecuteActions" checked>
            <span>Auto-execute actions (confidence ≥ 0.9, Orca CDP controller path)</span>
          </div>
        </div>
      </div>
    </div>
  `
  return layout('Orca Design Mode', body, stateEnginePort)
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /design-mode — Design Mode console page
// ═══════════════════════════════════════════════════════════════════════════

router.get('/', requireSession(), async (c: SessionContext) => {
  const env = envFromContext(c)
  const stateEnginePort = env.STATE_ENGINE_PORT || '9110'
  return c.html(renderDesignModePage(stateEnginePort))
})

// ═══════════════════════════════════════════════════════════════════════════
// Resolver transport (IDD-016 §5)
// ═══════════════════════════════════════════════════════════════════════════

const MCP_CONNECT_TIMEOUT_MS = 2000 // §5.2
const BRIDGE_VERSION = '1.0.0'

function baseUrl(port: string): string {
  return `http://127.0.0.1:${port || '9110'}`
}

/**
 * Parse a contract envelope from a transport response body.
 * MCP: tools/call result wraps the envelope in content[0].text (§5.1).
 * HTTP: the body IS the envelope, at the error-codes.json status (§5.2).
 * Returns null for JSON-RPC protocol errors and unparseable bodies —
 * those are transport failures, triggering failover (§5.3).
 */
function envelopeFromBody(body: unknown): Record<string, unknown> | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>
  if ('error' in b && 'result' in b) return null // JSON-RPC protocol error
  if (b['schema_version'] && ('resolution' in b || 'error' in b)) return b
  const result = b['result']
  if (typeof result === 'object' && result !== null) {
    const content = (result as Record<string, unknown>)['content']
    if (Array.isArray(content) && content.length > 0) {
      const first = content[0] as Record<string, unknown>
      const text = first && typeof first['text'] === 'string' ? first['text'] : null
      if (text) {
        try {
          const inner = JSON.parse(text)
          if (typeof inner === 'object' && inner !== null && (inner as Record<string, unknown>)['schema_version']) {
            return inner as Record<string, unknown>
          }
        } catch {
          return null
        }
      }
    }
  }
  return null
}

function unreachableEnvelope(requestId: string, targetId: string, detail: string): Record<string, unknown> {
  // §5.3 rule 3 — caller-synthesized when both transports fail.
  return {
    schema_version: '1.0.0',
    request_id: requestId,
    resolved_at: new Date().toISOString(),
    resolver: { version: 'edge-runtime-design-mode@1.0.0', latency_ms: 0, node_live: false, target_id: targetId },
    error: {
      code: 'RESOLVER_UNREACHABLE',
      message: `Neither MCP (mcp_resolve_element) nor HTTP fallback responded. ${detail}`,
      retryable: true,
      retry_policy: 'backoff',
      details: { transports_attempted: ['mcp', 'http'], ladder_ms: [5000, 15000, 25000, 60000] },
      known_bug_flags: []
    },
    warnings: []
  }
}

export interface ResolveOptions {
  stateEnginePort: string
  timeoutMs: number
}

export interface ResolveOutcome {
  transport: 'mcp' | 'http_fallback' | 'unreachable'
  response: Record<string, unknown>
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) }
    )
  })
}

/**
 * Forward one resolver request: MCP first, byte-identical HTTP fallback,
 * RESOLVER_UNREACHABLE synthesis when both fail (IDD-016 §5).
 * Exported for unit tests; the route handler passes the raw request bytes
 * through unchanged so the fallback body is byte-identical (§5.2).
 */
export async function forwardToResolver(
  parsed: Record<string, unknown>,
  rawBody: string,
  opts: ResolveOptions
): Promise<ResolveOutcome> {
  const base = baseUrl(opts.stateEnginePort)
  const requestId = typeof parsed['request_id'] === 'string' ? parsed['request_id'] : 'unknown'
  const targetId = typeof (parsed['page'] as Record<string, unknown> | undefined)?.['target_id'] === 'string'
    ? ((parsed['page'] as Record<string, unknown>)['target_id'] as string)
    : ''

  // §5.1 — MCP primary: mcp_resolve_element via streamable HTTP JSON-RPC.
  try {
    const rpcFrame = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'mcp_resolve_element', arguments: parsed }
    })
    const resp = await withTimeout(
      fetch(`${base}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: rpcFrame
      }),
      MCP_CONNECT_TIMEOUT_MS,
      'MCP'
    )
    const envelope = envelopeFromBody(await resp.json())
    if (envelope !== null) {
      console.log('[DesignMode] resolver responded via MCP request_id=' + requestId)
      return { transport: 'mcp', response: envelope }
    }
    console.log('[DesignMode] MCP response was not a contract envelope — failing over (HTTP ' + resp.status + ')')
  } catch (e) {
    console.log('[DesignMode] MCP transport failed:', (e as Error).message)
  }

  // §5.2 — HTTP fallback: byte-identical payload, bridge version header.
  try {
    const resp = await withTimeout(
      fetch(`${base}/api/v1/resolver/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Orca-Bridge-Version': BRIDGE_VERSION },
        body: rawBody
      }),
      opts.timeoutMs + 5000,
      'HTTP fallback'
    )
    const envelope = envelopeFromBody(await resp.json())
    if (envelope !== null) {
      console.log('[DesignMode] resolver responded via HTTP fallback request_id=' + requestId)
      return { transport: 'http_fallback', response: envelope }
    }
    console.log('[DesignMode] HTTP fallback body was not a contract envelope (HTTP ' + resp.status + ')')
  } catch (e) {
    console.log('[DesignMode] HTTP fallback transport failed:', (e as Error).message)
  }

  // §5.3 rule 3 — both transports failed: synthesize locally.
  console.log('[DesignMode] both transports failed — synthesizing RESOLVER_UNREACHABLE')
  return {
    transport: 'unreachable',
    response: unreachableEnvelope(requestId, targetId, 'state engine unreachable on port ' + opts.stateEnginePort)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /design-mode/resolve — resolver proxy (bypasses browser CORS)
// ═══════════════════════════════════════════════════════════════════════════

router.post('/resolve', requireSession(), async (c: SessionContext) => {
  const env = envFromContext(c)
  const rawBody = await c.req.text()

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(rawBody) as Record<string, unknown>
  } catch (e) {
    return c.json({ error: 'INVALID_REQUEST_BODY', message: (e as Error).message } as Record<string, unknown>, 400)
  }

  const timeoutMs = typeof parsed['timeout_ms'] === 'number' ? Math.min(30000, Math.max(1000, parsed['timeout_ms'])) : 10000
  const outcome = await forwardToResolver(parsed, rawBody, {
    stateEnginePort: env.STATE_ENGINE_PORT || '9110',
    timeoutMs
  })

  const status = outcome.transport === 'unreachable' ? 502 : 200
  return c.json({ transport: outcome.transport, response: outcome.response } as Record<string, unknown>, status)
})

export { router as designModeRouter }
