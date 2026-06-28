/**
 * EdgeGDE — Universal Form Registry
 * Phase 29: Dynamic form route generation with Zod validation.
 * Forms register once; routes are mounted automatically.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import { z } from 'zod'
import type { FormDefinition } from './schemas'
import { buildFormSchema } from './schemas'
import { deadLetterKey, deadLetterIndexKey } from './kv-keys'

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/** Registered form with its runtime schema */
interface RegisteredForm {
  def: FormDefinition
  schema: z.ZodObject<any>
  handler?: FormHandler
}

/** Handler receives validated form data, returns HTML fragment */
type FormHandler = (data: Record<string, any>, env: any) => Promise<string> | string

const registry = new Map<string, RegisteredForm>()

// ═══════════════════════════════════════════════════════════════════════════
// Registration
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Register a form.
 * Throws if a form with the same ID is already registered.
 * Generates the Zod schema automatically via buildFormSchema().
 */
export function registerForm(
  def: FormDefinition,
  handler?: FormHandler,
): void {
  if (registry.has(def.id)) {
    throw new Error(`Form "${def.id}" is already registered`)
  }
  const schema = buildFormSchema(def.fields)
  registry.set(def.id, { def, schema, handler })
}

// ═══════════════════════════════════════════════════════════════════════════
// Lookup
// ═══════════════════════════════════════════════════════════════════════════

/** Look up a registered form by ID. Returns undefined if not found. */
export function getForm(id: string): RegisteredForm | undefined {
  return registry.get(id)
}

/** Get all registered form IDs */
export function getFormIds(): string[] {
  return Array.from(registry.keys())
}

// ═══════════════════════════════════════════════════════════════════════════
// Route Mounting
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mount all registered form routes onto a Hono app.
 * Each form gets:
 *   POST /api/form/{id} — accepts FormData or URL-encoded or JSON
 *
 * HTMX-native: errors return <div id="{targetId}" class="error"> fragments,
 * successes return the handler's output (expected as <div id="{targetId}">).
 */
