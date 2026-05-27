/**
 * EdgeGDE Runtime — Webhook Dispatcher
 * Track 4 Phase 1: Outbound webhook integration after successful D1 persistence.
 *
 * Fire-and-forget, non-blocking, no retry (v1).
 * Supports optional HMAC-SHA256 signature for payload verification.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface WebhookConfig {
  url: string
  enabled: boolean
  secret?: string
}

export interface WebhookPayload {
  tenantId: string
  formId: string
  submissionId: string
  timestamp: string
  fields: Record<string, unknown>
  metadata: {
    source: string
    version: number
    correlationId?: string
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HMAC-SHA256 Signature
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute HMAC-SHA256 signature for a payload string.
 * Uses the Web Crypto API (available in Workers via crypto.subtle).
 */
async function computeSignature(
  payloadStr: string,
  secret: string,
): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadStr))
  const hex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return hex
}

// ═══════════════════════════════════════════════════════════════════════════
// Dispatch
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Dispatch a webhook for a form submission.
 * Loads config from TENANT_KV, signs if secret configured, POSTs async.
 *
 * Must be called within c.executionCtx.waitUntil()
 *
 * @returns true if webhook was dispatched, false if skipped/no config
 */
export async function dispatchWebhook(
  TENANT_KV: any,
  payload: WebhookPayload,
): Promise<boolean> {
  // 1. Load webhook config
  let config: WebhookConfig | null
  try {
    config = await TENANT_KV.get(`tenant:${payload.tenantId}:webhook`, 'json')
  } catch {
    return false
  }

  if (!config || !config.enabled || !config.url) {
    return false
  }

  // 2. Build payload string
  const payloadStr = JSON.stringify(payload)

  // 3. Build headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'EdgeGDE-Webhook/1.0',
  }

  // 4. Optional HMAC signature
  if (config.secret) {
    try {
      const signature = await computeSignature(payloadStr, config.secret)
      headers['X-Signature'] = signature
    } catch {
      // Signature failure — still send unsigned
    }
  }

  // 5. Dispatch (fire-and-forget, no retry in v1)
  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers,
      body: payloadStr,
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      console.log(JSON.stringify({
        event: 'webhook_dispatch',
        tenantId: payload.tenantId,
        submissionId: payload.submissionId,
        success: false,
        statusCode: response.status,
        timestamp: Date.now(),
      }))
      return false
    }

    console.log(JSON.stringify({
      event: 'webhook_dispatch',
      tenantId: payload.tenantId,
      submissionId: payload.submissionId,
      success: true,
      timestamp: Date.now(),
    }))
    return true
  } catch (err: any) {
    console.log(JSON.stringify({
      event: 'webhook_dispatch',
      tenantId: payload.tenantId,
      submissionId: payload.submissionId,
      success: false,
      error: err.message,
      timestamp: Date.now(),
    }))
    return false
  }
}
