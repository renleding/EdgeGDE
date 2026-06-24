/**
 * EdgeGDE Worker OTel Instrumentation
 *
 * Sends OTLP spans to the SigNoz collector for every request processed by the
 * EdgeGDE worker. Runs inside ctx.waitUntil() so it never blocks the response.
 *
 * Retry: up to 3 attempts with exponential backoff (100ms, 200ms, 400ms) so a
 * brief collector restart doesn't lose traces. Spans that fail all retries are
 * silently dropped — telemetry never blocks execution.
 *
 * Domain attributes (correlationId, tenantId, missionId, actionId) are injected
 * as flat OTel attributes (app.*) to enable tenant-level and mission-level
 * traceability in SigNoz.
 *
 * Usage:
 *   import { instrumentRequest } from './lib/otel-worker'
 *
 *   export default {
 *     async fetch(request, env, ctx) {
 *       const start = performance.now()
 *       const response = await app.fetch(request, env, ctx)
 *       ctx.waitUntil(instrumentRequest(request, response, start, env, {
 *         correlationId: c.var.correlationId,
 *         tenantId: c.var.tenantId,
 *       }))
 *       return response
 *     }
 *   }
 */

interface DomainOptions {
  correlationId?: string
  tenantId?: string
  missionId?: string
  actionId?: string
  phase?: string
}

interface OTelEnv {
  OTEL_EXPORTER_OTLP_ENDPOINT?: string
  OTEL_SERVICE_NAME?: string
}

/**
 * POST an OTLP payload to the collector with retry.
 * Retries up to 3 times with exponential backoff (100ms, 200ms, 400ms).
 * All failures are silently dropped — telemetry never blocks execution.
 */
async function postWithRetry(
  url: string,
  body: string,
  attempt: number = 0,
): Promise<void> {
  const maxAttempts = 3
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    if (!res.ok && attempt < maxAttempts - 1) {
      // Non-2xx: retry with backoff (e.g., collector restarting)
      const delay = 100 * Math.pow(2, attempt)
      await new Promise((r) => setTimeout(r, delay))
      return postWithRetry(url, body, attempt + 1)
    }
  } catch {
    if (attempt < maxAttempts - 1) {
      // Network error: retry with backoff
      const delay = 100 * Math.pow(2, attempt)
      await new Promise((r) => setTimeout(r, delay))
      return postWithRetry(url, body, attempt + 1)
    }
    // All retries exhausted — silently drop
  }
}

