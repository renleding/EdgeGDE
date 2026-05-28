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
// Budget Fragment Endpoint
// POST /api/fragment/calculate-budget — stateless, pure calculation
// ═══════════════════════════════════════════════════════════════════════════

import { calculateBudget } from '../edr/domain/budget'

fragmentRouter.post('/fragment/calculate-budget', async (c) => {
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

  const parseNum = (key: string) => Math.max(0, parseFloat(body[key] || '0'))

  const result = calculateBudget({
    salary: parseNum('salary'),
    investments: parseNum('investments'),
    government: parseNum('government'),
    otherIncome: parseNum('other_income'),
    housing: parseNum('housing'),
    food: parseNum('food'),
    transport: parseNum('transport'),
    utilities: parseNum('utilities'),
    insurance: parseNum('insurance'),
    entertainment: parseNum('entertainment'),
    healthcare: parseNum('healthcare'),
    education: parseNum('education'),
    debtPayments: parseNum('debt_payments'),
    otherExpenses: parseNum('other_expenses'),
  })

  const fmt = (v: number) => '$' + Math.floor(v).toLocaleString('en-US')

  const summaryRow = (label: string, value: string, color: string, bg: string) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px;background:${bg};border-radius:12px">
      <span style="color:${color};font-size:14px;font-weight:500">${label}</span>
      <span style="color:#ffffff;font-size:18px;font-weight:700">${value}</span>
    </div>`

  const breakdownSection = (title: string, items: { label: string; amount: number; percentage: number }[]) => `
    <div style="display:flex;flex-direction:column;gap:6px">
      <h4 style="color:rgba(255,255,255,0.8);font-size:14px;font-weight:600;margin:8px 0 4px 0">${title}</h4>
      ${items.filter(i => i.amount > 0).map(i => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:rgba(255,255,255,0.04);border-radius:8px">
          <span style="color:rgba(255,255,255,0.6);font-size:13px">${i.label}</span>
          <span style="color:#ffffff;font-size:13px;font-weight:500">${fmt(i.amount)} <span style="color:rgba(255,255,255,0.4);font-size:11px">(${i.percentage}%)</span></span>
        </div>`).join('')}
    </div>`

  const surplusColor = result.isDeficit ? '#ff6b6b' : '#51cf66'
  const surplusBg = result.isDeficit ? 'rgba(255,107,107,0.12)' : 'rgba(81,207,102,0.12)'

  const fragment = `
<div style="display:flex;flex-direction:column;gap:12px;margin-top:16px" id="results">
  <h4 style="color:rgba(255,255,255,0.9);font-size:16px;font-weight:600;margin:0 0 4px 0">Budget Summary</h4>
  ${summaryRow('Total Income', fmt(result.totalIncome), 'rgba(255,255,255,0.8)', 'rgba(255,255,255,0.06)')}
  ${summaryRow('Total Expenses', fmt(result.totalExpenses), 'rgba(255,255,255,0.8)', 'rgba(255,255,255,0.06)')}
  ${summaryRow(result.isDeficit ? 'Deficit' : 'Surplus', fmt(result.surplus), surplusColor, surplusBg)}
  <div style="display:flex;gap:12px">
    <div style="flex:1;text-align:center;padding:12px;background:rgba(255,255,255,0.04);border-radius:12px">
      <span style="color:rgba(255,255,255,0.5);font-size:11px">Savings Rate</span>
      <div style="color:#ffffff;font-size:20px;font-weight:700;margin-top:2px">${result.savingsRate}%</div>
    </div>
    <div style="flex:1;text-align:center;padding:12px;background:rgba(255,255,255,0.04);border-radius:12px">
      <span style="color:rgba(255,255,255,0.5);font-size:11px">Expense Ratio</span>
      <div style="color:#ffffff;font-size:20px;font-weight:700;margin-top:2px">${result.expenseRatio}%</div>
    </div>
  </div>
  ${breakdownSection('Income Breakdown', result.incomeBreakdown)}
  ${breakdownSection('Expense Breakdown', result.expenseBreakdown)}
  <p style="color:rgba(255,255,255,0.3);font-size:11px;margin:4px 0 0 0">${result.warning}</p>
</div>`

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
