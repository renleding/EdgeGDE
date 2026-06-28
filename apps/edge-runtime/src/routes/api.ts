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
import { getCalculator } from '../lib/calculator-engine'
import type { TenantConfig } from '../lib/tenant'
import { runMission } from '../actions/lifecycle'
import { getCorrelationId } from '../middleware/correlation'
import type { MissionDefinition } from '../actions/types'
import type { AgenticMissionManifest, MissionStep } from '../agentic-ux/agentic-ux.schema'

// ═══════════════════════════════════════════════════════════════════════════
// Variables type for Hono context
// ═══════════════════════════════════════════════════════════════════════════

type Variables = {
  tenant: TenantConfig
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

  // ── Lookup tool in registry (legacy + engine) ───────────────────────
  const tool = CALCULATOR_REGISTRY[toolId] || (() => {
    const engineCalc = getCalculator(toolId)
    if (!engineCalc) return undefined
    return {
      id: engineCalc.id, description: engineCalc.description,
      schema: engineCalc.inputSchema as any,
      layout: { schemaVersion: '0.1.0', rootNode: { id: 'r', type: 'FRAME' as const, name: 'Results', x: 0, y: 0, width: 600, height: 300 }, formFields: [] },
      execute(input: any) { return engineCalc.execute(input) },
    }
  })()
  if (!tool) {
    return c.json({ error: 'Tool not found', toolId }, 404)
  }

  // ── Tenant gate — resolved by middleware ───────────────────────────────
  const tenant = (c as any).get('tenant') as TenantConfig | undefined
  if (!tenant) {
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

  // ── Execute via lifecycle runner ─────────────────────────────────────
  const missionDef: MissionDefinition = {
    id: `calc-${toolId}-${Date.now()}`,
    name: `Calculate ${toolId}`,
    desiredState: {},
    actions: [],
  }

  const step: MissionStep = {
    stepId: 'calculate',
    description: `Execute ${tool.id} calculator`,
    actionType: 'calculator.execute',
    input: { toolId, input: parsed.data },
    risk: 'low',
    approvalMode: 'none',
  }

  const manifest: AgenticMissionManifest = {
    id: missionDef.id,
    sessionId: `sess-${toolId}`,
    tenantId: tenant.tenantId,
    correlationId: getCorrelationId(c),
    stateProjectionVersion: 0,
    intent: `Calculate ${tool.description}`,
    expectedOutcome: 'Calculator result with repayment summary',
    steps: [step],
    verificationPlan: [{ checkId: 'v1', stepId: 'calculate', type: 'calculator_output_check', expected: `${tool.id} result` }],
    compensationPlan: [{ stepId: 'calculate', mode: 'none' }],
    createdAt: new Date().toISOString(),
    status: 'approved',
  }

  const missionResult = await runMission({
    mission: missionDef,
    manifest,
    correlationId: getCorrelationId(c),
    tenantId: tenant.tenantId,
    env: c.env as Record<string, unknown>,
  })

  const executedAction = missionResult.executedActions[0]

  // ── Handle lifecycle failure ──────────────────────────────────────────
  if (missionResult.status !== 'success' || !executedAction || executedAction.result.status !== 'success') {
    return c.json({
      error: 'Calculation failed',
      details: executedAction?.result.error ?? missionResult.error ?? 'Unknown lifecycle error',
      missionStatus: missionResult.status,
    }, 500)
  }

  const calcOutput = executedAction.result.output as {
    toolId: string
    input: Record<string, unknown>
    summary: {
      monthlyRepayment: number
      fortnightlyRepayment: number
      weeklyRepayment: number
      totalInterest: number
      totalCost: number
      totalRepayments: number
      loanTerm: number | null
      totalFees: number
    }
    timestamp: string
  }

  // ── Content negotiation ────────────────────────────────────────────────
  const accept = c.req.header('Accept') || ''

  if (accept.includes('application/json')) {
    // Return raw JSON from lifecycle result
    return c.json({
      input: calcOutput.input,
      summary: calcOutput.summary,
      timestamp: calcOutput.timestamp,
      missionId: missionResult.missionId,
      correlationId: missionResult.correlationId,
    })
  }

  // Return HTML for browser / HTMX
  const html = compileToHtml(
    {
      monthlyRepayment: calcOutput.summary.monthlyRepayment,
      fortnightlyRepayment: calcOutput.summary.fortnightlyRepayment,
      weeklyRepayment: calcOutput.summary.weeklyRepayment,
      totalInterest: calcOutput.summary.totalInterest,
      totalCost: calcOutput.summary.totalCost,
      monthlyFees: 0,
      totalInterestOnly: calcOutput.summary.totalInterest,
    } as any,
    parsed.data,
  )
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
  const tenant = (c as any).get('tenant') as TenantConfig | undefined
  if (!tenant) {
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
