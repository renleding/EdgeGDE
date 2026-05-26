/**
 * EdgeGDE Mortgage Calculator — OpenPencil Schema Definitions
 * HSAES Phase 1: Schema Stabilization
 *
 * Zod schemas and TypeScript interfaces for the mortgage calculator.
 * Source of truth for all layout -> runtime data contracts.
 *
 * @packageDocumentation
 */

import { z } from 'zod'

// ═══════════════════════════════════════════════════════════════════════════
// Versioning
// ═══════════════════════════════════════════════════════════════════════════

export const SCHEMA_VERSION = '0.1.0' as const

// ═══════════════════════════════════════════════════════════════════════════
// Primitive Types
// ═══════════════════════════════════════════════════════════════════════════

/** Australian dollar amount — must be positive, max $10M */
export const audAmountSchema = z.number()
  .positive('Principal must be a positive number')
  .max(10_000_000, 'Principal exceeds maximum ($10M)')
  .or(z.string().regex(/^\d+(\.\d{1,2})?$/, 'Must be a valid dollar amount'))

/** Australian dollar amount that allows zero (for fees, additional repayments) */
export const audNonNegativeSchema = z.number()
  .nonnegative('Amount must be non-negative')
  .max(10_000_000, 'Amount exceeds maximum ($10M)')
  .or(z.string().regex(/^\d+(\.\d{1,2})?$/, 'Must be a valid dollar amount'))

/** Annual interest rate as percentage (e.g. 6.25 = 6.25%) */
export const interestRateSchema = z.number()
  .positive('Interest rate must be positive')
  .max(25, 'Interest rate exceeds maximum (25%)')

/** Loan term in years */
export const loanTermSchema = z.number()
  .int('Loan term must be a whole number')
  .min(1, 'Minimum loan term is 1 year')
  .max(40, 'Maximum loan term is 40 years')

// ═══════════════════════════════════════════════════════════════════════════
// Enums
// ═══════════════════════════════════════════════════════════════════════════

export const RepaymentFrequency = {
  MONTHLY: 'monthly',
  FORTNIGHTLY: 'fortnightly',
  WEEKLY: 'weekly',
} as const

export const repaymentFrequencySchema = z.enum([
  RepaymentFrequency.MONTHLY,
  RepaymentFrequency.FORTNIGHTLY,
  RepaymentFrequency.WEEKLY,
])

export type RepaymentFrequency = z.infer<typeof repaymentFrequencySchema>

export const RateType = {
  FIXED: 'fixed',
  VARIABLE: 'variable',
  SPLIT: 'split',
} as const

export const rateTypeSchema = z.enum([
  RateType.FIXED,
  RateType.VARIABLE,
  RateType.SPLIT,
])

export type RateType = z.infer<typeof rateTypeSchema>

// ═══════════════════════════════════════════════════════════════════════════
// Main Calculator Input Schema
// ═══════════════════════════════════════════════════════════════════════════

export const mortgageCalculatorInputSchema = z.object({
  /** Schema version for migration safety */
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),

  /** Total loan amount in AUD */
  principal: audAmountSchema,

  /** Annual interest rate (percentage) */
  interestRate: interestRateSchema,

  /** Loan term in years */
  loanTerm: loanTermSchema,

  /** Repayment frequency */
  repaymentFrequency: repaymentFrequencySchema.default(RepaymentFrequency.MONTHLY),

  /** Type of interest rate */
  rateType: rateTypeSchema.default(RateType.VARIABLE),

  /** Fixed rate period in years (required if rateType === 'fixed') */
  fixedRatePeriod: z.number().int().min(1).max(10).optional(),

  /** Optional additional monthly repayment */
  additionalRepayment: audNonNegativeSchema.optional().default(0),

  /** Estimated annual fees */
  annualFees: audNonNegativeSchema.optional().default(0),
}).refine(
  (data) => {
    if (data.rateType === RateType.FIXED && !data.fixedRatePeriod) {
      return false
    }
    return true
  },
  {
    message: 'Fixed rate period is required when rate type is fixed',
    path: ['fixedRatePeriod'],
  },
)

export type MortgageCalculatorInput = z.infer<typeof mortgageCalculatorInputSchema>

// ═══════════════════════════════════════════════════════════════════════════
// Calculation Result Schema
// ═══════════════════════════════════════════════════════════════════════════

