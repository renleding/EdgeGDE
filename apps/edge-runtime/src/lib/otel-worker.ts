/**
 * EdgeGDE Worker OTel Instrumentation
 *
 * Sends OTLP spans to the SigNoz collector for every request processed by the
 * EdgeGDE worker. Runs inside ctx.waitUntil() so it never blocks the response.
 *
 * Usage:
 *   import { instrumentRequest } from './lib/otel-worker'
 *
 *   export default {
 *     async fetch(request, env, ctx) {
 *       const start = performance.now()
 *       const response = await app.fetch(request, env, ctx)
 *       ctx.waitUntil(instrumentRequest(request, response, start, env))
 *       return response
 *     }
 *   }
 */

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

interface OTelEnv {
  OTEL_EXPORTER_OTLP_ENDPOINT?: string
  OTEL_SERVICE_NAME?: string
}

/**
 * Build and send an OTLP span for a single HTTP request.
 *
 * The span captures the request method, URL path, status code, and duration.
 * It is POSTed as JSON OTLP to the collector endpoint configured via
 * OTEL_EXPORTER_OTLP_ENDPOINT env var (defaults to the local SigNoz collector).
 */
export async function instrumentRequest(
  request: Request,
  response: Response,
  startMs: number,
  env: OTelEnv,
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

  // Build the OTLP JSON payload
  const payload = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: serviceName } },
            { key: 'telemetry.sdk.name', value: { stringValue: 'edgegde-otel' } },
            { key: 'telemetry.sdk.language', value: { stringValue: 'typescript' } },
            { key: 'telemetry.sdk.version', value: { stringValue: '0.1.0' } },
          ],
        },
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
                attributes: [
                  { key: 'http.method', value: { stringValue: request.method } },
                  { key: 'http.url', value: { stringValue: request.url } },
                  { key: 'http.route', value: { stringValue: url.pathname } },
                  { key: 'http.status_code', value: { intValue: response.status } },
                  { key: 'http.duration_ms', value: { doubleValue: durationMs } },
                  { key: 'http.host', value: { stringValue: url.hostname } },
                ],
                status: {
                  code: response.status >= 500 ? 2 : 0, // 2=Error, 0=Unset
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
    await fetch(`${otelEndpoint}/v1/traces`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
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
): Promise<void> {
  const otelEndpoint =
    env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318'
  const serviceName = env.OTEL_SERVICE_NAME ?? 'edgegde-worker'

  const traceId = traceIdHex()
  const spanId = spanIdHex()
  const durationMs = performance.now() - startMs
  const startTime = nowUs() - durationMs * 1000
  const endTime = nowUs()

  const payload = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: serviceName } },
            { key: 'telemetry.sdk.name', value: { stringValue: 'edgegde-otel' } },
            { key: 'telemetry.sdk.language', value: { stringValue: 'typescript' } },
            { key: 'telemetry.sdk.version', value: { stringValue: '0.1.0' } },
          ],
        },
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
                attributes: [
                  { key: 'messaging.system', value: { stringValue: 'cloudflare_queues' } },
                  { key: 'messaging.destination', value: { stringValue: queueName } },
                  { key: 'messaging.batch_size', value: { intValue: batchSize } },
                  { key: 'messaging.duration_ms', value: { doubleValue: durationMs } },
                ],
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
    await fetch(`${otelEndpoint}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    // Non-blocking
  }
}
