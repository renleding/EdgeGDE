import { describe, it, expect } from 'vitest'
import {
  LoanComparisonInputSchema,
  calculateLoanComparison,
} from '../../../../src/edr/domain/calculators/loan-comparison'

const TWO_LOANS = [
  { name: 'Loan A', principal: 300000, interestRate: 6, termYears: 30 },
  { name: 'Loan B', principal: 300000, interestRate: 5, termYears: 30 },
]

describe('LoanComparisonInputSchema', () => {
  it('accepts two or more loans', () => {
    expect(LoanComparisonInputSchema.safeParse({ loans: TWO_LOANS }).success).toBe(true)
  })

  it('rejects fewer than two loans', () => {
    expect(LoanComparisonInputSchema.safeParse({ loans: [TWO_LOANS[0]] }).success).toBe(false)
    expect(LoanComparisonInputSchema.safeParse({ loans: [] }).success).toBe(false)
  })

  it('rejects invalid loan options', () => {
    const base = TWO_LOANS[0]
    expect(LoanComparisonInputSchema.safeParse({ loans: [{ ...base, name: '' }, TWO_LOANS[1]] }).success).toBe(false)
    expect(LoanComparisonInputSchema.safeParse({ loans: [{ ...base, principal: 0 }, TWO_LOANS[1]] }).success).toBe(false)
    expect(LoanComparisonInputSchema.safeParse({ loans: [{ ...base, interestRate: 25.01 }, TWO_LOANS[1]] }).success).toBe(false)
    expect(LoanComparisonInputSchema.safeParse({ loans: [{ ...base, termYears: 0 }, TWO_LOANS[1]] }).success).toBe(false)
    expect(LoanComparisonInputSchema.safeParse({ loans: [{ ...base, feesUpfront: -1 }, TWO_LOANS[1]] }).success).toBe(false)
    expect(LoanComparisonInputSchema.safeParse({ loans: [{ ...base, repaymentFrequency: 'daily' }, TWO_LOANS[1]] }).success).toBe(false)
  })

  it('rejects unknown keys on the outer schema', () => {
    expect(LoanComparisonInputSchema.safeParse({ loans: TWO_LOANS, extra: 1 }).success).toBe(false)
  })
})

describe('calculateLoanComparison', () => {
  it('identifies the best loan by total cost, monthly repayment, and interest', () => {
    const r = calculateLoanComparison({
      loans: [
        { name: 'Loan A', principal: 300000, interestRate: 6, termYears: 30 },
        { name: 'Loan B', principal: 300000, interestRate: 5, termYears: 30 },
        { name: 'Loan C', principal: 300000, interestRate: 6, termYears: 30, repaymentFrequency: 'fortnightly' },
      ],
    })
    expect(r.bestByTotalCost).toBe('Loan B')
    expect(r.bestByMonthlyRepayment).toBe('Loan C')
    expect(r.bestByInterestSaved).toBe('Loan B')

    expect(r.comparisonTable).toHaveLength(3)
    const [a, b, c] = r.comparisonTable
    expect(a).toEqual({ name: 'Loan A', monthlyRepayment: 1798.65, totalInterest: 347514.57, totalFees: 0, totalCost: 647514.57 })
    expect(b).toEqual({ name: 'Loan B', monthlyRepayment: 1610.46, totalInterest: 279767.35, totalFees: 0, totalCost: 579767.35 })
    expect(c).toEqual({ name: 'Loan C', monthlyRepayment: 382.96, totalInterest: 347204.22, totalFees: 0, totalCost: 647204.22 })
  })

  it('handles zero-rate loans and fees', () => {
    const r = calculateLoanComparison({
      loans: [
        { name: 'Zero', principal: 12000, interestRate: 0, termYears: 1 },
        { name: 'Fee', principal: 12000, interestRate: 0, termYears: 1, feesUpfront: 100, feesAnnual: 50 },
      ],
    })
    expect(r.bestByTotalCost).toBe('Zero')
    expect(r.bestByMonthlyRepayment).toBe('Zero')
    expect(r.bestByInterestSaved).toBe('Zero')
    expect(r.comparisonTable[0]).toEqual({ name: 'Zero', monthlyRepayment: 1000, totalInterest: 0, totalFees: 0, totalCost: 12000 })
    expect(r.comparisonTable[1]).toEqual({ name: 'Fee', monthlyRepayment: 1000, totalInterest: 0, totalFees: 150, totalCost: 12150 })
  })
})
