/**
 * EdgeGDE EDR — Fragment Rendering Endpoints
 * v4.9.0: HTMX fragment endpoints for partial UI updates.
 * Uses pure domain calculator — no KV, no HTMX awareness in domain layer.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import { calculateLoan } from '../edr/domain/calculator'

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
 * Accepts form field values, runs pure calculation, returns HTML fragment.
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
