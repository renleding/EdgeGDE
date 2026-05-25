     1|/**
     2| * EdgeGDE Mortgage Calculator — OpenPencil Schema Definitions
     3| * HSAES Phase 1: Schema Stabilization
     4| *
     5| * Zod schemas and TypeScript interfaces for the mortgage calculator.
     6| * Source of truth for all layout → runtime data contracts.
     7| *
     8| * @packageDocumentation
     9| */
    10|
    11|import { z } from 'zod'
    12|
    13|// ═══════════════════════════════════════════════════════════════════════════
    14|// Versioning
    15|// ═══════════════════════════════════════════════════════════════════════════
    16|
    17|export const SCHEMA_VERSION = '0.1.0' as const
    18|
    19|// ═══════════════════════════════════════════════════════════════════════════
    20|// Primitive Types
    21|// ═══════════════════════════════════════════════════════════════════════════
    22|
    23|/** Australian dollar amount — must be positive, max $10M */
    24|export const audAmountSchema = z.number()
    25|  .positive('Principal must be a positive number')
    26|  .max(10_000_000, 'Principal exceeds maximum ($10M)')
    27|  .or(z.string().regex(/^\d+(\.\d{1,2})?$/, 'Must be a valid dollar amount'))
    28|
    29|/** Annual interest rate as percentage (e.g. 6.25 = 6.25%) */
    30|export const interestRateSchema = z.number()
    31|  .positive('Interest rate must be positive')
    32|  .max(25, 'Interest rate exceeds maximum (25%)')
    33|
    34|/** Loan term in years */
    35|export const loanTermSchema = z.number()
    36|  .int('Loan term must be a whole number')
    37|  .min(1, 'Minimum loan term is 1 year')
    38|  .max(40, 'Maximum loan term is 40 years')
    39|
    40|// ═══════════════════════════════════════════════════════════════════════════
    41|// Enums
    42|// ═══════════════════════════════════════════════════════════════════════════
    43|
    44|export const RepaymentFrequency = {
    45|  MONTHLY: 'monthly',
    46|  FORTNIGHTLY: 'fortnightly',
    47|  WEEKLY: 'weekly',
    48|} as const
    49|
    50|export const repaymentFrequencySchema = z.enum([
    51|  RepaymentFrequency.MONTHLY,
    52|  RepaymentFrequency.FORTNIGHTLY,
    53|  RepaymentFrequency.WEEKLY,
    54|])
    55|
    56|export type RepaymentFrequency = z.infer<typeof repaymentFrequencySchema>
    57|
    58|export const RateType = {
    59|  FIXED: 'fixed',
    60|  VARIABLE: 'variable',
    61|  SPLIT: 'split',
    62|} as const
    63|
    64|export const rateTypeSchema = z.enum([
    65|  RateType.FIXED,
    66|  RateType.VARIABLE,
    67|  RateType.SPLIT,
    68|])
    69|
    70|export type RateType = z.infer<typeof rateTypeSchema>
    71|
    72|// ═══════════════════════════════════════════════════════════════════════════
    73|// Main Calculator Input Schema
    74|// ═══════════════════════════════════════════════════════════════════════════
    75|
    76|export const mortgageCalculatorInputSchema = z.object({
    77|  /** Schema version for migration safety */
    78|  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
    79|
    80|  /** Total loan amount in AUD */
    81|  principal: audAmountSchema,
    82|
    83|  /** Annual interest rate (percentage) */
    84|  interestRate: interestRateSchema,
    85|
    86|  /** Loan term in years */
    87|  loanTerm: loanTermSchema,
    88|
    89|  /** Repayment frequency */
    90|  repaymentFrequency: repaymentFrequencySchema.default(RepaymentFrequency.MONTHLY),
    91|
    92|  /** Type of interest rate */
    93|  rateType: rateTypeSchema.default(RateType.VARIABLE),
    94|
    95|  /** Fixed rate period in years (required if rateType === 'fixed') */
    96|  fixedRatePeriod: z.number().int().min(1).max(10).optional(),
    97|
    98|  /** Optional additional monthly repayment */
    99|  additionalRepayment: audAmountSchema.optional().default(0),
   100|
   101|  /** Estimated annual fees */
   102|  annualFees: audAmountSchema.optional().default(0),
   103|}).refine(
   104|  (data) => {
   105|    if (data.rateType === RateType.FIXED && !data.fixedRatePeriod) {
   106|      return false
   107|    }
   108|    return true
   109|  },
   110|  {
   111|    message: 'Fixed rate period is required when rate type is fixed',
   112|    path: ['fixedRatePeriod'],
   113|  },
   114|)
   115|
   116|export type MortgageCalculatorInput = z.infer<typeof mortgageCalculatorInputSchema>
   117|
   118|// ═══════════════════════════════════════════════════════════════════════════
   119|// Calculation Result Schema
   120|// ═══════════════════════════════════════════════════════════════════════════
   121|
   122|export const repaymentSummarySchema = z.object({
   123|  /** Monthly repayment amount */
   124|  monthlyRepayment: z.number().nonnegative(),
   125|
   126|  /** Fortnightly repayment amount */
   127|  fortnightlyRepayment: z.number().nonnegative(),
   128|
   129|  /** Weekly repayment amount */
   130|  weeklyRepayment: z.number().nonnegative(),
   131|
   132|  /** Total interest paid over loan term */
   133|  totalInterest: z.number().nonnegative(),
   134|
   135|  /** Total cost of loan (principal + interest + fees) */
   136|  totalCost: z.number().nonnegative(),
   137|
   138|  /** Loan term used in calculation (years) */
   139|  loanTerm: z.number().positive(),
   140|
   141|  /** Number of repayments */
   142|  totalRepayments: z.number().int().positive(),
   143|
   144|  /** Estimated fees over loan term */
   145|  totalFees: z.number().nonnegative(),
   146|})
   147|
   148|export type RepaymentSummary = z.infer<typeof repaymentSummarySchema>
   149|
   150|// ═══════════════════════════════════════════════════════════════════════════
   151|// Amortization Schedule
   152|// ═══════════════════════════════════════════════════════════════════════════
   153|
   154|export const amortizationEntrySchema = z.object({
   155|  /** Payment number */
   156|  period: z.number().int().positive(),
   157|
   158|  /** Repayment amount for this period */
   159|  repayment: z.number().nonnegative(),
   160|
   161|  /** Interest component */
   162|  interest: z.number().nonnegative(),
   163|
   164|  /** Principal component */
   165|  principal: z.number().nonnegative(),
   166|
   167|  /** Remaining balance after this payment */
   168|  remainingBalance: z.number().nonnegative(),
   169|})
   170|
   171|export type AmortizationEntry = z.infer<typeof amortizationEntrySchema>
   172|
   173|export const amortizationScheduleSchema = z.object({
   174|  entries: z.array(amortizationEntrySchema),
   175|  totalEntries: z.number().int().positive(),
   176|})
   177|
   178|export type AmortizationSchedule = z.infer<typeof amortizationScheduleSchema>
   179|
   180|// ═══════════════════════════════════════════════════════════════════════════
   181|// Full Calculator Response
   182|// ═══════════════════════════════════════════════════════════════════════════
   183|
   184|export const calculatorResponseSchema = z.object({
   185|  input: mortgageCalculatorInputSchema,
   186|  summary: repaymentSummarySchema,
   187|  amortizationSchedule: amortizationScheduleSchema.optional(),
   188|  timestamp: z.string().datetime(),
   189|  schemaVersion: z.literal(SCHEMA_VERSION),
   190|})
   191|
   192|export type CalculatorResponse = z.infer<typeof calculatorResponseSchema>
   193|
   194|// ═══════════════════════════════════════════════════════════════════════════
   195|// OpenPencil Layout Node Types (Schema Stabilization)
   196|// ═══════════════════════════════════════════════════════════════════════════
   197|
   198|export const openPencilNodeTypeSchema = z.enum([
   199|  'FRAME',
   200|  'TEXT',
   201|  'RECTANGLE',
   202|  'ELLIPSE',
   203|  'LINE',
   204|  'COMPONENT',
   205|  'INSTANCE',
   206|  'GROUP',
   207|  'VECTOR',
   208|])
   209|
   210|export type OpenPencilNodeType = z.infer<typeof openPencilNodeTypeSchema>
   211|
   212|export const openPencilNodeSchema = z.object({
   213|  id: z.string(),
   214|  type: openPencilNodeTypeSchema,
   215|  name: z.string(),
   216|  x: z.number(),
   217|  y: z.number(),
   218|  width: z.number().positive(),
   219|  height: z.number().positive(),
   220|  children: z.array(z.lazy(() => openPencilNodeSchema)).optional(),
   221|  fills: z.array(z.unknown()).optional(),
   222|  strokes: z.array(z.unknown()).optional(),
   223|  cornerRadius: z.number().optional(),
   224|  opacity: z.number().min(0).max(1).optional(),
   225|  visible: z.boolean().optional().default(true),
   226|})
   227|
   228|export type OpenPencilNode = z.infer<typeof openPencilNodeSchema>
   229|
   230|/** Mortgage calculator form input mapping from design nodes */
   231|export const formFieldSchema = z.object({
   232|  nodeId: z.string(),
   233|  label: z.string(),
   234|  fieldType: z.enum(['text', 'number', 'select', 'slider']),
   235|  placeholder: z.string().optional(),
   236|  defaultValue: z.union([z.string(), z.number()]).optional(),
   237|  required: z.boolean().default(true),
   238|  min: z.number().optional(),
   239|  max: z.number().optional(),
   240|  step: z.number().optional(),
   241|})
   242|
   243|export type FormField = z.infer<typeof formFieldSchema>
   244|
   245|/** Extracted layout definition from OpenPencil design */
   246|export const layoutDefinitionSchema = z.object({
   247|  schemaVersion: z.literal(SCHEMA_VERSION),
   248|  rootNode: openPencilNodeSchema,
   249|  formFields: z.array(formFieldSchema),
   250|  submitButton: z.object({
   251|    nodeId: z.string(),
   252|    label: z.string().default('Calculate'),
   253|  }).optional(),
   254|  resultDisplay: z.object({
   255|    nodeId: z.string(),
   256|    type: z.enum(['table', 'card', 'chart']).default('card'),
   257|  }).optional(),
   258|})
   259|
   260|export type LayoutDefinition = z.infer<typeof layoutDefinitionSchema>
   261|