/**
 * EdgeGDE Runtime — Async Structured Telemetry
 * HSAES Phase 20: Non-blocking event logging via waitUntil().
 *
 * Logs structured telemetry events to KV (or MemoryKvStore for local dev).
 * Uses ctx.waitUntil() to never block the request response.
 *
 * @packageDocumentation
 */

import { kv } from '../index'

// ═══════════════════════════════════════════════════════════════════════════
// Telemetry Event Schema
// ═══════════════════════════════════════════════════════════════════════════

export interface TelemetryEvent {
  timestamp: string
  host: string
  requestId: string
  path: string
  method: string
  statusCode: number
  durationMs: number
  eventType: string
  data?: Record<string, unknown>
}

// ═══════════════════════════════════════════════════════════════════════════
// Generate a simple request ID
// ═══════════════════════════════════════════════════════════════════════════

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

// ═══════════════════════════════════════════════════════════════════════════
// logEvent — Non-blocking structured telemetry
// ═══════════════════════════════════════════════════════════════════════════

export function logEvent(
  c: any,
  eventType: string,
  data?: Record<string, unknown>,
): void {
  const now = new Date()
  const timestamp = now.toISOString()
  const host = new URL(c.req.url).hostname
  const requestId = generateRequestId()
  const path = new URL(c.req.url).pathname
  const method = c.req.method
  const statusCode = c.res?.status ?? 200

  // Calculate duration from execution context if available
  let durationMs = 0
  if (c.var?.startTime) {
    durationMs = now.getTime() - (c.var.startTime as number)
  }

  const event: TelemetryEvent = {
    timestamp,
    host,
    requestId,
    path,
    method,
    statusCode,
    durationMs,
    eventType,
    data,
  }

  // Get tenantId from context if available
  const tenantConfig = c.get?.('tenantConfig') as { hostname?: string } | undefined
  const tenantId = tenantConfig?.hostname ?? 'unknown'

  // Build KV key
  const key = `log:${tenantId}:${timestamp}:${requestId}`

  // Use waitUntil to never block the request
  const ctx = c.executionCtx as { waitUntil: (p: Promise<unknown>) => void }
  if (ctx?.waitUntil) {
    ctx.waitUntil(writeLog(key, JSON.stringify(event), c.env))
  } else {
    // Fallback: fire and forget (no execution context available)
    writeLog(key, JSON.stringify(event), c.env).catch(() => {
      /* dev — silent */
    })
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// writeLog — Persist telemetry event to KV or MemoryKvStore
// ═══════════════════════════════════════════════════════════════════════════

async function writeLog(
  key: string,
  value: string,
  env: any,
): Promise<void> {
  // Try production TELEMETRY_KV first
  const telemetryKv = env?.TELEMETRY_KV
  if (telemetryKv && typeof telemetryKv.put === 'function') {
    await telemetryKv.put(key, value)
    return
  }

  // Fall back to local MemoryKvStore
  await kv.put(key, value)
}
