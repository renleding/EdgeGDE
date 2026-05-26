/**
 * EdgeGDE Mortgage Calculator — Dynamic Router + Tenant Gates
 * HSAES Phase 5: Registry-driven API endpoints with tenant isolation.
 * HSAES Phase 20: Hostname-based multi-tenancy via middleware.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { CALCULATOR_REGISTRY, compileToHtml } from '../registry/calculators'
import type { TenantConfig } from '../middleware/tenant'

// ═══════════════════════════════════════════════════════════════════════════
// Variables type for Hono context
// ═══════════════════════════════════════════════════════════════════════════

type Variables = {
  tenantConfig: TenantConfig
}

// ═══════════════════════════════════════════════════════════════════════════
// Router
// ═══════════════════════════════════════════════════════════════════════════

export const router = new Hono<{ Variables: Variables }>()

// ── Zod error formatter ──────────────────────────────────────────────────

interface ValidationError {
  field: string
  message: string
}

function formatZodError(error: z.ZodError): ValidationError[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
  }))
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /v1/:toolId — Execute a calculator tool
// ═══════════════════════════════════════════════════════════════════════════

router.post('/v1/:toolId', async (c) => {
  const toolId = c.req.param('toolId')

  // ── Lookup tool in registry ────────────────────────────────────────────
  const tool = CALCULATOR_REGISTRY[toolId]
  if (!tool) {
    return c.json({ error: 'Tool not found', toolId }, 404)
  }

  // ── Tenant gate — resolved by middleware ───────────────────────────────
  const tenant = (c as any).get('tenantConfig') as TenantConfig | undefined
  if (!tenant || !tenant.enabledCalculators.includes(toolId)) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  // ── Parse and validate body ────────────────────────────────────────────
  let raw: any
  try {
    raw = await c.req.json()
  } catch {
    return c.json(
      { error: 'Invalid JSON body', details: 'Request body must be valid JSON' },
      400,
    )
  }

  const parsed = tool.schema.safeParse(raw)
  if (!parsed.success) {
    return c.json(
      {
        error: 'Validation failed',
        details: formatZodError(parsed.error),
      },
      400,
    )
  }

  // ── Execute ────────────────────────────────────────────────────────────
  const result = tool.execute(parsed.data)

  // ── Content negotiation ────────────────────────────────────────────────
  const accept = c.req.header('Accept') || ''

  if (accept.includes('application/json')) {
    // Return raw JSON
    return c.json({
      input: parsed.data,
      summary: {
        monthlyRepayment: result.monthlyRepayment,
        fortnightlyRepayment: result.fortnightlyRepayment,
        weeklyRepayment: result.weeklyRepayment,
        totalInterest: result.totalInterest,
        totalCost: result.totalCost,
        totalRepayments: (parsed.data.loanTerm as number) * 12,
        loanTerm: parsed.data.loanTerm,
        totalFees: 0,
      },
      timestamp: new Date().toISOString(),
    })
  }

  // Return HTML for browser / HTMX
  const html = compileToHtml(result, parsed.data)
  c.header('Content-Type', 'text/html; charset=utf-8')
  return c.body(html)
})

// ═══════════════════════════════════════════════════════════════════════════
// GET /calculator/:toolId — Return a deterministic HTML5 shell
// ═══════════════════════════════════════════════════════════════════════════

router.get('/calculator/:toolId', async (c) => {
  const toolId = c.req.param('toolId')

  // ── Lookup tool in registry ────────────────────────────────────────────
  const tool = CALCULATOR_REGISTRY[toolId]
  if (!tool) {
    return c.json({ error: 'Tool not found', toolId }, 404)
  }

  // ── Tenant gate — resolved by middleware ───────────────────────────────
  const tenant = (c as any).get('tenantConfig') as TenantConfig | undefined
  if (!tenant || !tenant.enabledCalculators.includes(toolId)) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  // ── Determine form fields from the tool's schema ───────────────────────
  const shape = tool.schema instanceof z.ZodObject ? tool.schema.shape : {}

  // ── Build field definitions from Zod shape ─────────────────────────────
  const fieldDefinitions: { label: string; type: string; name: string }[] = []
  for (const [key, fieldSchema] of Object.entries(shape)) {
    if (key === 'schemaVersion' || key === 'rateType' || key === 'repaymentFrequency') continue

    let fieldType = 'text'
    if (fieldSchema instanceof z.ZodNumber || (fieldSchema as any)._def?.typeName === 'ZodNumber') {
      fieldType = 'number'
    }
    fieldDefinitions.push({
      label: key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1'),
      type: fieldType,
      name: key,
    })
  }

  // ── Deterministic HTML5 shell ──────────────────────────────────────────
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${tool.id.charAt(0).toUpperCase() + tool.id.slice(1)} Calculator</title>
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-screen bg-gray-50 flex items-center justify-center p-4">
  <div class="w-full max-w-lg">
    <div class="bg-white rounded-2xl shadow-lg p-8">
      <h1 class="text-2xl font-bold text-gray-900 mb-6">${tool.id.charAt(0).toUpperCase() + tool.id.slice(1)} Calculator</h1>
      <p class="text-sm text-gray-600 mb-6">${tool.description}</p>
      <form hx-post="/api/v1/${tool.id}" hx-target="#calculator-results" hx-swap="outerHTML" class="space-y-4">
        ${fieldDefinitions.map((field) => `
        <div>
          <label for="${field.name}" class="block text-sm font-medium text-gray-700 mb-1">${field.label}</label>
          <input type="${field.type}" id="${field.name}" name="${field.name}"
                 class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                 required>
        </div>`).join('\n        ')}
        <button type="submit"
                class="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-lg transition">
          Calculate
        </button>
      </form>
      <div id="calculator-results" class="mt-6"></div>
    </div>
  </div>
</body>
</html>`

  return c.html(html)
})
