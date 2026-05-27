/**
 * EdgeGDE Mortgage Calculator — Platform Registry
 * HSAES Phase 5 & 6: Central registry for all calculator tools
 * with KV-backed hydration support.
 *
 * @packageDocumentation
 */

import { z } from 'zod'
import {
  mortgageCalculatorInputSchema,
  SCHEMA_VERSION,
} from '@edgegde/schema'
import { compileLayout } from '../compiler/engine'
import type { KvStore, DesignArtifact } from '../lib/publish'
import type { LayoutDefinition, MortgageCalculatorInput } from '@edgegde/schema'

// ═══════════════════════════════════════════════════════════════════════════
// CalculatorTool Interface
// ═══════════════════════════════════════════════════════════════════════════

export interface CalculatorTool {
  id: string
  schema: z.ZodType<any, any, any>
  layout: LayoutDefinition
  execute: (input: any) => any
  description: string
}

// ═══════════════════════════════════════════════════════════════════════════
// Calculation Result Type
// ═══════════════════════════════════════════════════════════════════════════

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
// Compile-to-HTML Helper
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build a LayoutDefinition from calculation result data and compile it to HTML.
 *
 * Constructs a deterministic LayoutDefinition describing the result display,
 * then delegates to compileLayout for structured HTML generation.
 */
export function compileToHtml(
  result: CalcResult,
  input: MortgageCalculatorInput,
): string {
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
// Calculator Registry
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Central registry for all calculator tools.
 * Maps tool IDs to their CalculatorTool definitions.
 * Mutable at runtime for KV hydration; treat as read-only during operations.
 */
export const CALCULATOR_REGISTRY: Record<string, CalculatorTool> = {
  mortgage: {
    id: 'mortgage',
    description:
      'Calculate mortgage repayments based on Australian lending standards — ' +
      'given principal, interest rate, and loan term, returns monthly, ' +
      'fortnightly, and weekly repayment amounts plus total interest and cost.',
    schema: mortgageCalculatorInputSchema,
    layout: {
      schemaVersion: SCHEMA_VERSION,
      rootNode: {
        id: 'calculator-results',
        type: 'FRAME',
        name: 'Mortgage Calculator Results',
        x: 0,
        y: 0,
        width: 600,
        height: 300,
      },
      formFields: [],
      resultDisplay: {
        nodeId: 'calculator-results',
        type: 'card',
      },
    },
    execute(input: MortgageCalculatorInput): any {
      return calculateMortgage(input)
    },
  },
}