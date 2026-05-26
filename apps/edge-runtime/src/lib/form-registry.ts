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
          ((c as any).get('tenantConfig')?.tenantId) || 'default'

        c.executionCtx.waitUntil((async () => {
          try {
            const payloadStr = JSON.stringify(result.data)

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

          } catch (error) {
            console.error('[D1 Persistence Failure]', error)
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