export function mountFormRoutes(app: Hono): void {
  for (const [, registered] of registry) {
    const { def, schema, handler } = registered

    app.post(`/api/form/${def.id}`, async (c) => {
      // ── Parse body (FormData, URL-encoded, or JSON) ─────────────────────
      let raw: Record<string, unknown>
      const contentType = c.req.header('content-type') || ''

      if (
        contentType.includes('multipart/form-data') ||
        contentType.includes('application/x-www-form-urlencoded')
      ) {
        const formData = await c.req.formData()
        raw = Object.fromEntries(formData.entries()) as Record<string, unknown>
      } else {
        try {
          raw = await c.req.json()
        } catch {
          raw = {}
        }
      }

      // ── Validate ───────────────────────────────────────────────────────
      const result = schema.safeParse(raw)
      if (!result.success) {
        const issues = result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        }))
        return c.html(
          `<div id="${escapeHtml(def.resultTargetId)}" class="error">\n` +
          `  <ul>\n` +
          issues.map((i) => `    <li>${escapeHtml(i.path)}: ${escapeHtml(i.message)}</li>`).join('\n') +
          `\n  </ul>\n</div>`,
          400,
        )
      }

      // ── Execute handler ────────────────────────────────────────────────
      try {
        const html = handler
          ? await handler(result.data, c.env)
          : defaultResultHtml(def, result.data)

        // ══════════════════════════════════════════════════════════════════
        // D1 Persistence (Phase 31) — fire-and-forget, never blocks response
        // ══════════════════════════════════════════════════════════════════
        const submissionId =
          (crypto as any).randomUUID?.() || `${Date.now()}-${Math.random()}`
        const tenantId =
          ((c as any).get('tenant')?.tenantId) || 'default'

        c.executionCtx.waitUntil((async () => {
          let payloadStr = ''
          try {
            payloadStr = JSON.stringify(result.data)

            // CRITICAL: prevent abuse / oversized payloads
            if (payloadStr.length > 50000) {
              throw new Error('Payload too large')
            }

            const db = (c.env as any)?.DB
            if (!db || typeof db.prepare !== 'function') return

            await db.prepare(
              'INSERT INTO form_submissions (id, tenant_id, form_id, payload) VALUES (?, ?, ?, ?)'
            )
              .bind(submissionId, tenantId, def.id, payloadStr)
              .run()

            // ══════════════════════════════════════════════════════════════════
            // Lead Scoring (Track 4 Phase 5) — enqueue for async processing
            // ══════════════════════════════════════════════════════════════
            try {
              const queue = (c.env as any)?.LEAD_SCORING_QUEUE
              if (queue && typeof queue.send === 'function') {
                await queue.send({
                  submissionId,
                  tenantId,
                  formId: def.id,
                  payload: result.data,
                  contactInfo: {
                    name: (result.data as any)?.fullName || (result.data as any)?.name || '',
                    email: (result.data as any)?.email || '',
                    phone: (result.data as any)?.phone || '',
                  },
                })
              }
            } catch {
              // Queue send failure is non-blocking — never breaks the response
            }
            // ══════════════════════════════════════════════════════════════
            // Webhook Dispatch (Track 4 Phase 1) — fire after scoring + D1
            // ══════════════════════════════════════════════════════════════
            try {
              const TENANT_KV = (c.env as any)?.TENANT_KV
              if (TENANT_KV && typeof TENANT_KV.get === 'function') {
                const { dispatchWebhook } = await import('../lib/webhook')
                // Extract correlationId from submission fields if present
                const fields = result.data as Record<string, unknown>
                const correlationId = (fields?._test_correlation as string) || undefined

                await dispatchWebhook(TENANT_KV, {
                  tenantId,
                  formId: def.id,
                  submissionId,
                  timestamp: new Date().toISOString(),
                  fields,
                  metadata: {
                    source: 'form-submission',
                    version: 1,
                    correlationId,
                  },
                })
              }
            } catch {
              // Webhook failure is non-blocking
            }

          } catch (dbErr) {
            // ══════════════════════════════════════════════════════════════
            // CIRCUIT BREAKER: D1 insert failed — park in tenant's dead-letter KV
            // ══════════════════════════════════════════════════════════════
            console.warn(JSON.stringify({
              event: 'circuit_breaker',
              formId: def.id,
              submissionId,
              tenantId,
              error: dbErr instanceof Error ? dbErr.message : String(dbErr),
            }))
            try {
              const TENANT_KV = (c.env as any)?.TENANT_KV
              if (TENANT_KV && typeof TENANT_KV.put === 'function') {
                const dlKey = deadLetterKey(tenantId, submissionId)
                await TENANT_KV.put(dlKey, payloadStr, { expirationTtl: 604800 })

                // Maintain deadletter index pointer
                const indexKey = deadLetterIndexKey(tenantId)
                const existingRaw = await TENANT_KV.get(indexKey)
                const existing: string[] = existingRaw
                  ? JSON.parse(existingRaw)
                  : []
                const updated = [submissionId, ...existing.filter((id: string) => id !== submissionId)].slice(0, 100)
                await TENANT_KV.put(indexKey, JSON.stringify(updated))
              }
            } catch { /* non-blocking — best effort dead-letter */ }
          }
        })())

        return c.html(html)
      } catch (err: any) {
        return c.html(
          `<div id="${escapeHtml(def.resultTargetId)}" class="error">\n` +
          `  <p>Error: ${escapeHtml(err.message || 'Unknown error')}</p>\n</div>`,
          500,
        )
      }
    })
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Default fallback — echoes submitted values as a summary table
// ═══════════════════════════════════════════════════════════════════════════

function defaultResultHtml(def: FormDefinition, data: Record<string, any>): string {
  const rows = Object.entries(data)
    .map(
      ([key, val]) =>
        `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(String(val ?? ''))}</td></tr>`,
    )
    .join('')
  return (
    `<div id="${escapeHtml(def.resultTargetId)}">\n` +
    `  <h3>${escapeHtml(def.label)} — Submitted</h3>\n` +
    `  <table><tbody>${rows}</tbody></table>\n` +
    `</div>`
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// HTML escaping (prevents XSS in error messages and field names)
// ═══════════════════════════════════════════════════════════════════════════

function escapeHtml(text: string): string {
  if (!text) return ''
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
