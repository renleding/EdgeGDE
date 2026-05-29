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

  // Frequency multiplier map
  const freqMult: Record<string, number> = {
    daily: 365, weekly: 52, fortnightly: 26, monthly: 12, quarterly: 4, annually: 1,
  }

  // Parse a field with frequency support
  const parseField = (baseKey: string): number => {
    const val = parseFloat(body[baseKey] || '0')
    if (val === 0) return 0
    const freq = (body[`${baseKey}_freq`] as string) || 'monthly'
    const mult = freqMult[freq] || 12
    return Math.round(val * mult * 100) / 100
  }

  // Collect dynamic fields (added via Add Income / Add Expense buttons)
  let dynamicIncomeTotal = 0
  let dynamicExpensesTotal = 0
  const dynamicIncomeItems: { label: string; amount: number }[] = []
  const dynamicExpenseItems: { label: string; amount: number }[] = []

  for (const [key, val] of Object.entries(body)) {
    if (key.startsWith('income_custom_') && !key.endsWith('_name') && !key.endsWith('_freq')) {
      const valNum = parseFloat(val as string) || 0
      if (valNum === 0) continue
      const freq = (body[`${key}_freq`] as string) || 'monthly'
      const mult = freqMult[freq] || 12
      const annual = Math.round(valNum * mult * 100) / 100
      const nameKey = key + '_name'
      const label = body[nameKey] || 'Custom Income'
      dynamicIncomeTotal += annual
      dynamicIncomeItems.push({ label, amount: valNum })
    }
    if (key.startsWith('expense_custom_') && !key.endsWith('_name') && !key.endsWith('_freq')) {
      const valNum = parseFloat(val as string) || 0
      if (valNum === 0) continue
      const freq = (body[`${key}_freq`] as string) || 'monthly'
      const mult = freqMult[freq] || 12
      const annual = Math.round(valNum * mult * 100) / 100
      const nameKey = key + '_name'
      const label = body[nameKey] || 'Custom Expense'
      dynamicExpensesTotal += annual
      dynamicExpenseItems.push({ label, amount: valNum })
    }
  }

  const result = calculateBudget({
    salary: parseField('salary') + dynamicIncomeTotal,
    investments: parseField('investments'),
    government: parseField('government'),
    otherIncome: parseField('other_income'),
    housing: parseField('housing') + dynamicExpensesTotal,
    food: parseField('food'),
    transport: parseField('transport'),
    utilities: parseField('utilities'),
    insurance: parseField('insurance'),
    entertainment: parseField('entertainment'),
    healthcare: parseField('healthcare'),
    education: parseField('education'),
    debtPayments: parseField('debt_payments'),
    otherExpenses: parseField('other_expenses'),
  })

  // Inject dynamic items into breakdowns
  if (dynamicIncomeItems.length > 0) {
    result.incomeBreakdown.push(
      ...dynamicIncomeItems.map(i => ({
        label: i.label,
        amount: Math.round(i.amount * 100) / 100,
        percentage: result.totalIncome > 0 ? Math.round((i.amount / result.totalIncome) * 10000) / 100 : 0,
      }))
    )
  }
  if (dynamicExpenseItems.length > 0) {
    result.expenseBreakdown.push(
      ...dynamicExpenseItems.map(i => ({
        label: i.label,
        amount: Math.round(i.amount * 100) / 100,
        percentage: result.totalExpenses > 0 ? Math.round((i.amount / result.totalExpenses) * 10000) / 100 : 0,
      }))
    )
  }

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
// KV Metrics Dashboard
// ═══════════════════════════════════════════════════════════════════════════

import { getMetrics } from '../lib/metrics'

