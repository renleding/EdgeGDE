/**
 * Tests for the Orca Design Mode resolver proxy (IDD-016 §5 transport).
 *
 * Covers: MCP-first delivery, byte-identical HTTP fallback, in-band contract
 * errors vs transport failures, and caller-synthesized RESOLVER_UNREACHABLE.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forwardToResolver, renderDesignModePage } from '../src/routes/design-mode'

const REQUEST = {
  schema_version: '1.0.0',
  request_id: '3f6b2a1e-7c4d-4e5f-9a8b-1c2d3e4f5a6b',
  captured_at: '2026-10-26T08:15:00.000Z',
  timeout_ms: 10000,
  page: { url: 'https://pc.v2.salestrekker.com/deals/1/assets/new', target_id: 'A1B2C3D4E5F6A7B8C9D0', viewport: { width: 1440, height: 900 } },
  element: {
    backend_dom_node_id: 4821,
    dom_snapshot: {
      outer_html: '<button id="save">Save</button>',
      tag: 'button',
      attributes: { id: 'save' },
      text_content: 'Save',
      ancestor_path: [{ tag: 'div', index: 1, id: 'asset-form' }, { tag: 'body', index: 1 }, { tag: 'html', index: 1 }],
      structural_hash: 'a'.repeat(64),
      child_count: 0,
      truncated: false
    },
    computed_styles: {
      display: 'block', visibility: 'visible', opacity: '1', 'pointer-events': 'auto', cursor: 'pointer',
      color: 'rgba(0,0,0,1)', 'background-color': 'rgba(255,255,255,1)', 'font-size': '14px', 'font-weight': '400', 'text-align': 'left'
    },
    geometry: { x: 640, y: 812, width: 168, height: 40, coordinate_space: 'viewport' },
    portal: { in_portal: false },
    screenshot: { storage: 'data_uri', data_uri: 'data:image/png;base64,AAAA', mime_type: 'image/png', width: 168, height: 40, sha256: 'b'.repeat(64) }
  },
  context: { app: 'salestrekker', locale: 'en-AU', hints: { capture_source: 'cdp', design_mode: true } }
}

const ENVELOPE = {
  schema_version: '1.0.0',
  request_id: REQUEST.request_id,
  resolved_at: '2026-10-26T08:15:01.000Z',
  resolution: {
    status: 'resolved', resolution_path: 'exact_backend_node', confidence: 1.0,
    element_ref: { backend_dom_node_id: 4821, selector: 'button#save', bounds: { x: 640, y: 812, width: 168, height: 40 }, target_id: 'A1B2C3D4E5F6A7B8C9D0' },
    strategy: 'backend_node_exact', element_type: 'button', action_hints: ['click', 'hover'],
    known_bug_flags: [], known_bug_workarounds: [], fallback_match: null, action_outcome: null
  },
  resolver: { version: 'state-engine@1.4.2', latency_ms: 42, node_live: true, target_id: 'A1B2C3D4E5F6A7B8C9D0' },
  warnings: []
}

const RAW_BODY = JSON.stringify(REQUEST)
const OPTS = { stateEnginePort: '9110', timeoutMs: 10000 }

function mcpWrapped(envelope: unknown) {
  return { result: { content: [{ type: 'text', text: JSON.stringify(envelope) }] } }
}

describe('design-mode resolver transport (IDD-016 §5)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders the Design Mode console page with the picker script', () => {
    const html = renderDesignModePage('9110')
    expect(html).toContain('Orca Design Mode')
    expect(html).toContain('/design-mode.js')
    expect(html).toContain('9110')
  })

  it('tries MCP first and returns the unwrapped envelope', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(mcpWrapped(ENVELOPE)), { status: 200 }))
    const outcome = await forwardToResolver(REQUEST, RAW_BODY, OPTS)
    expect(outcome.transport).toBe('mcp')
    expect(outcome.response).toEqual(ENVELOPE)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:9110/mcp')
    const frame = JSON.parse(init.body as string)
    expect(frame.params.name).toBe('mcp_resolve_element')
    expect(frame.params.arguments).toEqual(REQUEST)
  })

  it('falls back to byte-identical HTTP when MCP connect fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(ENVELOPE), { status: 200 }))
    const outcome = await forwardToResolver(REQUEST, RAW_BODY, OPTS)
    expect(outcome.transport).toBe('http_fallback')
    expect(outcome.response).toEqual(ENVELOPE)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe('http://127.0.0.1:9110/api/v1/resolver/resolve')
    expect(init.body).toBe(RAW_BODY) // byte-identical (§5.2)
    expect(init.headers['X-Orca-Bridge-Version']).toBe('1.0.0')
  })

  it('treats a JSON-RPC protocol error as a transport failure (failover)', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } }), { status: 200 }))
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(ENVELOPE), { status: 200 }))
    const outcome = await forwardToResolver(REQUEST, RAW_BODY, OPTS)
    expect(outcome.transport).toBe('http_fallback')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns in-band contract errors from the HTTP fallback status path (§5.2)', async () => {
    const stale = {
      schema_version: '1.0.0', request_id: REQUEST.request_id, resolved_at: '2026-10-26T08:15:01.000Z',
      resolver: { version: 'state-engine@1.4.2', latency_ms: 12, node_live: false, target_id: 'A1B2C3D4E5F6A7B8C9D0' },
      error: { code: 'STALE_NODE', message: 'backendDOMNodeId 4821 no longer exists', retryable: false, retry_policy: 'recapture', details: {}, known_bug_flags: [] },
      warnings: []
    }
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(stale), { status: 409 }))
    const outcome = await forwardToResolver(REQUEST, RAW_BODY, OPTS)
    expect(outcome.transport).toBe('http_fallback')
    expect((outcome.response as any).error.code).toBe('STALE_NODE')
  })

  it('synthesizes RESOLVER_UNREACHABLE when both transports fail (§5.3 rule 3)', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    const outcome = await forwardToResolver(REQUEST, RAW_BODY, OPTS)
    expect(outcome.transport).toBe('unreachable')
    const env = outcome.response as any
    expect(env.error.code).toBe('RESOLVER_UNREACHABLE')
    expect(env.error.retryable).toBe(true)
    expect(env.error.retry_policy).toBe('backoff')
    expect(env.error.details.ladder_ms).toEqual([5000, 15000, 25000, 60000])
    expect(env.resolver.node_live).toBe(false)
    expect(env.request_id).toBe(REQUEST.request_id)
  })
})
