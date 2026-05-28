/**
 * EdgeGDE EDR — Fragment Rendering Endpoints
 * v4.9.1: HTMX fragment endpoints for partial UI updates.
 * Includes dev feedback loop hash endpoint and root fragment renderer.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import { calculateLoan } from '../edr/domain/calculator'
import { compile } from '../edr/compiler/engine'
import { transform } from '../edr/compiler/synthesis'
import { getLatestHash } from '../edr/runtime/hash'

// ═══════════════════════════════════════════════════════════════════════════
// Fragment HTML Builder
// ═══════════════════════════════════════════════════════════════════════════

interface CalcDisplay {
  monthly: number
  fortnightly: number
  weekly: number
  totalInterest: number
  totalRepayment: number
}

function formatCurrency(value: number): string {
  return '$' + Math.floor(value).toLocaleString('en-US')
}

function buildResultsFragment(result: CalcDisplay): string {
  const items = [
    { label: 'Monthly Repayment', value: formatCurrency(result.monthly) },
    { label: 'Fortnightly Repayment', value: formatCurrency(result.fortnightly) },
    { label: 'Weekly Repayment', value: formatCurrency(result.weekly) },
    { label: 'Total Interest', value: formatCurrency(result.totalInterest) },
    { label: 'Total Cost', value: formatCurrency(result.totalRepayment) },
  ]

  const rows = items.map(i => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:rgba(255,255,255,0.06);border-radius:12px">
      <span style="color:rgba(255,255,255,0.7);font-size:14px">${i.label}</span>
      <span style="color:#ffffff;font-size:16px;font-weight:600">${i.value}</span>
    </div>`).join('')

  return `
<div style="display:flex;flex-direction:column;gap:8px;margin-top:16px;transition:opacity 0.2s" id="results">
  <h4 style="color:rgba(255,255,255,0.9);font-size:16px;font-weight:600;margin:0 0 8px 0">Your Quote</h4>
  ${rows}
  <p style="color:rgba(255,255,255,0.4);font-size:11px;margin:8px 0 0 0">This is an estimate only. Not financial advice.</p>
</div>`
}

// ═══════════════════════════════════════════════════════════════════════════
// Router
// ═══════════════════════════════════════════════════════════════════════════

export const fragmentRouter = new Hono()

/**
 * POST /api/fragment/calculate — stateless, no KV writes.
 * Calculator fragment for HTMX swap.
 */
fragmentRouter.post('/fragment/calculate', async (c) => {
  let body: Record<string, string> = {}
  try {
    const ct = c.req.header('content-type') || ''
    if (ct.includes('application/json')) {
      body = await c.req.json() as Record<string, string>
    } else {
      const form = await c.req.parseBody()
      for (const [k, v] of Object.entries(form)) {
        body[k] = String(v || '')
      }
    }
  } catch {
    return c.text('Invalid submission', 400)
  }

  const loanAmount = parseFloat(body.loan_amount || body.property_value || '0')
  const interestRate = parseFloat(body.interest_rate || '0')
  const termYears = parseInt(body.term_years || '30', 10)

  const result = calculateLoan({ loanAmount, interestRate, termYears })
  const fragment = buildResultsFragment(result)

  c.header('Content-Type', 'text/html; charset=utf-8')
  c.header('Cache-Control', 'no-store')
  return c.body(fragment)
})

// ═══════════════════════════════════════════════════════════════════════════
// Dev Feedback Loop — Hash Sentinel Endpoint
// GET /api/fragment/dev-hash — O(1), no KV writes, no compilation
// ═══════════════════════════════════════════════════════════════════════════

fragmentRouter.get('/fragment/dev-hash', async (c) => {
  const serverHash = await getLatestHash({ kv: (c.env as any)?.TENANT_KV, dev: true })
  const clientHash = c.req.header('X-Current-Hash')

  // Mismatch detected — emit trigger, return updated sentinel
  if (clientHash !== undefined && serverHash !== clientHash) {
    c.header('HX-Trigger', 'ui-schema-mutated')
    return c.html(`
      <div id="dev-sentinel"
           hx-get="/api/fragment/dev-hash"
           hx-trigger="every 0.5s"
           hx-swap="outerHTML"
           hx-headers='{"X-Current-Hash": "${serverHash}"}'>
      </div>
    `)
  }

  // Idle — hashes match
  return new Response(null, { status: 204 })
})

// ═══════════════════════════════════════════════════════════════════════════
// Root Fragment Renderer
// GET /api/fragment/render-root — recompiles AST and returns bare HTML
// ═══════════════════════════════════════════════════════════════════════════

fragmentRouter.get('/fragment/render-root', async (c) => {
  const TENANT_KV = (c.env as any)?.TENANT_KV
  if (!TENANT_KV) return c.text('KV not available', 500)

  try {
    const layout = await TENANT_KV.get('tenant:afirmico:layout:latest', 'json')
    if (!layout || !layout.root) return c.text('No layout found', 404)

    const synthesized = transform(layout.root)
    const edrDef = {
      components: layout.edr?.components || {},
      global: layout.edr?.global || {},
    }
    const html = compile(synthesized, edrDef, layout.edrHash || 'default', 'edr')

    c.header('Content-Type', 'text/html; charset=utf-8')
    c.header('Cache-Control', 'no-store')
    return c.body(html)
  } catch (err: any) {
    return c.text(`Render error: ${err.message}`, 500)
  }
})
