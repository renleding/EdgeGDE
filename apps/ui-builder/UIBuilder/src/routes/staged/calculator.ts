/**
 * EdgeGDE Mortgage Calculator — Hono Route Handler
 * HSAES Phase 3: Mortgage calculation, Zod validation, content negotiation.
 *
 * Mounted under /api → actual path POST /api/calc/mortgage
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import { z } from 'zod'
import {
  mortgageCalculatorInputSchema,
  SCHEMA_VERSION,
} from '@/schemas/openpencil'
import { compileLayout } from '../../compiler/engine'
import type { LayoutDefinition, MortgageCalculatorInput } from '@/schemas/openpencil'

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/** Raw input before Zod validation */
interface RawInput {
  principal?: unknown
  interestRate?: unknown
  loanTerm?: unknown
  repaymentFrequency?: unknown
  rateType?: unknown
  fixedRatePeriod?: unknown
  additionalRepayment?: unknown
}

/** Calculation result */
interface CalcResult {
  monthlyRepayment: number
  fortnightlyRepayment: number
  weeklyRepayment: number
  totalInterest: number
  totalCost: number
  nccpWarning: string
}

// ═══════════════════════════════════════════════════════════════════════════
// Mortgage Calculation Engine
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Standard Australian mortgage formula:
 *   M = P * [r(1 + r)^n] / [(1 + r)^n - 1]
 *
 * Where:
 *   P = principal
 *   r = monthly interest rate (annualRate / 12 / 100)
 *   n = total number of monthly payments (loanTerm * 12)
 */
function calculateMortgage(input: MortgageCalculatorInput): CalcResult {
  const P = typeof input.principal === 'string'
    ? parseFloat(input.principal)
    : (input.principal as number)
  const annualRate = input.interestRate as number
  const termYears = input.loanTerm as number

  const r = annualRate / 12 / 100
  const n = termYears * 12

  let monthlyRepayment: number

  if (r === 0) {
    // Zero interest: simple amortization
    monthlyRepayment = P / n
  } else {
    const onePlusR = 1 + r
    const powR = Math.pow(onePlusR, n)
    monthlyRepayment = P * (r * powR) / (powR - 1)
  }

  // Round to 2 decimal places
  monthlyRepayment = Math.round(monthlyRepayment * 100) / 100

  // Derive fortnightly and weekly from annual cost
  const annualCost = monthlyRepayment * 12
  const fortnightlyRepayment = Math.round((annualCost / 26) * 100) / 100
  const weeklyRepayment = Math.round((annualCost / 52) * 100) / 100

  // Total interest and cost
  const totalRepayments = monthlyRepayment * n
  const totalInterest = Math.round((totalRepayments - P) * 100) / 100
  const totalCost = Math.round((P + totalInterest) * 100) / 100

  // NCCP comparison rate warning (Australian responsible lending)
  const nccpWarning =
    'This calculation is an estimate only. The comparison rate is based on the ' +
    'secured loan amount and term shown. Your actual repayment amount may vary ' +
    'based on your individual circumstances, fees, and changes to interest rates. ' +
    'This is not financial advice. Consider seeking independent financial advice ' +
    'before committing to a loan.'

  return {
    monthlyRepayment,
    fortnightlyRepayment,
    weeklyRepayment,
    totalInterest,
    totalCost,
    nccpWarning,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Compile-to-HTML Wrapper
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Deterministic HTML generation from calculation results.
 * Wraps compileLayout by building a LayoutDefinition that represents
 * the result display, then delegates to compileLayout for structure.
 */
function compileToHtml(result: CalcResult, input: MortgageCalculatorInput): string {
  const labelValuePairs: [string, string][] = [
    ['Monthly Repayment', `$${result.monthlyRepayment.toFixed(2)}`],
    ['Fortnightly Repayment', `$${result.fortnightlyRepayment.toFixed(2)}`],
    ['Weekly Repayment', `$${result.weeklyRepayment.toFixed(2)}`],
    ['Total Interest', `$${result.totalInterest.toFixed(2)}`],
    ['Total Cost', `$${result.totalCost.toFixed(2)}`],
    ['Loan Amount', `$${typeof input.principal === 'string' ? input.principal : (input.principal as number).toFixed(2)}`],
    ['Interest Rate', `${input.interestRate}%`],
    ['Loan Term', `${input.loanTerm} years`],
    ['NCCP Warning', result.nccpWarning],
  ]

  // Build result display text nodes
  const resultChildren = labelValuePairs.map(([label, value], idx) => ({
    id: `result-${idx}`,
    type: 'TEXT' as const,
    name: `${label}: ${value}`,
    x: 10,
    y: 10 + idx * 32,
    width: 560,
    height: 28,
  }))

  const resultLayout: LayoutDefinition = {
    schemaVersion: SCHEMA_VERSION,
    rootNode: {
      id: 'calculator-results',
      type: 'FRAME',
      name: 'Mortgage Calculator Results',
      x: 0,
      y: 0,
      width: 600,
      height: labelValuePairs.length * 32 + 20,
      children: resultChildren,
    },
    formFields: [],
    resultDisplay: {
      nodeId: 'calculator-results',
      type: 'card',
    },
  }

  return compileLayout(resultLayout)
}

// ═══════════════════════════════════════════════════════════════════════════
// Error formatter
// ═══════════════════════════════════════════════════════════════════════════

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
// Route: POST /calc/mortgage (mounted under /api)
// ═══════════════════════════════════════════════════════════════════════════

export const router = new Hono()

router.post('/calc/mortgage', async (c) => {
  // ── Parse body ──────────────────────────────────────────────────────────
  let raw: RawInput
  try {
    raw = (await c.req.json()) as RawInput
  } catch {
    return c.json(
      { error: 'Invalid JSON body', details: 'Request body must be valid JSON' },
      400,
    )
  }

  // ── Validate with Zod ───────────────────────────────────────────────────
  const parsed = mortgageCalculatorInputSchema.safeParse(raw)

  if (!parsed.success) {
    return c.json(
      {
        error: 'Validation failed',
        details: formatZodError(parsed.error),
      },
      400,
    )
  }

  const input = parsed.data

  // ── Compute ─────────────────────────────────────────────────────────────
  const result = calculateMortgage(input)

  // ── Content negotiation ─────────────────────────────────────────────────
  const accept = c.req.header('Accept') || ''

  if (accept.includes('application/json')) {
    // Return raw JSON
    return c.json({
      input,
      summary: {
        monthlyRepayment: result.monthlyRepayment,
        fortnightlyRepayment: result.fortnightlyRepayment,
        weeklyRepayment: result.weeklyRepayment,
        totalInterest: result.totalInterest,
        totalCost: result.totalCost,
        totalRepayments: (input.loanTerm as number) * 12,
        loanTerm: input.loanTerm,
        totalFees: 0,
      },
      timestamp: new Date().toISOString(),
      schemaVersion: SCHEMA_VERSION,
    })
  }

  // Return HTML for browser / HTMX
  const html = compileToHtml(result, input)
  return c.html(html)
})
