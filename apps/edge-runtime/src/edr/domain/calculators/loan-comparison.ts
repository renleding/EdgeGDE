/**
 * EdgeGDE — Domain: Loan Comparison Calculator
 *
 * Compare two or more loan options side-by-side.
 * Finds the best loan by total cost, monthly repayment, and interest saved.
 *
 * @packageDocumentation
 */

import { z } from 'zod'
import { roundMoney } from '../../../lib/calculator-engine'

const LoanOptionSchema = z.object({
  name: z.string().min(1, 'Loan name is required'),
  principal: z.number().positive('Principal must be positive'),
  interestRate: z.number().min(0, 'Rate must be >= 0').max(25, 'Rate must be <= 25'),
  termYears: z.number().int('Term must be whole years').positive('Term must be positive'),
  feesUpfront: z.number().min(0, 'Upfront fees must be >= 0').default(0),
  feesAnnual: z.number().min(0, 'Annual fees must be >= 0').default(0),
  repaymentFrequency: z.enum(['monthly', 'fortnightly', 'weekly']).default('monthly'),
})

export const LoanComparisonInputSchema = z.object({
  loans: z.array(LoanOptionSchema).min(2, 'At least 2 loans required for comparison'),
}).strict()

export type LoanComparisonInput = z.input<typeof LoanComparisonInputSchema>

interface LoanAnalysis {
  name: string
  monthlyRepayment: number
  totalInterest: number
  totalFees: number
  totalCost: number
}

export interface LoanComparisonOutput {
  bestByTotalCost: string
  bestByMonthlyRepayment: string
  bestByInterestSaved: string
  comparisonTable: LoanAnalysis[]
}

export function calculateLoanComparison(input: LoanComparisonInput): LoanComparisonOutput {
  const loans = input.loans ?? []

  const analyses: LoanAnalysis[] = loans.map((loan) => {
    const principal = loan.principal ?? 0
    const rate = loan.interestRate ?? 0
    const termYears = loan.termYears ?? 1
    const feesUpfront = loan.feesUpfront ?? 0
    const feesAnnual = loan.feesAnnual ?? 0
    const freq = (loan.repaymentFrequency ?? 'monthly') as string
    const periodsPerYear = freq === 'monthly' ? 12 : freq === 'fortnightly' ? 26 : 52

    const r = rate / 100 / periodsPerYear
    const n = termYears * periodsPerYear

    let payment = 0
    if (r === 0) {
      payment = principal / n
    } else {
      const onePlusR = 1 + r
      const powR = Math.pow(onePlusR, n)
      payment = principal * (r * powR) / (powR - 1)
    }

    const totalRepayments = roundMoney(payment * n)
    const totalFees = roundMoney(feesUpfront + feesAnnual * termYears)
    const totalInterest = roundMoney(totalRepayments - principal)
    const totalCost = roundMoney(principal + totalInterest + totalFees)

    return {
      name: loan.name,
      monthlyRepayment: roundMoney(payment * 12 / periodsPerYear),
      totalInterest,
      totalFees,
      totalCost,
    }
  })

  const bestByTotalCost = analyses.reduce((a, b) => a.totalCost <= b.totalCost ? a : b).name
  const bestByMonthlyRepayment = analyses.reduce((a, b) => a.monthlyRepayment <= b.monthlyRepayment ? a : b).name
  const bestByInterestSaved = analyses.reduce((a, b) => a.totalInterest <= b.totalInterest ? a : b).name

  return { bestByTotalCost, bestByMonthlyRepayment, bestByInterestSaved, comparisonTable: analyses }
}
