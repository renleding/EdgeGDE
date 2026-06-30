/**
 * EdgeGDE — OTel Worker Instrumentation Test Suite
 *
 * Covers:
 *   - instrumentRequest: HTTP span construction, domain attributes, status codes
 *   - instrumentQueue: Queue span construction, messaging attributes
 *   - instrumentLifecycleEvent: Lifecycle event span construction
 *   - postWithRetry: Retry logic, exponential backoff, silent failure
 *   - buildAttributes: Type mapping (string, int, double, bool, undefined/null)
 *   - Edge case: error paths never throw (fire-and-forget contract)
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  instrumentRequest,
  instrumentQueue,
  instrumentLifecycleEvent,
} from '../../../src/lib/otel-worker'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal mock Request suitable for instrumentRequest. */
function mockRequest(url = 'https://example.com/api/orders/42'): Request {
  return new Request(url, { method: 'GET' })
}

/** Create a minimal mock Response. */
function mockResponse(status = 200): Response {
  return new Response(null, { status })
}

/** Create a mock OTel env object. */
function mockEnv(overrides?: Partial<{
  OTEL_EXPORTER_OTLP_ENDPOINT: string
  OTEL_SERVICE_NAME: string
}>): Record<string, string | undefined> {
  return {
    OTEL_EXPORTER_OTLP_ENDPOINT: overrides?.OTEL_EXPORTER_OTLP_ENDPOINT,
    OTEL_SERVICE_NAME: overrides?.OTEL_SERVICE_NAME,
  }
}

/** The last fetch call URL and body, parsed. Extracted from mock fetch calls. */
function lastFetchCall(): { url: string; body: any } | null {
  const calls = vi.mocked(fetch).mock.calls
  if (calls.length === 0) return null
  const last = calls[calls.length - 1]
  const url = typeof last[0] === 'string' ? last[0] : (last[0] as Request).url
  const body = typeof last[1]?.body === 'string' ? JSON.parse(last[1].body) : null
  return { url, body }
}

/** Count how many times fetch was called. */
function fetchCallCount(): number {
  return vi.mocked(fetch).mock.calls.length
}

/**
 * Helper: start an instrument function, then advance fake timers step by step
 * to drain all retry backoffs so the promise resolves naturally.
 *
 * postWithRetry uses setTimeout(100ms), setTimeout(200ms) for retries.
 * We fire each pending timer exactly once and flush microtasks in between.
 */