export const repaymentSummarySchema = z.object({
  /** Monthly repayment amount */
  monthlyRepayment: z.number().nonnegative(),

  /** Fortnightly repayment amount */
  fortnightlyRepayment: z.number().nonnegative(),

  /** Weekly repayment amount */
  weeklyRepayment: z.number().nonnegative(),

  /** Total interest paid over loan term */
  totalInterest: z.number().nonnegative(),

  /** Total cost of loan (principal + interest + fees) */
  totalCost: z.number().nonnegative(),

  /** Loan term used in calculation (years) */
  loanTerm: z.number().positive(),

  /** Number of repayments */
  totalRepayments: z.number().int().positive(),

  /** Estimated fees over loan term */
  totalFees: z.number().nonnegative(),
})

export type RepaymentSummary = z.infer<typeof repaymentSummarySchema>

// ═══════════════════════════════════════════════════════════════════════════
// Amortization Schedule
// ═══════════════════════════════════════════════════════════════════════════

export const amortizationEntrySchema = z.object({
  /** Payment number */
  period: z.number().int().positive(),

  /** Repayment amount for this period */
  repayment: z.number().nonnegative(),

  /** Interest component */
  interest: z.number().nonnegative(),

  /** Principal component */
  principal: z.number().nonnegative(),

  /** Remaining balance after this payment */
  remainingBalance: z.number().nonnegative(),
})

export type AmortizationEntry = z.infer<typeof amortizationEntrySchema>

export const amortizationScheduleSchema = z.object({
  entries: z.array(amortizationEntrySchema),
  totalEntries: z.number().int().positive(),
})

export type AmortizationSchedule = z.infer<typeof amortizationScheduleSchema>

// ═══════════════════════════════════════════════════════════════════════════
// Full Calculator Response
// ═══════════════════════════════════════════════════════════════════════════

export const calculatorResponseSchema = z.object({
  input: mortgageCalculatorInputSchema,
  summary: repaymentSummarySchema,
  amortizationSchedule: amortizationScheduleSchema.optional(),
  timestamp: z.string().datetime(),
  schemaVersion: z.literal(SCHEMA_VERSION),
})

export type CalculatorResponse = z.infer<typeof calculatorResponseSchema>

// ═══════════════════════════════════════════════════════════════════════════
// OpenPencil Layout Node Types (Schema Stabilization)
// ═══════════════════════════════════════════════════════════════════════════

export const openPencilNodeTypeSchema = z.enum([
  'FRAME',
  'TEXT',
  'RECTANGLE',
  'ELLIPSE',
  'LINE',
  'COMPONENT',
  'INSTANCE',
  'GROUP',
  'VECTOR',
])

export type OpenPencilNodeType = z.infer<typeof openPencilNodeTypeSchema>

export const openPencilNodeSchema = z.object({
  id: z.string(),
  type: openPencilNodeTypeSchema,
  name: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  children: z.array(z.lazy(() => openPencilNodeSchema)).optional(),
  fills: z.array(z.unknown()).optional(),
  strokes: z.array(z.unknown()).optional(),
  cornerRadius: z.number().optional(),
  opacity: z.number().min(0).max(1).optional(),
  visible: z.boolean().optional().default(true),
})

export type OpenPencilNode = z.infer<typeof openPencilNodeSchema>

/** Mortgage calculator form input mapping from design nodes */
export const formFieldSchema = z.object({
  nodeId: z.string(),
  label: z.string(),
  fieldType: z.enum(['text', 'number', 'select', 'slider']),
  placeholder: z.string().optional(),
  defaultValue: z.union([z.string(), z.number()]).optional(),
  required: z.boolean().default(true),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
})

export type FormField = z.infer<typeof formFieldSchema>

/** Extracted layout definition from OpenPencil design */
export const layoutDefinitionSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  rootNode: openPencilNodeSchema,
  formFields: z.array(formFieldSchema),
  submitButton: z.object({
    nodeId: z.string(),
    label: z.string().default('Calculate'),
  }).optional(),
  resultDisplay: z.object({
    nodeId: z.string(),
    type: z.enum(['table', 'card', 'chart']).default('card'),
  }).optional(),
})

export type LayoutDefinition = z.infer<typeof layoutDefinitionSchema>