fragmentRouter.get('/fragment/metrics', async (c) => {
  const TENANT_KV = (c.env as any)?.TENANT_KV
  if (!TENANT_KV) return c.text('KV not available', 500)

  try {
    const tenant = c.req.query('tenant') || ''
    const tool = c.req.query('tool') || ''
    const data = await getMetrics(TENANT_KV, tenant || undefined, tool || undefined)

    const rows = data.length === 0
      ? '<div style="color:rgba(255,255,255,0.3);text-align:center;padding:24px;font-size:13px">No metrics recorded yet</div>'
      : data.map(m => `
        <tr>
          <td style="padding:8px 12px;color:#fff;font-size:13px">${m.tenant}</td>
          <td style="padding:8px 12px;color:rgba(255,255,255,0.7);font-size:13px">${m.tool}</td>
          <td style="padding:8px 12px;color:#22C55E;font-size:13px;font-weight:600;text-align:center">${m.requests.toLocaleString()}</td>
          <td style="padding:8px 12px;color:${m.errors > 0 ? '#FF6B6B' : 'rgba(255,255,255,0.5)'};font-size:13px;text-align:center">${m.errors.toLocaleString()}</td>
          <td style="padding:8px 12px;color:rgba(255,255,255,0.4);font-size:12px;text-align:right">${m.lastSeen ? new Date(m.lastSeen).toLocaleString() : '-'}</td>
        </tr>`).join('')

    const html = `
<div style="max-width:900px;margin:0 auto">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
    <h2 style="color:#fff;font-size:20px;font-weight:600;margin:0">Live Metrics</h2>
    <span style="color:rgba(255,255,255,0.35);font-size:11px">Auto-refreshing every 10s</span>
  </div>
  <div style="background:rgba(255,255,255,0.06);border-radius:14px;border:1px solid rgba(255,255,255,0.1);overflow:hidden">
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="background:rgba(255,255,255,0.04)">
          <th style="padding:10px 12px;color:rgba(255,255,255,0.4);font-size:11px;font-weight:600;text-transform:uppercase;text-align:left">Tenant</th>
          <th style="padding:10px 12px;color:rgba(255,255,255,0.4);font-size:11px;font-weight:600;text-transform:uppercase;text-align:left">Tool</th>
          <th style="padding:10px 12px;color:rgba(255,255,255,0.4);font-size:11px;font-weight:600;text-transform:uppercase;text-align:center">Requests</th>
          <th style="padding:10px 12px;color:rgba(255,255,255,0.4);font-size:11px;font-weight:600;text-transform:uppercase;text-align:center">Errors</th>
          <th style="padding:10px 12px;color:rgba(255,255,255,0.4);font-size:11px;font-weight:600;text-transform:uppercase;text-align:right">Last Seen</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
    <a href="/?tenant=afirmico&tool=metrics" style="padding:6px 14px;border-radius:8px;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.25);color:#818CF8;font-size:12px;text-decoration:none">View Dashboard</a>
  </div>
</div>`

    c.header('Content-Type', 'text/html; charset=utf-8')
    c.header('Cache-Control', 'no-store')
    return c.body(html)
  } catch (err: any) {
    return c.text(`Metrics error: ${err.message}`, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// Dynamic Budget Field — Add
// POST /api/fragment/budget-add-field — returns new field row HTML
// ═══════════════════════════════════════════════════════════════════════════

let budgetFieldCounter = Date.now()

fragmentRouter.post('/fragment/budget-add-field', async (c) => {
  const body = await c.req.parseBody() as Record<string, string>
  const category = body.category || 'income'
  const prefix = category === 'income' ? 'income' : 'expense'
  const counter = ++budgetFieldCounter
  const fieldId = `${prefix}_custom_${counter}`
  const label = body.label || 'Custom'

  const row = `
<div class="dynamic-field-row" style="display:grid;grid-template-columns:1fr 140px 120px 80px 40px;gap:8px;align-items:center">
  <input name="${fieldId}_name" type="text" value="${label}" placeholder="Name"
         style="padding:10px 12px;border-radius:18px;background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.25);color:#fff;font-size:13px">
  <select name="${fieldId}_freq"
          style="padding:10px 12px;border-radius:18px;background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.25);color:#fff;font-size:13px;cursor:pointer">
    <option value="daily">Daily</option>
    <option value="weekly">Weekly</option>
    <option value="fortnightly">Fortnightly</option>
    <option value="monthly" selected>Monthly</option>
    <option value="quarterly">Quarterly</option>
    <option value="annually">Annually</option>
  </select>
  <input name="${fieldId}" type="number" placeholder="0"
         style="padding:10px 12px;border-radius:18px;background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.25);color:#fff;font-size:13px;text-align:center">
  <span style="color:rgba(255,255,255,0.5);font-size:13px;text-align:center">-</span>
  <button type="button"
          hx-post="/api/fragment/budget-remove-field"
          hx-target="closest .dynamic-field-row"
          hx-swap="outerHTML"
          style="width:32px;height:32px;border-radius:50%;border:1px solid rgba(255,107,107,0.4);background:rgba(255,107,107,0.15);color:#ff6b6b;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0">×</button>
</div>`

  c.header('Content-Type', 'text/html; charset=utf-8')
  c.header('Cache-Control', 'no-store')
  return c.body(row)
})

// ═══════════════════════════════════════════════════════════════════════════
// Dynamic Budget Field — Remove
// POST /api/fragment/budget-remove-field — returns 204 (HTMX removes the row)
// ═══════════════════════════════════════════════════════════════════════════

fragmentRouter.post('/fragment/budget-remove-field', async () => {
  // Return empty content — HTMX swaps the target out of the DOM
  return new Response('', { status: 200, headers: { 'Content-Type': 'text/html' } })
})

// ═══════════════════════════════════════════════════════════════════════════
// Swatch Detail Fragment
// POST /api/fragment/swatch-detail — returns full design system detail view
// ═══════════════════════════════════════════════════════════════════════════

import { getSwatchById } from '../edr/themes/swatches'

fragmentRouter.post('/fragment/swatch-detail', async (c) => {
  const body = await c.req.parseBody() as Record<string, string>
  const swatchId = body.id || ''
  const swatch = getSwatchById(swatchId)

  if (!swatch) {
    c.header('Content-Type', 'text/html')
    return c.body('<div style="color:rgba(255,255,255,0.5);padding:40px;text-align:center">Design system not found</div>')
  }

  const backBtn = `<button onclick="window.location.reload()" style="padding:8px 16px;border-radius:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.7);font-size:13px;cursor:pointer;margin-bottom:16px">&larr; Back to Gallery</button>`

  const colorSwatches = swatch.colors.palette.map(c => `
    <div style="display:flex;align-items:center;gap:12px;padding:8px 12px;background:rgba(255,255,255,0.04);border-radius:8px">
      <div style="width:36px;height:36px;border-radius:8px;background:${c.value};border:1px solid rgba(255,255,255,0.1);flex-shrink:0"></div>
      <div style="flex:1;min-width:0">
        <div style="color:#fff;font-size:13px;font-weight:500">${c.name}</div>
        <div style="color:rgba(255,255,255,0.4);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.description}</div>
      </div>
      <code style="color:rgba(255,255,255,0.5);font-size:11px;font-family:monospace;background:rgba(255,255,255,0.06);padding:2px 8px;border-radius:4px">${c.value}</code>
    </div>`).join('')

  const typography = swatch.typography.map(t => `
    <div style="padding:12px;background:rgba(255,255,255,0.04);border-radius:8px">
      <div style="color:#fff;font-size:14px;font-weight:600;margin-bottom:4px">${t.font}</div>
      <div style="color:rgba(255,255,255,0.4);font-size:11px;text-transform:capitalize;margin-bottom:8px">${t.category} &middot; Weights: ${t.weights.join(', ')}</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${t.sizes.map(s => `<span style="padding:4px 10px;background:rgba(255,255,255,0.06);border-radius:4px;color:rgba(255,255,255,0.6);font-size:11px">${s.name}: ${s.value}</span>`).join('')}
      </div>
    </div>`).join('')

  const spacing = `<div style="display:flex;flex-wrap:wrap;gap:6px;padding:8px 0">
    ${swatch.spacing.scale.map(s => `<span style="padding:6px 12px;background:rgba(255,255,255,0.06);border-radius:6px;color:rgba(255,255,255,0.6);font-size:12px;font-family:monospace">${s}</span>`).join('')}
  </div>`

  const components = swatch.components.map(c => `
    <div style="padding:10px 14px;background:rgba(255,255,255,0.04);border-radius:8px">
      <div style="color:#fff;font-size:13px;font-weight:500;margin-bottom:2px">${c.name}</div>
      <div style="color:rgba(255,255,255,0.4);font-size:11px">${c.preview}</div>
      <div style="display:flex;gap:6px;margin-top:6px">
        ${c.variants.map(v => `<span style="padding:2px 8px;background:rgba(255,255,255,0.06);border-radius:4px;color:rgba(255,255,255,0.4);font-size:10px">${v}</span>`).join('')}
      </div>
    </div>`).join('')

  const elevations = swatch.elevation.map(e => `
    <div style="padding:10px 14px;background:rgba(255,255,255,0.04);border-radius:8px">
      <div style="color:#fff;font-size:13px;font-weight:500;margin-bottom:4px">${e.name}</div>
      <code style="color:rgba(255,255,255,0.4);font-size:11px;font-family:monospace">${e.shadow}</code>
    </div>`).join('')

  const dosList = swatch.dos.map(d => `<li style="color:rgba(81,207,102,0.8);font-size:13px;padding:4px 0">&check; ${d}</li>`).join('')
  const dontsList = swatch.donts.map(d => `<li style="color:rgba(255,107,107,0.8);font-size:13px;padding:4px 0">&times; ${d}</li>`).join('')

  const section = (title: string, content: string) => `
    <div style="margin-top:24px">
      <h3 style="color:rgba(255,255,255,0.85);font-size:16px;font-weight:600;margin:0 0 12px 0;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.08)">${title}</h3>
      ${content}
    </div>`

  const html = `
<div style="max-width:900px;margin:0 auto">
  ${backBtn}
  <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:24px">
    <div style="display:flex;align-items:center;gap:12px">
      <h1 style="color:#fff;font-size:32px;font-weight:700;margin:0">${swatch.name}</h1>
      <span style="padding:2px 10px;border-radius:6px;background:rgba(99,102,241,0.2);color:#818CF8;font-size:12px;font-weight:500">v${swatch.version}</span>
    </div>
    <p style="color:rgba(255,255,255,0.55);font-size:14px;margin:4px 0 0 0;max-width:600px">${swatch.description}</p>
    <div style="display:flex;gap:16px;margin-top:4px;color:rgba(255,255,255,0.4);font-size:12px">
      <span>by ${swatch.author}</span>
      <span>${swatch.downloads.toLocaleString()} downloads</span>
      <span>${swatch.likes.toLocaleString()} likes</span>
    </div>
  </div>

  ${section('Color Palette', colorSwatches)}
  ${section('Typography', typography)}
  ${section('Spacing Scale <span style="color:rgba(255,255,255,0.3);font-weight:400;font-size:12px">(base: ' + swatch.spacing.base + ')</span>', spacing)}
  ${section('Components', components)}
  ${section('Elevation & Depth', elevations)}
  ${section('Do\'s', '<ul style="list-style:none;padding:0;margin:0">' + dosList + '</ul>')}
  ${section('Don\'ts', '<ul style="list-style:none;padding:0;margin:0">' + dontsList + '</ul>')}
</div>`

  c.header('Content-Type', 'text/html; charset=utf-8')
  c.header('Cache-Control', 'no-store')
  return c.body(html)
})

// ═══════════════════════════════════════════════════════════════════════════
// Swatch Gallery — Back navigation
// POST /api/fragment/swatch-gallery — returns gallery grid
// ═══════════════════════════════════════════════════════════════════════════

fragmentRouter.post('/fragment/swatch-gallery', async () => {
  // Returns empty with HX-Trigger to reload the page (simple back navigation)
  return new Response('', { status: 200, headers: { 'Content-Type': 'text/html' } })
})

// ═══════════════════════════════════════════════════════════════════════════
// Dev Feedback Loop — Hash Sentinel Endpoint
// GET /api/fragment/dev-hash — O(1), no KV writes, no compilation
// ═══════════════════════════════════════════════════════════════════════════

fragmentRouter.get('/fragment/dev-hash', async (c) => {
  const TENANT_KV = (c.env as any)?.TENANT_KV
  const env = c.req.query('env')
  const manifestKey = (env === 'staging' || env === 'local') ? 'staging:latest_ast_manifest' : 'latest_ast_manifest'
  const serverHash = await getLatestHash({ kv: TENANT_KV, dev: true, manifestKey })
  const clientHash = c.req.header('X-Current-Hash')

  // Mismatch detected — emit trigger, return updated sentinel
  if (clientHash !== undefined && serverHash !== clientHash) {
    c.header('HX-Trigger', 'ui-schema-mutated')
    const envQ = env === 'staging' ? '?env=staging' : ''
    return c.html(`
      <div id="dev-sentinel"
           hx-get="/api/fragment/dev-hash${envQ}"
           hx-trigger="every 0.5s"
           hx-swap="outerHTML"
           hx-headers='{"X-Current-Hash": "${serverHash}"}'>
      </div>`)
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
    const tool = c.req.query('tool') || 'default'
    const env = c.req.query('env')
    const isStaging = env === 'staging' || env === 'local'
    const layoutSuffix = tool === 'gallery' ? 'gallery' : tool === 'budget' ? 'budget' : tool === 'metrics' ? 'metrics' : 'latest'
    const layoutKey = `tenant:afirmico:layout:${layoutSuffix}${isStaging ? ':staging' : ''}`
    const layout = await TENANT_KV.get(layoutKey, 'json')
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