async function runWithRetryDrain(fn: () => Promise<void>): Promise<void> {
  const promise = fn()
  // Fire up to 10 pending timers one at a time, flushing microtasks each round.
  // postWithRetry: attempt=0 → setTimeout(100) → attempt=1 → setTimeout(200) → attempt=2 (drop)
  for (let i = 0; i < 10; i++) {
    vi.advanceTimersToNextTimer()
    await Promise.resolve()
    await Promise.resolve()
  }
  await promise
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('otel-worker', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    // Default mock: fetch succeeds with 202 Accepted
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 202 }))
    vi.useFakeTimers()
    // Pin Date.now() for deterministic timestamps
    vi.setSystemTime(1_000_000_000_000) // 2001-09-09T01:46:40.000Z
    // performance.now() is automatically mocked by vi.useFakeTimers() — starts at 0
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // -----------------------------------------------------------------------
  // instrumentRequest
  // -----------------------------------------------------------------------

  describe('instrumentRequest', () => {
    it('sends POST to default OTLP endpoint with JSON content-type', async () => {
      await instrumentRequest(
        mockRequest('https://example.com/orders'),
        mockResponse(200),
        100,
        mockEnv(),
      )

      expect(fetch).toHaveBeenCalledTimes(1)
      const [url, init] = vi.mocked(fetch).mock.calls[0]
      expect(url).toBe('http://localhost:4318/v1/traces')
      expect(init!.method).toBe('POST')
      expect(init!.headers).toEqual({ 'Content-Type': 'application/json' })
    })

    it('uses custom OTLP endpoint when OTEL_EXPORTER_OTLP_ENDPOINT is set', async () => {
      await instrumentRequest(
        mockRequest(),
        mockResponse(200),
        100,
        mockEnv({ OTEL_EXPORTER_OTLP_ENDPOINT: 'https://sigNoz.myorg.com' }),
      )

      const { url } = lastFetchCall()!
      expect(url).toBe('https://sigNoz.myorg.com/v1/traces')
    })

    it('constructs a valid OTLP resourceSpans payload structure', async () => {
      await instrumentRequest(
        mockRequest('https://example.com/orders'),
        mockResponse(200),
        100,
        mockEnv(),
      )

      const { body } = lastFetchCall()!
      expect(body).toHaveProperty('resourceSpans')
      expect(body.resourceSpans).toHaveLength(1)

      const rs = body.resourceSpans[0]
      expect(rs).toHaveProperty('resource')
      expect(rs).toHaveProperty('scopeSpans')
      expect(rs.scopeSpans).toHaveLength(1)

      const ss = rs.scopeSpans[0]
      expect(ss.scope).toEqual({ name: 'edgegde-worker' })
      expect(ss.spans).toHaveLength(1)
    })

    it('sets span name to "<METHOD> <pathname>"', async () => {
      await instrumentRequest(
        mockRequest('https://example.com/api/orders/42'),
        mockResponse(200),
        100,
        mockEnv(),
      )

      const span = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0]
      expect(span.name).toBe('GET /api/orders/42')
    })

    it('sets span kind to 3 (SPAN_KIND_SERVER)', async () => {
      await instrumentRequest(
        mockRequest(),
        mockResponse(200),
        100,
        mockEnv(),
      )

      const span = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0]
      expect(span.kind).toBe(3)
      expect(span.spanKind).toBe(3)
    })

    it('generates a 32-char hex traceId and 16-char hex spanId', async () => {
      await instrumentRequest(
        mockRequest(),
        mockResponse(200),
        100,
        mockEnv(),
      )

      const span = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0]
      expect(span.traceId).toMatch(/^[0-9a-f]{32}$/)
      expect(span.spanId).toMatch(/^[0-9a-f]{16}$/)
    })

    it('sets start/end timestamps as strings in nanosecond precision', async () => {
      await instrumentRequest(
        mockRequest(),
        mockResponse(200),
        100,
        mockEnv(),
      )

      const span = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0]
      expect(typeof span.startTimeUnixNano).toBe('string')
      expect(typeof span.endTimeUnixNano).toBe('string')
      // Both should be parseable as BigInts
      expect(BigInt(span.startTimeUnixNano)).toBeGreaterThan(0n)
      expect(BigInt(span.endTimeUnixNano)).toBeGreaterThan(0n)
    })

    it('computes duration from the provided startMs', async () => {
      // performance.now() = 0 initially. Advance to set up a known baseline.
      vi.advanceTimersByTime(500)
      // Now performance.now() returns 500, so duration = 500 - 200 = 300ms
      await instrumentRequest(
        mockRequest(),
        mockResponse(200),
        200,
        mockEnv(),
      )

      const attrs = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0].attributes
      const durAttr = attrs.find((a: any) => a.key === 'http.duration_ms')
      expect(durAttr).toBeDefined()
      // 300 is an integer, so it should map to intValue, not doubleValue
      expect(durAttr.value).toEqual({ intValue: 300 })
    })

    it('includes HTTP attributes: method, url, route, status_code, host', async () => {
      await instrumentRequest(
        mockRequest('https://api.example.com/widgets?page=1'),
        mockResponse(201),
        100,
        mockEnv(),
      )

      const attrs = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0].attributes
      const keyMap = Object.fromEntries(attrs.map((a: any) => [a.key, a.value]))

      expect(keyMap['http.method']).toEqual({ stringValue: 'GET' })
      expect(keyMap['http.url']).toEqual({ stringValue: 'https://api.example.com/widgets?page=1' })
      expect(keyMap['http.route']).toEqual({ stringValue: '/widgets' })
      expect(keyMap['http.status_code']).toEqual({ intValue: 201 })
      expect(keyMap['http.host']).toEqual({ stringValue: 'api.example.com' })
      expect(keyMap['http.duration_ms']).toBeDefined()
    })

    it('sets status code to 0 for successful responses (< 500)', async () => {
      await instrumentRequest(
        mockRequest(),
        mockResponse(200),
        100,
        mockEnv(),
      )

      const span = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0]
      expect(span.status).toEqual({ code: 0 })
    })

    it('sets status code to 2 for server errors (>= 500)', async () => {
      await instrumentRequest(
        mockRequest(),
        mockResponse(500),
        100,
        mockEnv(),
      )

      const span = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0]
      expect(span.status).toEqual({ code: 2 })
    })

    it('sets status code to 2 for 502, 503, 504 as well', async () => {
      for (const status of [502, 503, 504]) {
        await instrumentRequest(
          mockRequest(),
          mockResponse(status),
          100,
          mockEnv(),
        )
        const span = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0]
        expect(span.status).toEqual({ code: 2 })
      }
    })

    it('sets client error (4xx) status to 0 (not server error)', async () => {
      await instrumentRequest(
        mockRequest(),
        mockResponse(404),
        100,
        mockEnv(),
      )

      const span = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0]
      expect(span.status).toEqual({ code: 0 })
    })

    describe('domain attribute injection', () => {
      it('injects app.correlation.id and app.tenant.id when provided', async () => {
        await instrumentRequest(
          mockRequest(),
          mockResponse(200),
          100,
          mockEnv(),
          { correlationId: 'corr-abc', tenantId: 'tenant-42' },
        )

        const attrs = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0].attributes
        const keyMap = Object.fromEntries(attrs.map((a: any) => [a.key, a.value]))
        expect(keyMap['app.correlation.id']).toEqual({ stringValue: 'corr-abc' })
        expect(keyMap['app.tenant.id']).toEqual({ stringValue: 'tenant-42' })
      })

      it('injects app.mission.id, app.action.id, and app.phase when provided', async () => {
        await instrumentRequest(
          mockRequest(),
          mockResponse(200),
          100,
          mockEnv(),
          { missionId: 'mission-x', actionId: 'action-y', phase: 'reconcile' },
        )

        const attrs = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0].attributes
        const keyMap = Object.fromEntries(attrs.map((a: any) => [a.key, a.value]))
        expect(keyMap['app.mission.id']).toEqual({ stringValue: 'mission-x' })
        expect(keyMap['app.action.id']).toEqual({ stringValue: 'action-y' })
        expect(keyMap['app.phase']).toEqual({ stringValue: 'reconcile' })
      })

      it('omits domain attributes when opts is empty', async () => {
        await instrumentRequest(
          mockRequest(),
          mockResponse(200),
          100,
          mockEnv(),
          {},
        )

        const attrs = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0].attributes
        const keyMap = Object.fromEntries(attrs.map((a: any) => [a.key, a.value]))
        expect(keyMap['app.correlation.id']).toBeUndefined()
        expect(keyMap['app.tenant.id']).toBeUndefined()
        expect(keyMap['app.mission.id']).toBeUndefined()
        expect(keyMap['app.action.id']).toBeUndefined()
        expect(keyMap['app.phase']).toBeUndefined()
      })

      it('omits individual undefined domain fields (selective injection)', async () => {
        await instrumentRequest(
          mockRequest(),
          mockResponse(200),
          100,
          mockEnv(),
          { correlationId: 'only-this', tenantId: undefined, missionId: undefined },
        )

        const attrs = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0].attributes
        const keyMap = Object.fromEntries(attrs.map((a: any) => [a.key, a.value]))
        expect(keyMap['app.correlation.id']).toEqual({ stringValue: 'only-this' })
        expect(keyMap['app.tenant.id']).toBeUndefined()
        expect(keyMap['app.mission.id']).toBeUndefined()
      })
    })

    describe('resource attributes', () => {
      it('uses default service name when OTEL_SERVICE_NAME is not set', async () => {
        await instrumentRequest(
          mockRequest(),
          mockResponse(200),
          100,
          mockEnv(),
        )

        const resourceAttrs = lastFetchCall()!.body.resourceSpans[0].resource.attributes
        const keyMap = Object.fromEntries(resourceAttrs.map((a: any) => [a.key, a.value]))
        expect(keyMap['service.name']).toEqual({ stringValue: 'edgegde-worker' })
      })

      it('uses custom service name when OTEL_SERVICE_NAME is set', async () => {
        await instrumentRequest(
          mockRequest(),
          mockResponse(200),
          100,
          mockEnv({ OTEL_SERVICE_NAME: 'my-custom-service' }),
        )

        const resourceAttrs = lastFetchCall()!.body.resourceSpans[0].resource.attributes
        const keyMap = Object.fromEntries(resourceAttrs.map((a: any) => [a.key, a.value]))
        expect(keyMap['service.name']).toEqual({ stringValue: 'my-custom-service' })
      })

      it('includes telemetry.sdk.* attributes in resource', async () => {
        await instrumentRequest(
          mockRequest(),
          mockResponse(200),
          100,
          mockEnv(),
        )

        const resourceAttrs = lastFetchCall()!.body.resourceSpans[0].resource.attributes
        const keyMap = Object.fromEntries(resourceAttrs.map((a: any) => [a.key, a.value]))
        expect(keyMap['telemetry.sdk.name']).toEqual({ stringValue: 'edgegde-otel' })
        expect(keyMap['telemetry.sdk.language']).toEqual({ stringValue: 'typescript' })
        expect(keyMap['telemetry.sdk.version']).toEqual({ stringValue: '0.1.0' })
      })

      it('sets service.namespace to tenantId when provided', async () => {
        await instrumentRequest(
          mockRequest(),
          mockResponse(200),
          100,
          mockEnv(),
          { tenantId: 'acme-corp' },
        )

        const resourceAttrs = lastFetchCall()!.body.resourceSpans[0].resource.attributes
        const keyMap = Object.fromEntries(resourceAttrs.map((a: any) => [a.key, a.value]))
        expect(keyMap['service.namespace']).toEqual({ stringValue: 'acme-corp' })
      })

      it('falls back service.namespace to "default" when no tenantId', async () => {
        await instrumentRequest(
          mockRequest(),
          mockResponse(200),
          100,
          mockEnv(),
        )

        const resourceAttrs = lastFetchCall()!.body.resourceSpans[0].resource.attributes
        const keyMap = Object.fromEntries(resourceAttrs.map((a: any) => [a.key, a.value]))
        expect(keyMap['service.namespace']).toEqual({ stringValue: 'default' })
      })
    })

    describe('POST with method other than GET', () => {
      it('handles POST requests (method attribute differs)', async () => {
        const req = new Request('https://example.com/orders', { method: 'POST' })
        await instrumentRequest(req, mockResponse(201), 100, mockEnv())

        const attrs = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0].attributes
        const keyMap = Object.fromEntries(attrs.map((a: any) => [a.key, a.value]))
        expect(keyMap['http.method']).toEqual({ stringValue: 'POST' })
      })

      it('handles PUT and DELETE methods', async () => {
        for (const method of ['PUT', 'DELETE', 'PATCH']) {
          const req = new Request('https://example.com/resource', { method })
          await instrumentRequest(req, mockResponse(200), 100, mockEnv())

          const attrs = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0].attributes
          const keyMap = Object.fromEntries(attrs.map((a: any) => [a.key, a.value]))
          expect(keyMap['http.method']).toEqual({ stringValue: method })
        }
      })
    })

    describe('error handling — fire-and-forget contract', () => {
      it('never throws when fetch rejects (network error)', async () => {
        vi.mocked(fetch).mockRejectedValue(new Error('Network failure'))

        await runWithRetryDrain(() =>
          instrumentRequest(mockRequest(), mockResponse(200), 100, mockEnv()),
        )
      })

      it('never throws when fetch returns non-2xx', async () => {
        vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 500 }))

        await runWithRetryDrain(() =>
          instrumentRequest(mockRequest(), mockResponse(200), 100, mockEnv()),
        )
      })

      it('never throws when env is missing (undefined endpoint)', async () => {
        // No setTimeout involved — fetch mock returns 202, so this resolves immediately
        await expect(
          instrumentRequest(mockRequest(), mockResponse(200), 100, {}),
        ).resolves.toBeUndefined()
      })
    })
  })

  // -----------------------------------------------------------------------
  // instrumentQueue
  // -----------------------------------------------------------------------

  describe('instrumentQueue', () => {
    it('sends POST to default OTLP endpoint with queue span payload', async () => {
      await instrumentQueue('order-processing', 10, 100, mockEnv())

      expect(fetch).toHaveBeenCalledTimes(1)
      const { url, body } = lastFetchCall()!
      expect(url).toBe('http://localhost:4318/v1/traces')
      expect(body.resourceSpans[0].scopeSpans[0].spans[0]).toBeDefined()
    })

    it('sets span name to "queue <queueName>"', async () => {
      await instrumentQueue('order-processing', 10, 100, mockEnv())

      const span = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0]
      expect(span.name).toBe('queue order-processing')
    })

    it('sets span kind to 1 (SPAN_KIND_INTERNAL)', async () => {
      await instrumentQueue('orders', 5, 100, mockEnv())

      const span = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0]
      expect(span.kind).toBe(1)
      expect(span.spanKind).toBe(1)
    })

    it('includes messaging.* attributes', async () => {
      await instrumentQueue('email-queue', 25, 100, mockEnv())

      const attrs = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0].attributes
      const keyMap = Object.fromEntries(attrs.map((a: any) => [a.key, a.value]))
      expect(keyMap['messaging.system']).toEqual({ stringValue: 'cloudflare_queues' })
      expect(keyMap['messaging.destination']).toEqual({ stringValue: 'email-queue' })
      expect(keyMap['messaging.batch_size']).toEqual({ intValue: 25 })
      expect(keyMap['messaging.duration_ms']).toBeDefined()
    })

    it('injects domain attributes into queue span', async () => {
      await instrumentQueue('orders', 3, 100, mockEnv(), {
        correlationId: 'corr-q',
        tenantId: 'tenant-q',
        missionId: 'mission-q',
      })

      const attrs = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0].attributes
      const keyMap = Object.fromEntries(attrs.map((a: any) => [a.key, a.value]))
      expect(keyMap['app.correlation.id']).toEqual({ stringValue: 'corr-q' })
      expect(keyMap['app.tenant.id']).toEqual({ stringValue: 'tenant-q' })
      expect(keyMap['app.mission.id']).toEqual({ stringValue: 'mission-q' })
    })

    it('omits messaging metric attributes when undef (no phantom fields)', async () => {
      await instrumentQueue('no-domain', 0, 100, mockEnv())

      const attrs = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0].attributes
      const keys = attrs.map((a: any) => a.key)
      // No app.* fields should be present when opts is empty
      expect(keys.filter((k: string) => k.startsWith('app.'))).toHaveLength(0)
    })

    it('sets status to code 0 always', async () => {
      await instrumentQueue('sys', 1, 100, mockEnv())

      const span = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0]
      expect(span.status).toEqual({ code: 0 })
    })

    it('never throws on network error', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Queue collector down'))

      await runWithRetryDrain(() =>
        instrumentQueue('orders', 5, 100, mockEnv()),
      )
    })
  })

  // -----------------------------------------------------------------------
  // instrumentLifecycleEvent
  // -----------------------------------------------------------------------

  describe('instrumentLifecycleEvent', () => {
    it('sends POST to default OTLP endpoint with lifecycle event payload', async () => {
      await instrumentLifecycleEvent('reconcile.start', { 'app.phase': 'reconcile' }, mockEnv())

      expect(fetch).toHaveBeenCalledTimes(1)
      const { url } = lastFetchCall()!
      expect(url).toBe('http://localhost:4318/v1/traces')
    })

    it('sets span name to the event name', async () => {
      await instrumentLifecycleEvent('compensate.order-42', { 'app.phase': 'compensate' }, mockEnv())

      const span = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0]
      expect(span.name).toBe('compensate.order-42')
    })

    it('sets span kind to 2 (SPAN_KIND_INTERNAL)', async () => {
      await instrumentLifecycleEvent('mission.check', {}, mockEnv())

      const span = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0]
      expect(span.kind).toBe(2)
      expect(span.spanKind).toBe(2)
    })

    it('sets start and end time to the same timestamp (instant event)', async () => {
      await instrumentLifecycleEvent('event', {}, mockEnv())

      const span = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0]
      expect(span.startTimeUnixNano).toBe(span.endTimeUnixNano)
    })

    it('includes all provided attributes in the span', async () => {
      await instrumentLifecycleEvent(
        'drift.check',
        {
          'app.correlation.id': 'corr-lc',
          'app.tenant.id': 'tenant-lc',
          'app.phase': 'drift',
          'drift.baseline': 42,
          'drift.current': 38.5,
          'drift.violation': true,
        },
        mockEnv(),
      )

      const attrs = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0].attributes
      const keyMap = Object.fromEntries(attrs.map((a: any) => [a.key, a.value]))
      expect(keyMap['app.correlation.id']).toEqual({ stringValue: 'corr-lc' })
      expect(keyMap['app.tenant.id']).toEqual({ stringValue: 'tenant-lc' })
      expect(keyMap['app.phase']).toEqual({ stringValue: 'drift' })
      expect(keyMap['drift.baseline']).toEqual({ intValue: 42 })
      expect(keyMap['drift.current']).toEqual({ doubleValue: 38.5 })
      expect(keyMap['drift.violation']).toEqual({ boolValue: true })
    })

    it('strips undefined attribute values', async () => {
      await instrumentLifecycleEvent(
        'event',
        { 'app.defined': 'yes', 'app.undef': undefined },
        mockEnv(),
      )

      const attrs = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0].attributes
      const keys = attrs.map((a: any) => a.key)
      expect(keys).toContain('app.defined')
      expect(keys).not.toContain('app.undef')
    })

    it('sets status to code 0 always', async () => {
      await instrumentLifecycleEvent('any.event', {}, mockEnv())

      const span = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0]
      expect(span.status).toEqual({ code: 0 })
    })

    it('never throws on network error', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Collector unreachable'))

      await runWithRetryDrain(() =>
        instrumentLifecycleEvent('reconcile', {}, mockEnv()),
      )
    })

    it('uses custom service name when set in env', async () => {
      await instrumentLifecycleEvent('event', {}, mockEnv({ OTEL_SERVICE_NAME: 'lifecycle-service' }))

      const resourceAttrs = lastFetchCall()!.body.resourceSpans[0].resource.attributes
      const keyMap = Object.fromEntries(resourceAttrs.map((a: any) => [a.key, a.value]))
      expect(keyMap['service.name']).toEqual({ stringValue: 'lifecycle-service' })
    })
  })

  // -----------------------------------------------------------------------
  // postWithRetry — tested indirectly through instrumentRequest
  // -----------------------------------------------------------------------

  describe('postWithRetry (indirect via instrumentRequest)', () => {
    it('retries when collector returns non-2xx', async () => {
      // First 2 calls return 503, third succeeds
      vi.mocked(fetch)
        .mockResolvedValueOnce(new Response(null, { status: 503 }))
        .mockResolvedValueOnce(new Response(null, { status: 503 }))
        .mockResolvedValueOnce(new Response(null, { status: 202 }))

      await runWithRetryDrain(() =>
        instrumentRequest(mockRequest(), mockResponse(200), 100, mockEnv()),
      )

      // Should have made 3 calls: original + 2 retries = 3 total
      // Call 1: 503 → retry(100ms) → Call 2: 503 → retry(200ms) → Call 3: 202 ✓
      expect(fetch).toHaveBeenCalledTimes(3)
    })

    it('silently drops after exhausting all retries', async () => {
      // All 3 attempts return 503
      vi.mocked(fetch)
        .mockResolvedValueOnce(new Response(null, { status: 503 }))
        .mockResolvedValueOnce(new Response(null, { status: 503 }))
        .mockResolvedValueOnce(new Response(null, { status: 503 }))

      await runWithRetryDrain(() =>
        instrumentRequest(mockRequest(), mockResponse(200), 100, mockEnv()),
      )

      // 3 attempts total (initial + 2 retries), then silent drop
      expect(fetch).toHaveBeenCalledTimes(3)
    })

    it('retries on network error and succeeds on retry', async () => {
      // First call rejects, second succeeds
      vi.mocked(fetch)
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce(new Response(null, { status: 202 }))

      await runWithRetryDrain(() =>
        instrumentRequest(mockRequest(), mockResponse(200), 100, mockEnv()),
      )

      // 2 calls total: original (reject) + retry (202)
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('retries up to 3 times on persistent network errors then drops silently', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network unreachable'))

      await runWithRetryDrain(() =>
        instrumentRequest(mockRequest(), mockResponse(200), 100, mockEnv()),
      )

      // 3 attempts max (initial + 2 retries)
      expect(fetch).toHaveBeenCalledTimes(3)
    })

    it('succeeds immediately with no retries on first try', async () => {
      vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 202 }))

      await instrumentRequest(mockRequest(), mockResponse(200), 100, mockEnv())

      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('does not retry non-2xx responses beyond maxAttempts', async () => {
      // maxAttempts=3 means 3 total calls max
      vi.mocked(fetch)
        .mockResolvedValueOnce(new Response(null, { status: 503 }))
        .mockResolvedValueOnce(new Response(null, { status: 503 }))
        .mockResolvedValueOnce(new Response(null, { status: 503 }))

      await runWithRetryDrain(() =>
        instrumentRequest(mockRequest(), mockResponse(200), 100, mockEnv()),
      )

      // Exactly 3 calls (maxAttempts=3)
      expect(fetch).toHaveBeenCalledTimes(3)
    })
  })

  // -----------------------------------------------------------------------
  // Integration: all instrument functions coexist without cross-contamination
  // -----------------------------------------------------------------------

  describe('cross-function isolation', () => {
    it('allows sequential calls to different instrument functions', async () => {
      await instrumentRequest(mockRequest(), mockResponse(200), 100, mockEnv(), {
        correlationId: 'req-1',
      })
      await instrumentQueue('tasks', 3, 200, mockEnv(), { correlationId: 'q-1' })
      await instrumentLifecycleEvent('reconcile', { 'app.phase': 'reconcile' }, mockEnv())

      expect(fetch).toHaveBeenCalledTimes(3)
      const requests = vi.mocked(fetch).mock.calls.map(([url, init]) => ({
        url,
        body: JSON.parse(typeof init?.body === 'string' ? init.body : '{}'),
      }))

      // Each call is independent with its own unique traceId/spanId
      const traceIds = requests.map((r) => r.body.resourceSpans[0].scopeSpans[0].spans[0].traceId)
      expect(new Set(traceIds).size).toBe(3) // All unique
    })
  })

  // -----------------------------------------------------------------------
  // buildAttributes — type mapping via observable behavior
  // -----------------------------------------------------------------------

  describe('buildAttributes type mapping (observed via instrumentLifecycleEvent)', () => {
    it('maps string values to stringValue', async () => {
      await instrumentLifecycleEvent('t', { key: 'hello' }, mockEnv())

      const attrs = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0].attributes
      expect(attrs).toContainEqual({ key: 'key', value: { stringValue: 'hello' } })
    })

    it('maps integer values to intValue', async () => {
      await instrumentLifecycleEvent('t', { count: 42 }, mockEnv())

      const attrs = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0].attributes
      expect(attrs).toContainEqual({ key: 'count', value: { intValue: 42 } })
    })

    it('maps float values to doubleValue', async () => {
      await instrumentLifecycleEvent('t', { ratio: 3.14 }, mockEnv())

      const attrs = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0].attributes
      expect(attrs).toContainEqual({ key: 'ratio', value: { doubleValue: 3.14 } })
    })

    it('maps boolean values to boolValue', async () => {
      await instrumentLifecycleEvent('t', { flag: true }, mockEnv())

      const attrs = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0].attributes
      expect(attrs).toContainEqual({ key: 'flag', value: { boolValue: true } })
    })

    it('omits null values', async () => {
      await instrumentLifecycleEvent('t', { a: 'present', b: null as any }, mockEnv())

      const attrs = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0].attributes
      const keys = attrs.map((a: any) => a.key)
      expect(keys).toContain('a')
      expect(keys).not.toContain('b')
    })

    it('maps integer 0 correctly (falsy but present)', async () => {
      await instrumentLifecycleEvent('t', { zero: 0 }, mockEnv())

      const attrs = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0].attributes
      expect(attrs).toContainEqual({ key: 'zero', value: { intValue: 0 } })
    })

    it('maps boolean false correctly (falsy but present)', async () => {
      await instrumentLifecycleEvent('t', { flag: false }, mockEnv())

      const attrs = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0].attributes
      expect(attrs).toContainEqual({ key: 'flag', value: { boolValue: false } })
    })

    it('maps empty string correctly (falsy but present)', async () => {
      await instrumentLifecycleEvent('t', { empty: '' }, mockEnv())

      const attrs = lastFetchCall()!.body.resourceSpans[0].scopeSpans[0].spans[0].attributes
      expect(attrs).toContainEqual({ key: 'empty', value: { stringValue: '' } })
    })
  })
})
