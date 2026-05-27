/**
 * EdgeGDE EDR — Fragment Rendering Endpoints
 * v4.8.1: HTMX fragment endpoints for partial UI updates.
 * Each endpoint returns bare HTML fragments — no page wrapper.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'

// ═══════════════════════════════════════════════════════════════════════════
// Mortgage Calculation
// ═══════════════════════════════════════════════════════════════════════════

interface CalcResult {
  monthlyRepayment: number
  fortnightlyRepayment: number
  weeklyRepayment: number
  totalInterest: number
  totalCost: number
  warning: string
}

function calculateMortgage(input: Record<string, string>): CalcResult {
  const P = parseFloat(input.property_value || input.principal || '0')
  const annualRate = parseFloat(input.interest_rate || '0')
  const termYears = 30 // default loan term

  const r = annualRate / 12 / 100
  const n = termYears * 12
  let monthlyRepayment = 0

  if (r > 0 && P > 0) {
    const onePlusR = 1 + r
    const powR = Math.pow(onePlusR, n)
    monthlyRepayment = P * (r * powR) / (powR - 1)
  }

  monthlyRepayment = Math.round(monthlyRepayment * 100) / 100
  const annualCost = monthlyRepayment * 12
  const fortnightlyRepayment = Math.round((annualCost / 26) * 100) / 100
  const weeklyRepayment = Math.round((annualCost / 52) * 100) / 100
  const totalRepayments = monthlyRepayment * n
  const totalInterest = Math.round(Math.max(0, totalRepayments - P) * 100) / 100
  const totalCost = Math.round((P + totalInterest) * 100) / 100

  return {
    monthlyRepayment,
    fortnightlyRepayment,
    weeklyRepayment,
    totalInterest,
    totalCost,
    warning: 'This is an estimate only. Not financial advice.',
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Fragment HTML Builder
// ═══════════════════════════════════════════════════════════════════════════

function buildResultsFragment(result: CalcResult): string {
  const items = [
    { label: 'Monthly Repayment', value: `$${result.monthlyRepayment.toFixed(2)}` },
    { label: 'Fortnightly Repayment', value: `$${result.fortnightlyRepayment.toFixed(2)}` },
    { label: 'Weekly Repayment', value: `$${result.weeklyRepayment.toFixed(2)}` },
    { label: 'Total Interest', value: `$${result.totalInterest.toFixed(2)}` },
    { label: 'Total Cost', value: `$${result.totalCost.toFixed(2)}` },
  ]

  const rows = items.map(i => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:rgba(255,255,255,0.06);border-radius:12px">
      <span style="color:rgba(255,255,255,0.7);font-size:14px">${i.label}</span>
      <span style="color:#ffffff;font-size:16px;font-weight:600">${i.value}</span>
    </div>`).join('')

  return `
<div style="display:flex;flex-direction:column;gap:8px;margin-top:16px" id="results">
  <h4 style="color:rgba(255,255,255,0.9);font-size:16px;font-weight:600;margin:0 0 8px 0">Your Quote</h4>
  ${rows}
  <p style="color:rgba(255,255,255,0.4);font-size:11px;margin:8px 0 0 0">${result.warning}</p>
</div>`
}

// ═══════════════════════════════════════════════════════════════════════════
// Router
// ═══════════════════════════════════════════════════════════════════════════

export const fragmentRouter = new Hono()

/**
 * POST /api/fragment/calculate
 * Accepts form field values, runs mortgage calculation,
 * returns HTML fragment for HTMX swap.
 */
fragmentRouter.post('/fragment/calculate', async (c) => {
  let body: Record<string, string> = {}
  try {
    // Support both JSON and form-encoded submissions
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

  const result = calculateMortgage(body)
  const fragment = buildResultsFragment(result)

  c.header('Content-Type', 'text/html; charset=utf-8')
  c.header('Cache-Control', 'no-store')
  return c.body(fragment)
})
