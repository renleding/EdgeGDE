/**
 * EdgeGDE Mortgage Calculator — Schema Validation Tests
 * HSAES Phase 1: TDD — tests must fail before implementation is verified.
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'bun:test'
import {
  mortgageCalculatorInputSchema,
  repaymentSummarySchema,
  calculatorResponseSchema,
  layoutDefinitionSchema,
  SCHEMA_VERSION,
  RateType,
  RepaymentFrequency,
} from '@edgegde/schema'

// ═══════════════════════════════════════════════════════════════════════════
// Mortgage Calculator Input Validation
// ═══════════════════════════════════════════════════════════════════════════

describe('MortgageCalculatorInput', () => {
  const validInput = {
    schemaVersion: SCHEMA_VERSION,
    principal: 500000,
    interestRate: 6.25,
    loanTerm: 30,
  }

  it('accepts a valid input with defaults', () => {
    const result = mortgageCalculatorInputSchema.safeParse(validInput)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.repaymentFrequency).toBe(RepaymentFrequency.MONTHLY)
      expect(result.data.rateType).toBe(RateType.VARIABLE)
      expect(result.data.additionalRepayment).toBe(0)
    }
  })

  it('accepts string-based principal amounts', () => {
    const input = { ...validInput, principal: '500000' }
    const result = mortgageCalculatorInputSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('rejects negative principal', () => {
    const result = mortgageCalculatorInputSchema.safeParse({
      ...validInput,
      principal: -100,
    })
    expect(result.success).toBe(false)
  })

  it('rejects principal over $10M', () => {
    const result = mortgageCalculatorInputSchema.safeParse({
      ...validInput,
      principal: 99_000_000,
    })
    expect(result.success).toBe(false)
  })

  it('rejects zero interest rate', () => {
    const result = mortgageCalculatorInputSchema.safeParse({
      ...validInput,
      interestRate: 0,
    })
    expect(result.success).toBe(false)
  })

  it('rejects interest rate over 25%', () => {
    const result = mortgageCalculatorInputSchema.safeParse({
      ...validInput,
      interestRate: 30,
    })
    expect(result.success).toBe(false)
  })

  it('rejects loan term under 1 year', () => {
    const result = mortgageCalculatorInputSchema.safeParse({
      ...validInput,
      loanTerm: 0,
    })
    expect(result.success).toBe(false)
  })

  it('rejects loan term over 40 years', () => {
    const result = mortgageCalculatorInputSchema.safeParse({
      ...validInput,
      loanTerm: 50,
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-integer loan term', () => {
    const result = mortgageCalculatorInputSchema.safeParse({
      ...validInput,
      loanTerm: 25.5,
    })
    expect(result.success).toBe(false)
  })

  it('accepts all repayment frequencies', () => {
    for (const freq of Object.values(RepaymentFrequency)) {
      const result = mortgageCalculatorInputSchema.safeParse({
        ...validInput,
        repaymentFrequency: freq,
      })
      expect(result.success).toBe(true)
    }
  })

  it('rejects invalid repayment frequency', () => {
    const result = mortgageCalculatorInputSchema.safeParse({
      ...validInput,
      repaymentFrequency: 'yearly',
    })
    expect(result.success).toBe(false)
  })

  it('requires fixedRatePeriod when rateType is fixed', () => {
    const result = mortgageCalculatorInputSchema.safeParse({
      ...validInput,
      rateType: RateType.FIXED,
    })
    expect(result.success).toBe(false)
  })

  it('accepts fixed rate with period', () => {
    const result = mortgageCalculatorInputSchema.safeParse({
      ...validInput,
      rateType: RateType.FIXED,
      fixedRatePeriod: 3,
    })
    expect(result.success).toBe(true)
  })

  it('accepts split rate type', () => {
    const result = mortgageCalculatorInputSchema.safeParse({
      ...validInput,
      rateType: RateType.SPLIT,
    })
    expect(result.success).toBe(true)
  })

  it('accepts additional repayment', () => {
    const result = mortgageCalculatorInputSchema.safeParse({
      ...validInput,
      additionalRepayment: 500,
    })
    expect(result.success).toBe(true)
  })

  it('rejects string in numeric field', () => {
    const result = mortgageCalculatorInputSchema.safeParse({
      ...validInput,
      loanTerm: 'thirty',
    })
    expect(result.success).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Repayment Summary Validation
// ═══════════════════════════════════════════════════════════════════════════

describe('RepaymentSummary', () => {
  const validSummary = {
    monthlyRepayment: 3078.59,
    fortnightlyRepayment: 1420.89,
    weeklyRepayment: 710.44,
    totalInterest: 608292.40,
    totalCost: 1108292.40,
    loanTerm: 30,
    totalRepayments: 360,
    totalFees: 0,
  }

  it('accepts a valid repayment summary', () => {
    const result = repaymentSummarySchema.safeParse(validSummary)
    expect(result.success).toBe(true)
  })

  it('rejects negative repayment', () => {
    const result = repaymentSummarySchema.safeParse({
      ...validSummary,
      monthlyRepayment: -100,
    })
    expect(result.success).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Calculator Response Validation
// ═══════════════════════════════════════════════════════════════════════════

describe('CalculatorResponse', () => {
  const validResponse = {
    input: {
      schemaVersion: SCHEMA_VERSION,
      principal: 500000,
      interestRate: 6.25,
      loanTerm: 30,
    },
    summary: {
      monthlyRepayment: 3078.59,
      fortnightlyRepayment: 1420.89,
      weeklyRepayment: 710.44,
      totalInterest: 608292.40,
      totalCost: 1108292.40,
      loanTerm: 30,
      totalRepayments: 360,
      totalFees: 0,
    },
    timestamp: '2026-05-25T00:00:00.000Z',
    schemaVersion: SCHEMA_VERSION,
  }

  it('accepts a valid full response', () => {
    const result = calculatorResponseSchema.safeParse(validResponse)
    expect(result.success).toBe(true)
  })

  it('rejects mismatched schema version', () => {
    const result = calculatorResponseSchema.safeParse({
      ...validResponse,
      schemaVersion: '0.2.0',
    })
    expect(result.success).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// OpenPencil Layout Definition Validation
// ═══════════════════════════════════════════════════════════════════════════

describe('LayoutDefinition', () => {
  const validLayout = {
    schemaVersion: SCHEMA_VERSION,
    rootNode: {
      id: '0:1',
      type: 'FRAME',
      name: 'Mortgage Calculator',
      x: 0,
      y: 0,
      width: 400,
      height: 600,
      children: [
        {
          id: '0:2',
          type: 'TEXT',
          name: 'Title',
          x: 20,
          y: 20,
          width: 360,
          height: 40,
        },
      ],
    },
    formFields: [
      {
        nodeId: '0:3',
        label: 'Loan Amount',
        fieldType: 'number',
        placeholder: 'Enter amount',
        required: true,
      },
    ],
  }

  it('accepts a valid layout definition', () => {
    const result = layoutDefinitionSchema.safeParse(validLayout)
    expect(result.success).toBe(true)
  })

  it('rejects missing rootNode', () => {
    const { rootNode, ...rest } = validLayout
    const result = layoutDefinitionSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('rejects invalid schema version', () => {
    const result = layoutDefinitionSchema.safeParse({
      ...validLayout,
      schemaVersion: '9.9.9',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid node type', () => {
    const result = layoutDefinitionSchema.safeParse({
      ...validLayout,
      rootNode: { ...validLayout.rootNode, type: 'INVALID_TYPE' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing form fields', () => {
    const result = layoutDefinitionSchema.safeParse({
      ...validLayout,
      formFields: [],
    })
    expect(result.success).toBe(true) // empty form fields are valid — no required inputs
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Version Mismatch Detection
// ═══════════════════════════════════════════════════════════════════════════

describe('Version Mismatch', () => {
  it('rejects outdated schema versions in input', () => {
    const result = mortgageCalculatorInputSchema.safeParse({
      schemaVersion: '0.0.1',
      principal: 500000,
      interestRate: 6.25,
      loanTerm: 30,
    })
    expect(result.success).toBe(false)
  })

  it('rejects future unknown schema versions', () => {
    const result = mortgageCalculatorInputSchema.safeParse({
      schemaVersion: '99.0.0',
      principal: 500000,
      interestRate: 6.25,
      loanTerm: 30,
    })
    expect(result.success).toBe(false)
  })
})
