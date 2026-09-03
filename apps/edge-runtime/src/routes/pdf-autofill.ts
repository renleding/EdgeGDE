/**
 * EdgeGDE Runtime — PDF Form Filler Endpoints
 * FRS-0005: EdgeGDE PDF Form Filler
 *
 * Proxy requests to the local PDF actuator sidecar (apps/pdf-sidecar).
 * Sidecar runs on Tailscale mesh at PDF_SIDECAR_URL (default http://127.0.0.1:8890).
 *
 * Endpoints:
 *   POST /api/v1/pdf/autofill        — Single-PDF fill
 *   POST /api/v1/pdf/autofill-bundle — Multi-PDF bundle fill (Q2)
 *   GET  /api/v1/pdf/health          — Sidecar health check
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import { envFromContext } from '../lib/env'
import { z } from 'zod'
import { validateOrThrow } from '../lib/schemas'

// ═══════════════════════════════════════════════════════════════════════════
// Schemas
// ═══════════════════════════════════════════════════════════════════════════

const RiskClassSchema = z.enum([
  'financial',
  'government',
  'legal',
  'subscription',
  'marketing',
  'low',
])

const AutofillMetadataSchema = z.object({
  user_data: z.record(z.string(), z.string()),
  risk_class: RiskClassSchema,
  tenant: z.string().min(1).max(128),
  callback_url: z.string().url().optional(),
  idempotency_key: z.string().uuid().optional(),
})

// ═══════════════════════════════════════════════════════════════════════════
// Sidecar config
// ═══════════════════════════════════════════════════════════════════════════

const SIDECAR_TIMEOUT_MS = 60_000   // Per the FRS: AcroForm ≤ 5s text-only, flattened ≤ 60s
const CIRCUIT_BREAKER_THRESHOLD = 3 // Consecutive 5xx before opening
const CIRCUIT_BREAKER_RESET_MS = 30_000

interface CircuitState {
  failures: number
  openedAt: number
}

const circuit: CircuitState = { failures: 0, openedAt: 0 }

function isCircuitOpen(): boolean {
  if (circuit.failures < CIRCUIT_BREAKER_THRESHOLD) return false
  const since = Date.now() - circuit.openedAt
  if (since > CIRCUIT_BREAKER_RESET_MS) {
    // Half-open: reset
    circuit.failures = 0
    circuit.openedAt = 0
    return false
  }
  return true
}

function recordSidecarFailure(): void {
  circuit.failures += 1
  if (circuit.failures >= CIRCUIT_BREAKER_THRESHOLD && circuit.openedAt === 0) {
    circuit.openedAt = Date.now()
  }
}

function recordSidecarSuccess(): void {
  circuit.failures = 0
  circuit.openedAt = 0
}

function sidecarUrl(c: any): string {
  const env = envFromContext(c)
  return (env as any).PDF_SIDECAR_URL || 'http://127.0.0.1:8890'
}

// Coerce multipart form fields to strings (may be File or string)
function optStr(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v === 'string') return v
  return String(v)
}

// ═══════════════════════════════════════════════════════════════════════════
// Router
// ═══════════════════════════════════════════════════════════════════════════

export const pdfAutofillRouter = new Hono()

// ── GET /pdf/health — proxy sidecar health ─────────────────────────────

pdfAutofillRouter.get('/pdf/health', async (c) => {
  if (isCircuitOpen()) {
    return c.json(
      { error: 'circuit_open', message: 'PDF sidecar unavailable, retry shortly' },
      503
    )
  }
  try {
    const resp = await fetch(`${sidecarUrl(c)}/health`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!resp.ok) {
      recordSidecarFailure()
      return c.json({ error: 'sidecar_unhealthy', status: resp.status }, 502)
    }
    recordSidecarSuccess()
    const body = await resp.json() as Record<string, unknown>
    return c.json({ edge_runtime: 'ok', sidecar: body, circuit_failures: circuit.failures })
  } catch (err) {
    recordSidecarFailure()
    return c.json(
      { error: 'sidecar_unreachable', message: (err as Error).message },
      502
    )
  }
})

// ── POST /pdf/autofill — single-PDF fill ──────────────────────────────

pdfAutofillRouter.post('/pdf/autofill', async (c) => {
  if (isCircuitOpen()) {
    return c.json(
      { error: 'circuit_open', message: 'PDF sidecar unavailable, retry shortly' },
      503
    )
  }

  // 1. Parse multipart form: pdf + user_data (JSON string) + risk_class + tenant
  const form = await c.req.parseBody()
  const pdf = form.pdf
  if (!(pdf instanceof File)) {
    return c.json({ error: 'missing_pdf', message: 'Field "pdf" is required and must be a file' }, 400)
  }
  if (pdf.size > 50 * 1024 * 1024) {
    return c.json({ error: 'pdf_too_large', message: 'PDF exceeds 50MB limit' }, 413)
  }

  // 2. Validate metadata
  const rawUserData = form.user_data
  const userDataStr = typeof rawUserData === 'string' ? rawUserData : JSON.stringify(rawUserData ?? {})
  let userData: Record<string, string>
  let riskClass: string
  let tenant: string
  let callbackUrl: string | undefined
  let idempotencyKey: string | undefined
  try {
    const parsedUserData = JSON.parse(userDataStr)
    if (typeof parsedUserData !== 'object' || Array.isArray(parsedUserData)) {
      throw new Error('user_data must be a JSON object')
    }
    // Coerce all values to strings (PDF form fields are always strings)
    const stringified: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsedUserData)) {
      stringified[k] = v === null || v === undefined ? '' : String(v)
    }
    const meta = validateOrThrow(
      AutofillMetadataSchema,
      {
        user_data: stringified,
        risk_class: optStr(form.risk_class) ?? 'low',
        tenant: optStr(form.tenant) ?? '',
        callback_url: optStr(form.callback_url),
        idempotency_key: optStr(form.idempotency_key),
      }
    )
    userData = meta.user_data
    riskClass = meta.risk_class
    tenant = meta.tenant
    callbackUrl = meta.callback_url
    idempotencyKey = meta.idempotency_key
  } catch (err) {
    if (err && typeof err === 'object' && 'issues' in err) {
      return c.json({ error: 'validation_failed', issues: (err as { issues: unknown }).issues }, 400)
    }
    return c.json({ error: 'invalid_metadata', message: (err as Error).message }, 400)
  }

  // 3. Build forwarded multipart to sidecar
  const sidecarForm = new FormData()
  sidecarForm.append('pdf', pdf, pdf.name || 'input.pdf')
  sidecarForm.append('user_data', JSON.stringify(userData))
  sidecarForm.append('risk_class', riskClass)
  sidecarForm.append('tenant', tenant)
  if (callbackUrl) sidecarForm.append('callback_url', callbackUrl)
  if (idempotencyKey) sidecarForm.append('idempotency_key', idempotencyKey)

  // 4. Forward
  const t0 = Date.now()
  try {
    const resp = await fetch(`${sidecarUrl(c)}/autofill`, {
      method: 'POST',
      body: sidecarForm,
      signal: AbortSignal.timeout(SIDECAR_TIMEOUT_MS),
    })
    if (!resp.ok) {
      recordSidecarFailure()
      const text = await resp.text()
      return c.json(
        { error: 'sidecar_error', status: resp.status, body: text.slice(0, 1000) },
        502
      )
    }
    recordSidecarSuccess()
    const body = await resp.json() as Record<string, unknown>
    return c.json({
      ...body,
      _edge_runtime: { duration_ms: Date.now() - t0, tenant, risk_class: riskClass },
    })
  } catch (err) {
    recordSidecarFailure()
    return c.json(
      { error: 'sidecar_timeout', message: (err as Error).message, duration_ms: Date.now() - t0 },
      504
    )
  }
})

// ── POST /pdf/autofill-bundle — multi-PDF fill (Q2) ───────────────────

const AutofillBundleMetadataSchema = z.object({
  user_data: z.record(z.string(), z.string()),
  risk_class: RiskClassSchema,
  tenant: z.string().min(1).max(128),
  callback_url: z.string().url().optional(),
  idempotency_key: z.string().uuid().optional(),
})

pdfAutofillRouter.post('/pdf/autofill-bundle', async (c) => {
  if (isCircuitOpen()) {
    return c.json(
      { error: 'circuit_open', message: 'PDF sidecar unavailable, retry shortly' },
      503
    )
  }

  const form = await c.req.parseBody()
  // pdfs is a multi-file field; cf-hono exposes it as an array of File
  const rawPdfs = form.pdfs
  const pdfs: File[] = []
  if (Array.isArray(rawPdfs)) {
    for (const p of rawPdfs) {
      if (p instanceof File) pdfs.push(p)
    }
  } else if (rawPdfs instanceof File) {
    pdfs.push(rawPdfs)
  }
  if (pdfs.length === 0) {
    return c.json({ error: 'missing_pdfs', message: 'Field "pdfs" must be 1-5 files' }, 400)
  }
  if (pdfs.length > 5) {
    return c.json({ error: 'too_many_pdfs', message: 'pdf_set max is 5 PDFs' }, 400)
  }
  for (const p of pdfs) {
    if (p.size > 50 * 1024 * 1024) {
      return c.json({ error: 'pdf_too_large', message: `${p.name} exceeds 50MB` }, 413)
    }
  }

  let meta: z.infer<typeof AutofillBundleMetadataSchema>
  try {
    const rawUd = form.user_data
    const userData = JSON.parse(typeof rawUd === 'string' ? rawUd : JSON.stringify(rawUd ?? {}))
    if (typeof userData !== 'object' || Array.isArray(userData)) {
      throw new Error('user_data must be a JSON object')
    }
    const stringified: Record<string, string> = {}
    for (const [k, v] of Object.entries(userData)) {
      stringified[k] = v === null || v === undefined ? '' : String(v)
    }
    meta = validateOrThrow(AutofillBundleMetadataSchema, {
      user_data: stringified,
      risk_class: optStr(form.risk_class) ?? 'low',
      tenant: optStr(form.tenant) ?? '',
      callback_url: optStr(form.callback_url),
      idempotency_key: optStr(form.idempotency_key),
    })
  } catch (err) {
    if (err && typeof err === 'object' && 'issues' in err) {
      return c.json({ error: 'validation_failed', issues: (err as { issues: unknown }).issues }, 400)
    }
    return c.json({ error: 'invalid_metadata', message: (err as Error).message }, 400)
  }

  // Forward each PDF individually to the sidecar, share fill_id via callback
  // (Sidecar does not natively support pdf_set in this iteration; we orchestrate here)
  const results: Array<Record<string, unknown>> = []
  const sharedFillId = crypto.randomUUID()
  for (let i = 0; i < pdfs.length; i++) {
    const p = pdfs[i]
    const sidecarForm = new FormData()
    sidecarForm.append('pdf', p, p.name || `bundle-${i}.pdf`)
    sidecarForm.append('user_data', JSON.stringify(meta.user_data))
    sidecarForm.append('risk_class', meta.risk_class)
    sidecarForm.append('tenant', meta.tenant)
    sidecarForm.append('fill_id', sharedFillId) // back-channel: same fill_id per PDF
    if (meta.callback_url) sidecarForm.append('callback_url', meta.callback_url)
    if (meta.idempotency_key) sidecarForm.append('idempotency_key', meta.idempotency_key)

    try {
      const resp = await fetch(`${sidecarUrl(c)}/autofill`, {
        method: 'POST',
        body: sidecarForm,
        signal: AbortSignal.timeout(SIDECAR_TIMEOUT_MS),
      })
      const body = await resp.json() as Record<string, unknown>
      results.push({ index: i, status: resp.status, ...body })
    } catch (err) {
      recordSidecarFailure()
      results.push({ index: i, status: 'error', error: (err as Error).message })
    }
  }

  // Bundle-level status: any failure → partial
  const anyFailed = results.some(r => r.status !== 200)
  recordSidecarSuccess()
  return c.json({
    fill_id: sharedFillId,
    status: anyFailed ? 'partial' : 'completed',
    results,
  })
})
