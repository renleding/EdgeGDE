     1|/**
     2| * EdgeGDE Mortgage Calculator — Hono Route Handler
     3| * HSAES Phase 3: Mortgage calculation, Zod validation, content negotiation.
     4| *
     5| * Mounted under /api → actual path POST /api/calc/mortgage
     6| *
     7| * @packageDocumentation
     8| */
     9|
    10|import { Hono } from 'hono'
    11|import { z } from 'zod'
    12|import {
    13|  mortgageCalculatorInputSchema,
    14|  SCHEMA_VERSION,
    15|} from '@/schemas/openpencil'
    16|import { compileLayout } from '../../compiler/engine'
    17|import type { LayoutDefinition, MortgageCalculatorInput } from '@/schemas/openpencil'
    18|
    19|// ═══════════════════════════════════════════════════════════════════════════
    20|// Types
    21|// ═══════════════════════════════════════════════════════════════════════════
    22|
    23|/** Raw input before Zod validation */
    24|interface RawInput {
    25|  principal?: unknown
    26|  interestRate?: unknown
    27|  loanTerm?: unknown
    28|  repaymentFrequency?: unknown
    29|  rateType?: unknown
    30|  fixedRatePeriod?: unknown
    31|  additionalRepayment?: unknown
    32|}
    33|
    34|/** Calculation result */
    35|interface CalcResult {
    36|  monthlyRepayment: number
    37|  fortnightlyRepayment: number
    38|  weeklyRepayment: number
    39|  totalInterest: number
    40|  totalCost: number
    41|  nccpWarning: string
    42|}
    43|
    44|// ═══════════════════════════════════════════════════════════════════════════
    45|// Mortgage Calculation Engine
    46|// ═══════════════════════════════════════════════════════════════════════════
    47|
    48|/**
    49| * Standard Australian mortgage formula:
    50| *   M = P * [r(1 + r)^n] / [(1 + r)^n - 1]
    51| *
    52| * Where:
    53| *   P = principal
    54| *   r = monthly interest rate (annualRate / 12 / 100)
    55| *   n = total number of monthly payments (loanTerm * 12)
    56| */
    57|function calculateMortgage(input: MortgageCalculatorInput): CalcResult {
    58|  const P = typeof input.principal === 'string'
    59|    ? parseFloat(input.principal)
    60|    : (input.principal as number)
    61|  const annualRate = input.interestRate as number
    62|  const termYears = input.loanTerm as number
    63|
    64|  const r = annualRate / 12 / 100
    65|  const n = termYears * 12
    66|
    67|  let monthlyRepayment: number
    68|
    69|  if (r === 0) {
    70|    // Zero interest: simple amortization
    71|    monthlyRepayment = P / n
    72|  } else {
    73|    const onePlusR = 1 + r
    74|    const powR = Math.pow(onePlusR, n)
    75|    monthlyRepayment = P * (r * powR) / (powR - 1)
    76|  }
    77|
    78|  // Round to 2 decimal places
    79|  monthlyRepayment = Math.round(monthlyRepayment * 100) / 100
    80|
    81|  // Derive fortnightly and weekly from annual cost
    82|  const annualCost = monthlyRepayment * 12
    83|  const fortnightlyRepayment = Math.round((annualCost / 26) * 100) / 100
    84|  const weeklyRepayment = Math.round((annualCost / 52) * 100) / 100
    85|
    86|  // Total interest and cost
    87|  const totalRepayments = monthlyRepayment * n
    88|  const totalInterest = Math.round((totalRepayments - P) * 100) / 100
    89|  const totalCost = Math.round((P + totalInterest) * 100) / 100
    90|
    91|  // NCCP comparison rate warning (Australian responsible lending)
    92|  const nccpWarning =
    93|    'This calculation is an estimate only. The comparison rate is based on the ' +
    94|    'secured loan amount and term shown. Your actual repayment amount may vary ' +
    95|    'based on your individual circumstances, fees, and changes to interest rates. ' +
    96|    'This is not financial advice. Consider seeking independent financial advice ' +
    97|    'before committing to a loan.'
    98|
    99|  return {
   100|    monthlyRepayment,
   101|    fortnightlyRepayment,
   102|    weeklyRepayment,
   103|    totalInterest,
   104|    totalCost,
   105|    nccpWarning,
   106|  }
   107|}
   108|
   109|// ═══════════════════════════════════════════════════════════════════════════
   110|// Compile-to-HTML Wrapper
   111|// ═══════════════════════════════════════════════════════════════════════════
   112|
   113|/**
   114| * Deterministic HTML generation from calculation results.
   115| * Wraps compileLayout by building a LayoutDefinition that represents
   116| * the result display, then delegates to compileLayout for structure.
   117| */
   118|function compileToHtml(result: CalcResult, input: MortgageCalculatorInput): string {
   119|  const labelValuePairs: [string, string][] = [
   120|    ['Monthly Repayment', `$${result.monthlyRepayment.toFixed(2)}`],
   121|    ['Fortnightly Repayment', `$${result.fortnightlyRepayment.toFixed(2)}`],
   122|    ['Weekly Repayment', `$${result.weeklyRepayment.toFixed(2)}`],
   123|    ['Total Interest', `$${result.totalInterest.toFixed(2)}`],
   124|    ['Total Cost', `$${result.totalCost.toFixed(2)}`],
   125|    ['Loan Amount', `$${typeof input.principal === 'string' ? input.principal : (input.principal as number).toFixed(2)}`],
   126|    ['Interest Rate', `${input.interestRate}%`],
   127|    ['Loan Term', `${input.loanTerm} years`],
   128|    ['NCCP Warning', result.nccpWarning],
   129|  ]
   130|
   131|  // Build result display text nodes
   132|  const resultChildren = labelValuePairs.map(([label, value], idx) => ({
   133|    id: `result-${idx}`,
   134|    type: 'TEXT' as const,
   135|    name: `${label}: ${value}`,
   136|    x: 10,
   137|    y: 10 + idx * 32,
   138|    width: 560,
   139|    height: 28,
   140|  }))
   141|
   142|  const resultLayout: LayoutDefinition = {
   143|    schemaVersion: SCHEMA_VERSION,
   144|    rootNode: {
   145|      id: 'calculator-results',
   146|      type: 'FRAME',
   147|      name: 'Mortgage Calculator Results',
   148|      x: 0,
   149|      y: 0,
   150|      width: 600,
   151|      height: labelValuePairs.length * 32 + 20,
   152|      children: resultChildren,
   153|    },
   154|    formFields: [],
   155|    resultDisplay: {
   156|      nodeId: 'calculator-results',
   157|      type: 'card',
   158|    },
   159|  }
   160|
   161|  return compileLayout(resultLayout)
   162|}
   163|
   164|// ═══════════════════════════════════════════════════════════════════════════
   165|// Error formatter
   166|// ═══════════════════════════════════════════════════════════════════════════
   167|
   168|interface ValidationError {
   169|  field: string
   170|  message: string
   171|}
   172|
   173|function formatZodError(error: z.ZodError): ValidationError[] {
   174|  return error.issues.map((issue) => ({
   175|    field: issue.path.join('.'),
   176|    message: issue.message,
   177|  }))
   178|}
   179|
   180|// ═══════════════════════════════════════════════════════════════════════════
   181|// Route: POST /calc/mortgage (mounted under /api)
   182|// ═══════════════════════════════════════════════════════════════════════════
   183|
   184|export const router = new Hono()
   185|
   186|router.post('/calc/mortgage', async (c) => {
   187|  // ── Parse body ──────────────────────────────────────────────────────────
   188|  let raw: RawInput
   189|  try {
   190|    raw = (await c.req.json()) as RawInput
   191|  } catch {
   192|    return c.json(
   193|      { error: 'Invalid JSON body', details: 'Request body must be valid JSON' },
   194|      400,
   195|    )
   196|  }
   197|
   198|  // ── Validate with Zod ───────────────────────────────────────────────────
   199|  const parsed = mortgageCalculatorInputSchema.safeParse(raw)
   200|
   201|  if (!parsed.success) {
   202|    return c.json(
   203|      {
   204|        error: 'Validation failed',
   205|        details: formatZodError(parsed.error),
   206|      },
   207|      400,
   208|    )
   209|  }
   210|
   211|  const input = parsed.data
   212|
   213|  // ── Compute ─────────────────────────────────────────────────────────────
   214|  const result = calculateMortgage(input)
   215|
   216|  // ── Content negotiation ─────────────────────────────────────────────────
   217|  const accept = c.req.header('Accept') || ''
   218|
   219|  if (accept.includes('application/json')) {
   220|    // Return raw JSON
   221|    return c.json({
   222|      input,
   223|      summary: {
   224|        monthlyRepayment: result.monthlyRepayment,
   225|        fortnightlyRepayment: result.fortnightlyRepayment,
   226|        weeklyRepayment: result.weeklyRepayment,
   227|        totalInterest: result.totalInterest,
   228|        totalCost: result.totalCost,
   229|        totalRepayments: (input.loanTerm as number) * 12,
   230|        loanTerm: input.loanTerm,
   231|        totalFees: 0,
   232|      },
   233|      timestamp: new Date().toISOString(),
   234|      schemaVersion: SCHEMA_VERSION,
   235|    })
   236|  }
   237|
   238|  // Return HTML for browser / HTMX
   239|  const html = compileToHtml(result, input)
   240|  return c.html(html)
   241|})
   242|