/** Generate a random 16-byte hex trace ID. */
function traceIdHex(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Generate a random 8-byte hex span ID. */
function spanIdHex(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Unix timestamp in microseconds (the OTLP wire format). */
function nowUs(): number {
  return Date.now() * 1000
}

/**
 * Build the OTLP attributes array from flat key-value pairs.
 * Strips undefined values so empty domain fields don't pollute ClickHouse.
 */
function buildAttributes(
  pairs: Record<string, string | number | boolean | undefined>,
): Array<{ key: string; value: { stringValue?: string; intValue?: number; doubleValue?: number; boolValue?: boolean } }> {
  const attrs: Array<any> = []
  for (const [key, val] of Object.entries(pairs)) {
    if (val === undefined || val === null) continue
    if (typeof val === 'string') {
      attrs.push({ key, value: { stringValue: val } })
    } else if (typeof val === 'number') {
      if (Number.isInteger(val)) {
        attrs.push({ key, value: { intValue: val } })
      } else {
        attrs.push({ key, value: { doubleValue: val } })
      }
    } else if (typeof val === 'boolean') {
      attrs.push({ key, value: { boolValue: val } })
    }
  }
  return attrs
}

/**
 * Build and send an OTLP span for a single HTTP request.
 *
 * Accepts optional domain identifiers (correlationId, tenantId, etc.) that are
 * injected as flat app.* attributes for tenant-level and mission-level
 * traceability in SigNoz.
 */
export async function instrumentRequest(
  request: Request,
  response: Response,
  startMs: number,
  env: OTelEnv,
  opts: DomainOptions = {},
): Promise<void> {
  const otelEndpoint =
    env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318'
  const serviceName = env.OTEL_SERVICE_NAME ?? 'edgegde-worker'

  const traceId = traceIdHex()
  const spanId = spanIdHex()
  const durationMs = performance.now() - startMs
  const startTime = nowUs() - durationMs * 1000
  const endTime = nowUs()
  const url = new URL(request.url)

  const httpAttrs = buildAttributes({
    'http.method': request.method,
    'http.url': request.url,
    'http.route': url.pathname,
    'http.status_code': response.status,
    'http.duration_ms': durationMs,
    'http.host': url.hostname,
    // --- EdgeGDE domain attributes ---
    'app.correlation.id': opts.correlationId,
    'app.tenant.id': opts.tenantId,
    'app.mission.id': opts.missionId,
    'app.action.id': opts.actionId,
    'app.phase': opts.phase,
  })

  const resourceAttrs = buildAttributes({
    'service.name': serviceName,
    'telemetry.sdk.name': 'edgegde-otel',
    'telemetry.sdk.language': 'typescript',
    'telemetry.sdk.version': '0.1.0',
    'service.namespace': opts.tenantId || 'default',
  })

  const payload = {
    resourceSpans: [
      {
        resource: { attributes: resourceAttrs },
        scopeSpans: [
          {
            scope: { name: 'edgegde-worker' },
            spans: [
              {
                traceId,
                spanId,
                name: `${request.method} ${url.pathname}`,
                kind: 3, // SPAN_KIND_SERVER
                startTimeUnixNano: String(startTime * 1000),
                endTimeUnixNano: String(endTime * 1000),
                attributes: httpAttrs,
                status: {
                  code: response.status >= 500 ? 2 : 0,
                },
                spanKind: 3,
              },
            ],
          },
        ],
      },
    ],
  }

  try {
    await postWithRetry(`${otelEndpoint}/v1/traces`, JSON.stringify(payload))
  } catch {
    // Non-blocking: OTel export failures must never break the request
  }
}

/**
 * OTel envelope for queue handler spans.
 */
export async function instrumentQueue(
  queueName: string,
  batchSize: number,
  startMs: number,
  env: OTelEnv,
  opts: DomainOptions = {},
): Promise<void> {
  const otelEndpoint =
    env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318'
  const serviceName = env.OTEL_SERVICE_NAME ?? 'edgegde-worker'

  const traceId = traceIdHex()
  const spanId = spanIdHex()
  const durationMs = performance.now() - startMs
  const startTime = nowUs() - durationMs * 1000
  const endTime = nowUs()

  const attrs = buildAttributes({
    'messaging.system': 'cloudflare_queues',
    'messaging.destination': queueName,
    'messaging.batch_size': batchSize,
    'messaging.duration_ms': durationMs,
    'app.correlation.id': opts.correlationId,
    'app.tenant.id': opts.tenantId,
    'app.mission.id': opts.missionId,
    'app.action.id': opts.actionId,
    'app.phase': opts.phase,
  })

  const resourceAttrs = buildAttributes({
    'service.name': serviceName,
    'telemetry.sdk.name': 'edgegde-otel',
    'telemetry.sdk.language': 'typescript',
    'telemetry.sdk.version': '0.1.0',
    'service.namespace': opts.tenantId || 'default',
  })

  const payload = {
    resourceSpans: [
      {
        resource: { attributes: resourceAttrs },
        scopeSpans: [
          {
            scope: { name: 'edgegde-worker' },
            spans: [
              {
                traceId,
                spanId,
                name: `queue ${queueName}`,
                kind: 1, // SPAN_KIND_INTERNAL
                startTimeUnixNano: String(startTime * 1000),
                endTimeUnixNano: String(endTime * 1000),
                attributes: attrs,
                status: { code: 0 },
                spanKind: 1,
              },
            ],
          },
        ],
      },
    ],
  }

  try {
    await postWithRetry(`${otelEndpoint}/v1/traces`, JSON.stringify(payload))
  } catch {
    // Non-blocking
  }
}
