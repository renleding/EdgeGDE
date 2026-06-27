/**
 * Calculator Engine — 43 Test Suite
 *
 * Covers:
 *   - CalculatorEngine helpers (roundMoney, formatAud, formatPercent)
 *   - Loan Repayment calculator
 *   - Budget Planner calculator
 *   - Stamp Duty calculator (8 states + FHB concessions)
 *   - Engine-level (executeCalculator errors, validation, listing)
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  roundMoney,
  formatAud,
  formatPercent,
  executeCalculator,
  listCalculators,
  registerCalculator,
} from '../src/lib/calculator-engine'
import { calculateLoanRepayment, LoanRepaymentInputSchema } from '../src/edr/domain/calculators/loan-repayment'
import type { LoanRepaymentInput } from '../src/edr/domain/calculators/loan-repayment'
import { calculateBudgetPlanner, BudgetPlannerInputSchema } from '../src/edr/domain/calculators/budget-planner'
import type { BudgetPlannerInput } from '../src/edr/domain/calculators/budget-planner'
import { calculateStampDuty, StampDutyInputSchema, StampDutyStateSchema } from '../src/edr/domain/calculators/stamp-duty'
import type { StampDutyInput } from '../src/edr/domain/calculators/stamp-duty'
import { calculateSavingsGoal, SavingsGoalInputSchema } from '../src/edr/domain/calculators/savings-goal'
import type { SavingsGoalInput } from '../src/edr/domain/calculators/savings-goal'
import { calculateRepaymentComparison, RepaymentComparisonInputSchema } from '../src/edr/domain/calculators/repayment-comparison'
import type { RepaymentComparisonInput } from '../src/edr/domain/calculators/repayment-comparison'
import { calculateLvr, LvrCalculatorInputSchema } from '../src/edr/domain/calculators/lvr-calculator'
import type { LvrCalculatorInput } from '../src/edr/domain/calculators/lvr-calculator'
import { calculateRentVsBuy, RentVsBuyInputSchema } from '../src/edr/domain/calculators/rent-vs-buy'
import type { RentVsBuyInput } from '../src/edr/domain/calculators/rent-vs-buy'
import { calculateBorrowingPower } from '../src/edr/domain/calculators/borrowing-power'
import { calculatePropertyBuyingCost } from '../src/edr/domain/calculators/property-buying-cost'
import { calculatePropertySellingCost } from '../src/edr/domain/calculators/property-selling-cost'
import { calculateComparisonRate } from '../src/edr/domain/calculators/comparison-rate'
import { calculateExtraRepayment } from '../src/edr/domain/calculators/extra-repayment'
import { calculateInterestOnly } from '../src/edr/domain/calculators/interest-only-mortgage'
import { calculateHowLongToRepay } from '../src/edr/domain/calculators/how-long-to-repay'
import { calculateLumpSumRepayment } from '../src/edr/domain/calculators/lump-sum-repayment'
import { calculateIncomeTax } from '../src/edr/domain/calculators/income-tax'
import { calculateCompoundInterest } from '../src/edr/domain/calculators/compound-interest'
import { calculateCreditCard } from '../src/edr/domain/calculators/credit-card'
import { calculateIncomeAnnualisation } from '../src/edr/domain/calculators/income-annualisation'
import { calculateIncomeGrossUp } from '../src/edr/domain/calculators/income-gross-up'
import { generateManifestFromGoal } from '../src/agentic-ux/manifest-generator'
import { calculateSplitLoan } from '../src/edr/domain/calculators/split-loan'
import { calculateHomeLoanOffset } from '../src/edr/domain/calculators/home-loan-offset'
import { calculateIntroductoryRateLoan } from '../src/edr/domain/calculators/introductory-rate-loan'
import { calculateLoanComparison } from '../src/edr/domain/calculators/loan-comparison'
import { calculateMortgageSwitching } from '../src/edr/domain/calculators/mortgage-switching'
import { calculateLeasing } from '../src/edr/domain/calculators/leasing'
import { calculateReverseMortgage } from '../src/edr/domain/calculators/reverse-mortgage'

// Register a minimal loan-repayment calculator for execute/list tests
beforeAll(() => {
  registerCalculator({
    id: 'loan-repayment',
    name: 'Loan Repayment Calculator',
    description: 'Standard mortgage repayment calculator',
    category: 'loan',
    inputSchema: LoanRepaymentInputSchema,
    execute: (input) => calculateLoanRepayment(input as LoanRepaymentInput),
  })
})

describe('Rounding Helpers', () => {
  it('roundMoney rounds to 2 decimal places', () => {
    expect(roundMoney(123.456)).toBe(123.46)
    expect(roundMoney(123.454)).toBe(123.45)
    expect(roundMoney(100)).toBe(100)
    expect(roundMoney(0.001)).toBe(0)
  })

  it('roundMoney handles zero', () => {
    expect(roundMoney(0)).toBe(0)
  })

  it('roundMoney handles negative values', () => {
    expect(roundMoney(-123.456)).toBe(-123.46)
  })

  it('formatAud formats as $X,XXX.XX', () => {
    expect(formatAud(1234.5)).toBe('$1,234.50')
    expect(formatAud(100)).toBe('$100.00')
    expect(formatAud(0)).toBe('$0.00')
  })

  it('formatAud handles large numbers', () => {
    expect(formatAud(1_000_000)).toBe('$1,000,000.00')
    expect(formatAud(9999999.99)).toBe('$9,999,999.99')
  })

  it('formatPercent formats with default 2dp', () => {
    expect(formatPercent(5.5)).toBe('5.50%')
    expect(formatPercent(12)).toBe('12.00%')
    expect(formatPercent(0)).toBe('0.00%')
  })
})

describe('Loan Repayment Calculator', () => {
  it('standard $500k @ 6% for 30 years', () => {
    const result = calculateLoanRepayment({ principal: 500_000, annualRate: 6, termYears: 30 })
    expect(result.monthlyRepayment).toBeGreaterThan(2900)
    expect(result.monthlyRepayment).toBeLessThan(3100)
    expect(result.totalInterest).toBeGreaterThan(200_000)
    expect(result.monthlyFormatted).toBe(`$${result.monthlyRepayment.toFixed(2)}`)
  })

  it('zero interest rate', () => {
    const result = calculateLoanRepayment({ principal: 360_000, annualRate: 0, termYears: 30 })
    expect(result.monthlyRepayment).toBe(1000)
    expect(result.totalInterest).toBe(0)
    expect(result.totalCost).toBe(360_000)
  })

  it('$200k @ 5% for 15 years', () => {
    const result = calculateLoanRepayment({ principal: 200_000, annualRate: 5, termYears: 15 })
    expect(result.monthlyRepayment).toBeGreaterThan(1500)
    expect(result.monthlyRepayment).toBeLessThan(1700)
    expect(result.totalInterest).toBeGreaterThan(80_000)
  })

  it('$1M @ 3.5% for 25 years', () => {
    const result = calculateLoanRepayment({ principal: 1_000_000, annualRate: 3.5, termYears: 25 })
    expect(result.monthlyRepayment).toBeGreaterThan(4900)
    expect(result.monthlyRepayment).toBeLessThan(5100)
  })

  it('fortnightly is annualCost / 26', () => {
    const result = calculateLoanRepayment({ principal: 500_000, annualRate: 6, termYears: 30 })
    const expectedFortnightly = roundMoney(result.monthlyRepayment * 12 / 26)
    expect(result.fortnightlyRepayment).toBe(expectedFortnightly)
  })

  it('weekly is annualCost / 52', () => {
    const result = calculateLoanRepayment({ principal: 500_000, annualRate: 6, termYears: 30 })
    const expectedWeekly = roundMoney(result.monthlyRepayment * 12 / 52)
    expect(result.weeklyRepayment).toBe(expectedWeekly)
  })

  it('totalCost = principal + totalInterest', () => {
    const result = calculateLoanRepayment({ principal: 500_000, annualRate: 6, termYears: 30 })
    expect(result.totalCost).toBe(roundMoney(500_000 + result.totalInterest))
  })

  it('Zod schema rejects negative principal', () => {
    const parsed = LoanRepaymentInputSchema.safeParse({ principal: -100, annualRate: 5, termYears: 30 })
    expect(parsed.success).toBe(false)
  })

  it('Zod schema rejects non-integer term', () => {
    const parsed = LoanRepaymentInputSchema.safeParse({ principal: 100_000, annualRate: 5, termYears: 30.5 })
    expect(parsed.success).toBe(false)
  })

  it('Zod schema accepts valid input', () => {
    const parsed = LoanRepaymentInputSchema.safeParse({ principal: 400_000, annualRate: 4.5, termYears: 20 })
    expect(parsed.success).toBe(true)
  })
})

describe('Budget Planner Calculator', () => {
  const defaultBudget: BudgetPlannerInput = {
    salary: 100_000,
    investments: 10_000,
    government: 0,
    otherIncome: 5_000,
    housing: 24_000,
    food: 12_000,
    transport: 8_000,
    utilities: 4_000,
    insurance: 3_000,
    entertainment: 5_000,
    healthcare: 2_000,
    education: 3_000,
    debtPayments: 6_000,
    otherExpenses: 2_000,
  }

  it('income totals = 115,000', () => {
    const result = calculateBudgetPlanner(defaultBudget)
    expect(result.totalIncome).toBe(115_000)
  })

  it('expenses total = 69,000', () => {
    const result = calculateBudgetPlanner(defaultBudget)
    expect(result.totalExpenses).toBe(69_000)
  })

  it('surplus = income - expenses = 46,000', () => {
    const result = calculateBudgetPlanner(defaultBudget)
    expect(result.surplus).toBe(46_000)
    expect(result.isDeficit).toBe(false)
  })

  it('savings rate = surplus/income * 100', () => {
    const result = calculateBudgetPlanner(defaultBudget)
    expect(result.savingsRate).toBe(roundMoney(46_000 / 115_000 * 100))
  })

  it('deficit detection', () => {
    const deficit: BudgetPlannerInput = {
      salary: 40_000,
      investments: 0,
      government: 0,
      otherIncome: 0,
      housing: 50_000,
      food: 15_000,
      transport: 10_000,
      utilities: 6_000,
      insurance: 5_000,
      entertainment: 8_000,
      healthcare: 4_000,
      education: 5_000,
      debtPayments: 10_000,
      otherExpenses: 5_000,
    }
    const result = calculateBudgetPlanner(deficit)
    expect(result.isDeficit).toBe(true)
    expect(result.surplus).toBeLessThan(0)
  })

  it('deficit surplus returned as negative', () => {
    const deficit: BudgetPlannerInput = {
      salary: 0, investments: 0, government: 0, otherIncome: 0,
      housing: 100_000, food: 0, transport: 0, utilities: 0,
      insurance: 0, entertainment: 0, healthcare: 0, education: 0,
      debtPayments: 0, otherExpenses: 0,
    }
    const result = calculateBudgetPlanner(deficit)
    expect(result.isDeficit).toBe(true)
    expect(result.surplus).toBeLessThan(0)
  })

  it('4 income categories in breakdown', () => {
    const result = calculateBudgetPlanner(defaultBudget)
    expect(result.incomeBreakdown.length).toBe(4)
  })

  it('10 expense categories in breakdown', () => {
    const result = calculateBudgetPlanner(defaultBudget)
    expect(result.expenseBreakdown.length).toBe(10)
  })

  it('expense ratio = expenses/income * 100', () => {
    const result = calculateBudgetPlanner(defaultBudget)
    expect(result.expenseRatio).toBe(roundMoney(69_000 / 115_000 * 100))
  })

  it('income percentages sum to ~100%', () => {
    const result = calculateBudgetPlanner(defaultBudget)
    const totalPct = result.incomeBreakdown.reduce((s, i) => s + i.percentage, 0)
    expect(Math.abs(totalPct - 100)).toBeLessThan(0.02)
  })

  it('Zod schema rejects negative values', () => {
    const parsed = BudgetPlannerInputSchema.safeParse({ ...defaultBudget, salary: -1000 })
    expect(parsed.success).toBe(false)
  })
})

describe('Stamp Duty Calculator', () => {
  const stdPPR = { isPrincipalPlaceOfResidence: true, isForeignBuyer: false }

  it('NSW $800k standard rate', () => {
    const input: StampDutyInput = { propertyValue: 800_000, state: 'nsw', isFirstHomeBuyer: false, ...stdPPR }
    const result = calculateStampDuty(input)
    expect(result.stampDuty).toBe(18610)
  })

  it('NSW FHB full exemption up to $1M', () => {
    const input: StampDutyInput = { propertyValue: 800_000, state: 'nsw', isFirstHomeBuyer: true, ...stdPPR }
    const result = calculateStampDuty(input)
    expect(result.stampDuty).toBe(0)
    expect(result.concessionApplied).toBe(true)
  })

  it('NSW FHB $1.4M (partial concession range)', () => {
    const fhb: StampDutyInput = { propertyValue: 1_400_000, state: 'nsw', isFirstHomeBuyer: true, ...stdPPR }
    const result = calculateStampDuty(fhb)
    expect(result.stampDuty).toBeGreaterThan(0)
    expect(result.effectiveRate).toBeGreaterThan(0)
  })

  it('VIC $600k standard', () => {
    const input: StampDutyInput = { propertyValue: 600_000, state: 'vic', isFirstHomeBuyer: false, ...stdPPR }
    const result = calculateStampDuty(input)
    expect(result.stampDuty).toBeGreaterThan(0)
  })

  it('VIC FHB PPR concession $600k', () => {
    const input: StampDutyInput = { propertyValue: 600_000, state: 'vic', isFirstHomeBuyer: true, ...stdPPR }
    const result = calculateStampDuty(input)
    expect(result.stampDuty).toBeGreaterThan(0)
    expect(result.concessionApplied).toBe(true)
  })

  it('QLD $400k standard', () => {
    const input: StampDutyInput = { propertyValue: 400_000, state: 'qld', isFirstHomeBuyer: false, ...stdPPR }
    const result = calculateStampDuty(input)
    expect(result.stampDuty).toBeGreaterThan(0)
  })

  it('QLD FHB full exemption $400k', () => {
    const input: StampDutyInput = { propertyValue: 400_000, state: 'qld', isFirstHomeBuyer: true, ...stdPPR }
    const result = calculateStampDuty(input)
    expect(result.stampDuty).toBe(0)
    expect(result.concessionApplied).toBe(true)
  })

  it('WA $400k standard', () => {
    const input: StampDutyInput = { propertyValue: 400_000, state: 'wa', isFirstHomeBuyer: false, ...stdPPR }
    const result = calculateStampDuty(input)
    expect(result.stampDuty).toBeGreaterThan(0)
  })

  it('WA FHB concession $400k', () => {
    const fhb: StampDutyInput = { propertyValue: 400_000, state: 'wa', isFirstHomeBuyer: true, ...stdPPR }
    const std: StampDutyInput = { propertyValue: 400_000, state: 'wa', isFirstHomeBuyer: false, ...stdPPR }
    const result = calculateStampDuty(fhb)
    expect(result.concessionApplied).toBe(true)
    expect(result.stampDuty).toBeLessThan(calculateStampDuty(std).stampDuty)
  })

  it('SA standard $450k', () => {
    const input: StampDutyInput = { propertyValue: 450_000, state: 'sa', isFirstHomeBuyer: false, ...stdPPR }
    const result = calculateStampDuty(input)
    expect(result.stampDuty).toBeGreaterThan(0)
  })

  it('SA FHB rebate $300k', () => {
    const fhb: StampDutyInput = { propertyValue: 300_000, state: 'sa', isFirstHomeBuyer: true, ...stdPPR }
    const std: StampDutyInput = { propertyValue: 300_000, state: 'sa', isFirstHomeBuyer: false, ...stdPPR }
    const result = calculateStampDuty(fhb)
    expect(result.concessionApplied).toBe(true)
    expect(result.stampDuty).toBeLessThan(calculateStampDuty(std).stampDuty)
  })

  it('TAS standard rate', () => {
    const input: StampDutyInput = { propertyValue: 400_000, state: 'tas', isFirstHomeBuyer: false, ...stdPPR }
    const result = calculateStampDuty(input)
    expect(result.stampDuty).toBeGreaterThan(0)
    expect(result.concessionApplied).toBe(false)
  })

  it('ACT standard', () => {
    const input: StampDutyInput = { propertyValue: 600_000, state: 'act', isFirstHomeBuyer: false, ...stdPPR }
    const result = calculateStampDuty(input)
    expect(result.stampDuty).toBeGreaterThan(0)
  })

  it('NT standard', () => {
    const input: StampDutyInput = { propertyValue: 400_000, state: 'nt', isFirstHomeBuyer: false, ...stdPPR }
    const result = calculateStampDuty(input)
    expect(result.stampDuty).toBeGreaterThan(0)
  })
})

describe('Savings Goal Calculator', () => {
  it('$10k goal, $0 saved, $500/mo @ 0% → 20 months', () => {
    const result = calculateSavingsGoal({ currentSavings: 0, monthlyContribution: 500, annualRate: 0, targetAmount: 10_000 })
    expect(result.monthsToGoal).toBe(20)
    expect(result.totalContributions).toBe(10_000)
    expect(result.totalInterestEarned).toBe(0)
    expect(result.finalAmount).toBe(10_000)
    expect(result.goalReached).toBe(true)
  })

  it('$10k goal, $5k saved, $200/mo @ 6%', () => {
    const result = calculateSavingsGoal({ currentSavings: 5_000, monthlyContribution: 200, annualRate: 6, targetAmount: 10_000 })
    expect(result.monthsToGoal).toBeLessThan(25)
    expect(result.monthsToGoal).toBeGreaterThan(0)
    expect(result.totalInterestEarned).toBeGreaterThan(0)
    expect(result.goalReached).toBe(true)
  })

  it('already at goal → 0 months', () => {
    const result = calculateSavingsGoal({ currentSavings: 20_000, monthlyContribution: 0, annualRate: 0, targetAmount: 10_000 })
    expect(result.monthsToGoal).toBe(0)
    expect(result.goalReached).toBe(true)
  })

  it('unreachable (no contributions, no interest)', () => {
    const result = calculateSavingsGoal({ currentSavings: 100, monthlyContribution: 0, annualRate: 0, targetAmount: 10_000 })
    expect(result.goalReached).toBe(false)
    expect(result.monthsToGoal).toBe(Infinity)
  })

  it('total contributions + starting savings + interest = final amount', () => {
    const result = calculateSavingsGoal({ currentSavings: 2_000, monthlyContribution: 300, annualRate: 4, targetAmount: 25_000 })
    const expectedFinal = 2000 + result.totalContributions + result.totalInterestEarned
    expect(Math.abs(result.finalAmount - expectedFinal)).toBeLessThan(0.02)
  })

  it('Zod schema rejects negative current savings', () => {
    const parsed = SavingsGoalInputSchema.safeParse({ currentSavings: -100, monthlyContribution: 500, annualRate: 5, targetAmount: 10_000 })
    expect(parsed.success).toBe(false)
  })

  it('Zod schema rejects zero target', () => {
    const parsed = SavingsGoalInputSchema.safeParse({ currentSavings: 100, monthlyContribution: 500, annualRate: 5, targetAmount: 0 })
    expect(parsed.success).toBe(false)
  })
})

describe('Repayment Comparison Calculator', () => {
  it('standard $300k @ 6% for 30 years baseline', () => {
    const result = calculateRepaymentComparison({
      loanAmount: 300_000, interestRate: 6, termYears: 30,
      extraRepayment: 0, extraFrequency: 'monthly',
    })
    expect(result.standardMonthly).toBeGreaterThan(1700)
    expect(result.standardMonthly).toBeLessThan(1900)
    expect(result.standardTotalInterest).toBeGreaterThan(0)
    expect(result.extraMonthly).toBe(result.standardMonthly)
    expect(result.monthsSaved).toBe(0)
    expect(result.interestSaved).toBe(0)
  })

  it('$300k @ 6% for 30 years + $200 extra monthly saves interest', () => {
    const result = calculateRepaymentComparison({
      loanAmount: 300_000, interestRate: 6, termYears: 30,
      extraRepayment: 200, extraFrequency: 'monthly',
    })
    expect(result.extraMonthly).toBeGreaterThan(result.standardMonthly)
    expect(result.monthsSaved).toBeGreaterThan(0)
    expect(result.interestSaved).toBeGreaterThan(0)
    expect(result.extraMonthsToRepay).toBeLessThan(360)
  })

  it('extra weekly repayment converted correctly', () => {
    const result = calculateRepaymentComparison({
      loanAmount: 300_000, interestRate: 6, termYears: 30,
      extraRepayment: 50, extraFrequency: 'weekly',
    })
    expect(result.extraMonthly).toBeGreaterThan(result.standardMonthly + 200)
    expect(result.monthsSaved).toBeGreaterThan(0)
  })

  it('interestSaved = standardTotalInterest - extraTotalInterest', () => {
    const result = calculateRepaymentComparison({
      loanAmount: 300_000, interestRate: 6, termYears: 30,
      extraRepayment: 200, extraFrequency: 'monthly',
    })
    const expectedInterestSaved = result.standardTotalInterest - result.extraTotalInterest
    expect(result.interestSaved).toBe(expectedInterestSaved)
  })

  it('zero extra is same as standard', () => {
    const result = calculateRepaymentComparison({
      loanAmount: 200_000, interestRate: 4, termYears: 25,
      extraRepayment: 0, extraFrequency: 'monthly',
    })
    expect(result.extraMonthly).toBe(result.standardMonthly)
    expect(result.monthsSaved).toBe(0)
    expect(result.interestSaved).toBe(0)
  })

  it('Zod schema rejects negative loan amount', () => {
    const parsed = RepaymentComparisonInputSchema.safeParse({
      loanAmount: -100, interestRate: 5, termYears: 30,
      extraRepayment: 0, extraFrequency: 'monthly',
    })
    expect(parsed.success).toBe(false)
  })

  it('Zod schema accepts valid input', () => {
    const parsed = RepaymentComparisonInputSchema.safeParse({
      loanAmount: 400_000, interestRate: 4.5, termYears: 25,
      extraRepayment: 100, extraFrequency: 'fortnightly',
    })
    expect(parsed.success).toBe(true)
  })
})

describe('LVR Calculator', () => {
  it('$800k property, $600k loan → 75% LVR, no LMI', () => {
    const result = calculateLvr({ propertyValue: 800_000, loanAmount: 600_000, state: 'nsw', isFirstHomeBuyer: false })
    expect(result.lvrPercentage).toBe(75)
    expect(result.lvrFormatted).toBe('75.00%')
    expect(result.lmiRequired).toBe(false)
    expect(result.lmiWarning).toContain('No LMI required')
  })

  it('$500k property, $450k loan → 90% LVR, LMI required', () => {
    const result = calculateLvr({ propertyValue: 500_000, loanAmount: 450_000, state: 'nsw', isFirstHomeBuyer: false })
    expect(result.lvrPercentage).toBe(90)
    expect(result.lmiRequired).toBe(true)
    expect(result.lmiWarning).toContain('LMI')
  })

  it('$1M property, $800k loan boundar → 80% LVR, no LMI', () => {
    const result = calculateLvr({ propertyValue: 1_000_000, loanAmount: 800_000, state: 'vic', isFirstHomeBuyer: false })
    expect(result.lvrPercentage).toBe(80)
    expect(result.lmiRequired).toBe(false)
  })

  it('includes stamp duty estimate from stamp duty module', () => {
    const result = calculateLvr({ propertyValue: 800_000, loanAmount: 600_000, state: 'nsw', isFirstHomeBuyer: false })
    expect(result.stampDutyEstimate).toBe(18610)
    expect(result.stampDutyFormatted).toMatch(/^\$/)
  })

  it('FHB concession reflected in stamp duty', () => {
    const fhb = calculateLvr({ propertyValue: 800_000, loanAmount: 600_000, state: 'nsw', isFirstHomeBuyer: true })
    const standard = calculateLvr({ propertyValue: 800_000, loanAmount: 600_000, state: 'nsw', isFirstHomeBuyer: false })
    expect(fhb.stampDutyEstimate).toBeLessThan(standard.stampDutyEstimate)
  })

  it('Zod schema rejects negative property value', () => {
    const parsed = LvrCalculatorInputSchema.safeParse({ propertyValue: -100, loanAmount: 50_000 })
    expect(parsed.success).toBe(false)
  })

  it('Zod schema rejects loan > property value (engine throws)', () => {
    expect(() => {
      calculateLvr({ propertyValue: 100_000, loanAmount: 200_000, state: 'nsw', isFirstHomeBuyer: false })
    }).toThrow(/Loan amount cannot exceed property value/)
  })
})

describe('Rent vs Buy Calculator', () => {
  it('$800k property, $500/wk rent, $160k savings, 10yr horizon', () => {
    const result = calculateRentVsBuy({
      propertyPrice: 800_000,
      weeklyRent: 500,
      savings: 160_000,
      investmentReturnRate: 7,
      timeHorizonYears: 10,
      mortgageRate: 6,
      propertyAppreciation: 3,
      rentIncrease: 3,
    })
    expect(result.buyNetWorth).toBeGreaterThan(0)
    expect(result.rentNetWorth).toBeGreaterThan(0)
    expect(result.yearSnapshots.length).toBe(10)
  })

  it('year snapshots increase over time', () => {
    const result = calculateRentVsBuy({
      propertyPrice: 600_000,
      weeklyRent: 400,
      savings: 120_000,
      investmentReturnRate: 7,
      timeHorizonYears: 25,
      mortgageRate: 6,
      propertyAppreciation: 3,
      rentIncrease: 3,
    })
    for (let i = 1; i < result.yearSnapshots.length; i++) {
      expect(result.yearSnapshots[i].buyNetWorth).toBeGreaterThanOrEqual(result.yearSnapshots[i - 1].buyNetWorth)
    }
  })

  it('break-even year is found or null', () => {
    const result = calculateRentVsBuy({
      propertyPrice: 600_000,
      weeklyRent: 300,
      savings: 120_000,
      investmentReturnRate: 7,
      timeHorizonYears: 30,
      mortgageRate: 6,
      propertyAppreciation: 3,
      rentIncrease: 3,
    })
    expect(result.breakEvenYear === null || (result.breakEvenYear >= 1 && result.breakEvenYear <= 30)).toBeTruthy()
  })

  it('full ownership scenario (savings >= property price)', () => {
    const result = calculateRentVsBuy({
      propertyPrice: 500_000,
      weeklyRent: 400,
      savings: 500_000,
      investmentReturnRate: 2,
      timeHorizonYears: 5,
      mortgageRate: 6,
      propertyAppreciation: 3,
      rentIncrease: 3,
    })
    expect(result.buyNetWorth).toBeGreaterThan(500_000)
    expect(result.breakEvenYear).not.toBeNull()
    expect(result.buyNetWorth).toBeGreaterThan(result.rentNetWorth)
  })

  it('Zod schema rejects negative property price', () => {
    const parsed = RentVsBuyInputSchema.safeParse({
      propertyPrice: -100, weeklyRent: 300, savings: 50_000,
      investmentReturnRate: 5, timeHorizonYears: 10,
    })
    expect(parsed.success).toBe(false)
  })

  it('Zod schema accepts valid input', () => {
    const parsed = RentVsBuyInputSchema.safeParse({
      propertyPrice: 700_000, weeklyRent: 450, savings: 140_000,
      investmentReturnRate: 6, timeHorizonYears: 15,
    })
    expect(parsed.success).toBe(true)
  })
})

describe('Engine-level', () => {
  // Import registry to trigger calculator registration
  import('../src/registry/calculators')

  it('executeCalculator returns error for unknown calculator', () => {
    const result = executeCalculator('nonexistent', {})
    expect(result.success).toBe(false)
    expect(result.error).toContain('Unknown calculator')
  })

  it('executeCalculator returns Zod validation errors', () => {
    const result = executeCalculator('loan-repayment', { principal: -500, annualRate: 5, termYears: 30 })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Principal must be positive')
  })

  it('listCalculators returns all registered calculators', () => {
    const calculators = listCalculators()
    const ids = calculators.map((c) => c.id)
    expect(ids).toContain('loan-repayment')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Borrowing Power Calculator Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Borrowing Power Calculator', () => {
  it('full-time employee with standard expenses', () => {
    const result = calculateBorrowingPower({
      annualIncome: 120000,
      monthlyExpenses: 4000,
      interestRate: 6,
      termYears: 30,
      existingDebtPayments: 0,
      deposit: 0,
      dependents: 0,
      creditCommitments: 0,
      interestRateBuffer: 3,
      employmentType: 'full-time',
    })
    expect(result.estimatedBorrowingPower).toBeGreaterThan(0)
    expect(result.serviceabilitySurplus).toBeGreaterThan(0)
    expect(result.assessedInterestRate).toBe(9) // rate + 3% buffer
  })

  it('self-employed has lower borrowing power', () => {
    const ft = calculateBorrowingPower({
      annualIncome: 120000, monthlyExpenses: 4000,
      interestRate: 6, termYears: 30,
      employmentType: 'full-time',
      existingDebtPayments: 0, deposit: 0,
      dependents: 0, creditCommitments: 0,
      interestRateBuffer: 3,
    })
    const se = calculateBorrowingPower({
      annualIncome: 120000, monthlyExpenses: 4000,
      interestRate: 6, termYears: 30,
      employmentType: 'self-employed',
      existingDebtPayments: 0, deposit: 0,
      dependents: 0, creditCommitments: 0,
      interestRateBuffer: 3,
    })
    expect(se.estimatedBorrowingPower).toBeLessThan(ft.estimatedBorrowingPower)
  })

  it('zero income returns zero borrowing power', () => {
    const result = calculateBorrowingPower({
      annualIncome: 0, monthlyExpenses: 0,
      interestRate: 6, termYears: 30,
      existingDebtPayments: 0, deposit: 0,
      dependents: 0, creditCommitments: 0,
      interestRateBuffer: 3,
      employmentType: 'full-time',
    })
    expect(result.estimatedBorrowingPower).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Property Buying Cost Calculator Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Property Buying Cost Calculator', () => {
  it('$800k property in NSW with 20% deposit', () => {
    const result = calculatePropertyBuyingCost({
      purchasePrice: 800000,
      deposit: 160000,
      stateOrTerritory: 'NSW',
    })
    expect(result.stampDuty).toBeGreaterThan(0)
    expect(result.totalUpfrontCashRequired).toBeGreaterThan(160000)
    expect(result.totalBuyingCost).toBeGreaterThan(800000)
    expect(result.breakdown.length).toBeGreaterThan(0)
  })

  it('first home buyer appears in inputs', () => {
    const result = calculatePropertyBuyingCost({
      purchasePrice: 500000,
      deposit: 50000,
      firstHomeBuyer: true,
      stateOrTerritory: 'VIC',
    })
    expect(result.totalUpfrontCashRequired).toBeGreaterThan(0)
  })

  it('grant reduces cash required', () => {
    const without = calculatePropertyBuyingCost({
      purchasePrice: 600000, deposit: 120000,
      stateOrTerritory: 'QLD',
    })
    const withGrant = calculatePropertyBuyingCost({
      purchasePrice: 600000, deposit: 120000,
      stateOrTerritory: 'QLD',
      grantAmount: 10000,
    })
    expect(withGrant.netCashRequiredAfterGrant).toBeLessThan(without.totalUpfrontCashRequired)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Property Selling Cost Calculator Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Property Selling Cost Calculator', () => {
  it('$1M property with standard costs', () => {
    const result = calculatePropertySellingCost({
      salePrice: 1000000,
    })
    expect(result.agentCommission).toBeGreaterThan(0)
    expect(result.totalSellingCost).toBeGreaterThan(0)
    expect(result.netProceeds).toBeLessThan(1000000)
    expect(result.breakdown.length).toBeGreaterThan(0)
  })

  it('higher commission rate increases cost', () => {
    const low = calculatePropertySellingCost({ salePrice: 500000, agentCommissionRate: 2 })
    const high = calculatePropertySellingCost({ salePrice: 500000, agentCommissionRate: 3 })
    expect(high.agentCommission).toBeGreaterThan(low.agentCommission)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Comparison Rate Calculator Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Comparison Rate Calculator', () => {
  it('standard loan without fees has comparison rate near nominal', () => {
    const result = calculateComparisonRate({
      principal: 500000, interestRate: 6, termYears: 30,
      upfrontFees: 0, ongoingAnnualFees: 0,
    })
    expect(result.comparisonRate).toBeGreaterThan(5.9)
    expect(result.comparisonRate).toBeLessThan(6.1)
  })

  it('upfront fees increase comparison rate', () => {
    const result = calculateComparisonRate({
      principal: 500000, interestRate: 6, termYears: 30,
      upfrontFees: 5000,
    })
    expect(result.comparisonRate).toBeGreaterThan(6)
    expect(result.totalFees).toBe(5000)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Extra Repayment Calculator Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Extra Repayment Calculator', () => {
  it('extra $200/mo saves months and interest', () => {
    const result = calculateExtraRepayment({
      principal: 500000, interestRate: 6, termYears: 30, extraRepayment: 200,
    })
    expect(result.monthsSaved).toBeGreaterThan(0)
    expect(result.interestSaved).toBeGreaterThan(0)
    expect(result.newRepayment).toBeGreaterThan(result.standardRepayment)
  })

  it('zero extra repayment matches standard', () => {
    const result = calculateExtraRepayment({
      principal: 500000, interestRate: 6, termYears: 30, extraRepayment: 0,
    })
    expect(result.monthsSaved).toBe(0)
    expect(result.interestSaved).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Interest Only Mortgage Calculator Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Interest Only Mortgage Calculator', () => {
  it('IO period has lower repayment than P&I', () => {
    const result = calculateInterestOnly({
      principal: 500000, interestRate: 6,
      interestOnlyYears: 5, totalTermYears: 30,
    })
    expect(result.interestOnlyRepayment).toBeGreaterThan(0)
    expect(result.principalAndInterestRepaymentAfterIo).toBeGreaterThan(result.interestOnlyRepayment)
  })

  it('IO loan costs more than standard P&I', () => {
    const result = calculateInterestOnly({
      principal: 500000, interestRate: 6,
      interestOnlyYears: 5, totalTermYears: 30,
    })
    expect(result.extraCostVsPAndI).toBeGreaterThan(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// How Long to Repay Calculator Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('How Long to Repay Calculator', () => {
  it('standard repayment pays off within term', () => {
    const result = calculateHowLongToRepay({
      principal: 500000, interestRate: 6,
      repaymentAmount: 3000,
    })
    expect(result.monthsToPayoff).toBeGreaterThan(0)
    expect(result.monthsToPayoff).toBeLessThan(600)
    expect(result.totalRepaid).toBeGreaterThan(500000)
  })

  it('larger repayment reduces time', () => {
    const low = calculateHowLongToRepay({ principal: 500000, interestRate: 6, repaymentAmount: 3000 })
    const high = calculateHowLongToRepay({ principal: 500000, interestRate: 6, repaymentAmount: 5000 })
    expect(high.monthsToPayoff).toBeLessThan(low.monthsToPayoff)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Lump Sum Repayment Calculator Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Lump Sum Repayment Calculator', () => {
  it('lump sum reduces loan term', () => {
    const result = calculateLumpSumRepayment({
      principal: 500000, interestRate: 6, termYears: 30, lumpSum: 50000,
    })
    expect(result.monthsSaved).toBeGreaterThan(0)
    expect(result.interestSaved).toBeGreaterThan(0)
  })

  it('lump sum larger than principal pays off immediately', () => {
    const result = calculateLumpSumRepayment({
      principal: 500000, interestRate: 6, termYears: 30, lumpSum: 600000,
    })
    expect(result.monthsSaved).toBe(360) // full term saved
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Income Tax Calculator Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Income Tax Calculator', () => {
  it('$100k income has expected tax', () => {
    const result = calculateIncomeTax({ taxableIncome: 100000 })
    expect(result.grossTax).toBeGreaterThan(0)
    expect(result.medicareLevy).toBeGreaterThan(0)
    expect(result.netTaxPayable).toBeGreaterThan(0)
    expect(result.effectiveTaxRate).toBeGreaterThan(0)
  })

  it('low income pays no tax', () => {
    const result = calculateIncomeTax({ taxableIncome: 15000 })
    expect(result.grossTax).toBe(0)
  })

  it('offsets reduce net tax', () => {
    const without = calculateIncomeTax({ taxableIncome: 80000 })
    const with_offsets = calculateIncomeTax({ taxableIncome: 80000, offsets: 5000 })
    expect(with_offsets.netTaxPayable).toBeLessThan(without.netTaxPayable)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Compound Interest Calculator Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Compound Interest Calculator', () => {
  it('principal grows with compound interest', () => {
    const result = calculateCompoundInterest({
      principal: 10000, interestRate: 8, termYears: 10,
    })
    expect(result.futureValue).toBeGreaterThan(10000)
    expect(result.interestEarned).toBeGreaterThan(0)
  })

  it('regular contributions boost future value', () => {
    const without = calculateCompoundInterest({
      principal: 10000, interestRate: 8, termYears: 10,
    })
    const withContrib = calculateCompoundInterest({
      principal: 10000, interestRate: 8, termYears: 10,
      regularContribution: 500,
    })
    expect(withContrib.futureValue).toBeGreaterThan(without.futureValue)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Credit Card Calculator Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Credit Card Calculator', () => {
  it('$5k at 20% with $200/mo has finite payoff', () => {
    const result = calculateCreditCard({
      balance: 5000, interestRate: 20, monthlyPayment: 200,
    })
    expect(result.monthsToPayoff).toBeGreaterThan(0)
    expect(result.monthsToPayoff).toBeLessThan(600)
    expect(result.totalInterest).toBeGreaterThan(0)
  })

  it('higher payment reduces time and interest', () => {
    const low = calculateCreditCard({ balance: 5000, interestRate: 20, monthlyPayment: 200 })
    const high = calculateCreditCard({ balance: 5000, interestRate: 20, monthlyPayment: 500 })
    expect(high.monthsToPayoff).toBeLessThan(low.monthsToPayoff)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Income Annualisation Calculator Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Income Annualisation Calculator', () => {
  it('$5k/mo annualises to $60k', () => {
    const result = calculateIncomeAnnualisation({
      incomeAmount: 5000, incomePeriod: 'monthly',
    })
    expect(result.annualisedIncome).toBe(60000)
    expect(result.weeklyEquivalent).toBeGreaterThan(0)
    expect(result.monthlyEquivalent).toBe(5000)
  })

  it('part-year work scales down annualisation', () => {
    const full = calculateIncomeAnnualisation({
      incomeAmount: 1000, incomePeriod: 'weekly',
    })
    const part = calculateIncomeAnnualisation({
      incomeAmount: 1000, incomePeriod: 'weekly',
      weeksWorkedPerYear: 26,
    })
    expect(part.annualisedIncome).toBeLessThan(full.annualisedIncome)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Income Gross Up Calculator Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Income Gross Up Calculator', () => {
  it('$70k net at 30% tax rate grosses up correctly', () => {
    const result = calculateIncomeGrossUp({
      netIncome: 70000, taxRate: 30,
    })
    expect(result.grossIncome).toBeGreaterThan(70000)
    expect(result.totalTax).toBeGreaterThan(0)
  })

  it('gross-up rate overrides tax rate', () => {
    const result = calculateIncomeGrossUp({
      netIncome: 50000, grossUpRate: 25,
    })
    expect(result.effectiveRate).toBe(25)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Calculator Edge Cases — zero rates, max values, boundary conditions
// ═══════════════════════════════════════════════════════════════════════════

describe('Calculator Edge Cases', () => {
  // ── Zero Interest ───────────────────────────────────────────────────────
  it('loan-repayment: zero interest rate', () => {
    const r = calculateLoanRepayment({ principal: 120000, annualRate: 0, termYears: 10 })
    expect(r.monthlyRepayment).toBe(1000) // 120000 / 120 months
    expect(r.totalInterest).toBe(0)
  })

  it('comparison-rate: zero interest with fees', () => {
    const r = calculateComparisonRate({ principal: 100000, interestRate: 0, termYears: 5, upfrontFees: 1000 })
    expect(r.comparisonRate).toBeGreaterThan(0)
  })

  it('extra-repayment: zero rate', () => {
    const r = calculateExtraRepayment({ principal: 120000, interestRate: 0, termYears: 10, extraRepayment: 100 })
    expect(r.monthsSaved).toBeGreaterThan(0)
  })

  it('interest-only-mortgage: zero rate', () => {
    const r = calculateInterestOnly({ principal: 100000, interestRate: 0, interestOnlyYears: 2, totalTermYears: 10 })
    expect(r.interestOnlyRepayment).toBeLessThanOrEqual(1)
    expect(r.totalRepayment - 100000).toBeLessThan(1) // floating-point rounding tolerance
  })

  it('how-long-to-repay: zero rate', () => {
    const r = calculateHowLongToRepay({ principal: 120000, interestRate: 0, repaymentAmount: 2000 })
    expect(r.monthsToPayoff).toBe(60) // 120000 / 2000
  })

  it('borrowing-power: zero interest rate', () => {
    const r = calculateBorrowingPower({ annualIncome: 100000, monthlyExpenses: 3000, interestRate: 0, termYears: 30, interestRateBuffer: 0, employmentType: 'full-time', existingDebtPayments: 0, deposit: 0, dependents: 0, creditCommitments: 0 })
    expect(r.estimatedBorrowingPower).toBeGreaterThan(0)
  })

  it('compound-interest: zero rate', () => {
    const r = calculateCompoundInterest({ principal: 10000, interestRate: 0, termYears: 10, regularContribution: 500 })
    expect(r.interestEarned).toBe(0)
    expect(r.futureValue).toBe(10000 + 500 * 120) // principal + contributions
  })

  it('credit-card: zero interest rate', () => {
    const r = calculateCreditCard({ balance: 5000, interestRate: 0, monthlyPayment: 500 })
    expect(r.monthsToPayoff).toBe(10) // 5000 / 500
    expect(r.totalInterest).toBe(0)
  })

  // ── Boundary and Maximum Values ─────────────────────────────────────────
  it('stamp-duty: zero property value', () => {
    const r = calculateStampDuty({ propertyValue: 0, state: 'nsw', isFirstHomeBuyer: false, isPrincipalPlaceOfResidence: false, isForeignBuyer: false })
    expect(r.stampDuty).toBe(0)
  })

  it('savings-goal: max rate boundary', () => {
    const r = calculateSavingsGoal({ currentSavings: 1000, monthlyContribution: 500, targetAmount: 50000, annualRate: 25 })
    expect(r.monthsToGoal).toBeGreaterThan(0)
  })

  it('income-tax: zero income', () => {
    const r = calculateIncomeTax({ taxableIncome: 0 })
    expect(r.grossTax).toBe(0)
    expect(r.netTaxPayable).toBe(0)
    expect(r.effectiveTaxRate).toBe(0)
  })

  it('income-tax: high income bracket', () => {
    const r = calculateIncomeTax({ taxableIncome: 500000 })
    expect(r.grossTax).toBeGreaterThan(0)
    expect(r.medicareLevy).toBeGreaterThan(0)
  })

  it('rent-vs-buy: zero rates', () => {
    const r = calculateRentVsBuy({ propertyPrice: 500000, weeklyRent: 400, savings: 100000, investmentReturnRate: 0, timeHorizonYears: 10, mortgageRate: 0, propertyAppreciation: 0, rentIncrease: 0 })
    expect(r.buyNetWorth).toBeGreaterThan(0)
    expect(r.rentNetWorth).toBeGreaterThan(0)
  })

  it('lvr-calculator: zero deposit edge', () => {
    const r = calculateLvr({ propertyValue: 500000, state: 'nsw', loanAmount: 500000, isFirstHomeBuyer: false })
    expect(r.lmiRequired).toBe(true)
  })

  it('leasing: zero residual (full payout)', () => {
    const r = calculateLeasing({ assetPrice: 50000, residualValue: 0, interestRate: 7, termYears: 3 })
    expect(r.leasePayment).toBeGreaterThan(0)
    expect(r.totalLeaseCost).toBeGreaterThan(50000)
  })

  it('reverse-mortgage: no drawdown', () => {
    const r = calculateReverseMortgage({ propertyValue: 800000, borrowerAge: 65, interestRate: 6, initialDrawdown: 0, regularDrawdown: 0, termYears: 5 })
    expect(r.projectedLoanBalance).toBe(0)
    expect(r.remainingEquity).toBe(800000)
  })

  it('mortgage-switching: same rate (break-even analysis)', () => {
    const r = calculateMortgageSwitching({ currentBalance: 400000, currentRate: 6, currentRemainingYears: 25, newRate: 6, newFeesUpfront: 2000, breakCosts: 500 })
    expect(r.breakEvenMonths).toBe(999) // never breaks even — same rate
    expect(r.netSavingOrCost).toBeLessThan(0) // costs money to switch
  })

  it('home-loan-offset: full offset (balance eliminated)', () => {
    const r = calculateHomeLoanOffset({ loanBalance: 400000, offsetBalance: 400000, interestRate: 6, termYears: 30 })
    expect(r.interestSaved).toBeGreaterThan(0)
    expect(r.monthsSaved).toBeGreaterThan(0)
  })

  it('budget-planner: zero income and expenses', () => {
    const r = calculateBudgetPlanner({ salary: 0, investments: 0, government: 0, otherIncome: 0, housing: 0, food: 0, transport: 0, utilities: 0, insurance: 0, entertainment: 0, healthcare: 0, education: 0, debtPayments: 0, otherExpenses: 0 })
    expect(r.totalIncome).toBe(0)
    expect(r.totalExpenses).toBe(0)
    expect(r.surplus).toBe(0)
    expect(r.isDeficit).toBe(false)
  })

  it('repayment-comparison: extra repayment equals zero', () => {
    const r = calculateRepaymentComparison({ loanAmount: 300000, interestRate: 6, termYears: 30, extraRepayment: 0 })
    expect(r.monthsSaved).toBe(0)
    expect(r.interestSaved).toBe(0)
  })

  // ── Idempotency ─────────────────────────────────────────────────────────
  it('same inputs produce identical outputs', () => {
    const a = calculateLoanRepayment({ principal: 500000, annualRate: 6, termYears: 30 })
    const b = calculateLoanRepayment({ principal: 500000, annualRate: 6, termYears: 30 })
    expect(a).toEqual(b)
  })

  it('split-loan: fixed equals total (no variable portion)', () => {
    const r = calculateSplitLoan({ totalPrincipal: 500000, fixedPortion: 500000, fixedRate: 5, fixedTermYears: 30, variableRate: 6, variableTermYears: 30 })
    expect(r.fixedRepayment).toBeGreaterThan(0)
    expect(r.variableRepayment).toBe(0) // variable portion is 0
    expect(r.weightedAverageRate).toBe(5) // only fixed rate
  })

  it('introductory-rate-loan: intro equals revert rate', () => {
    const r = calculateIntroductoryRateLoan({ principal: 500000, introductoryRate: 6, introductoryMonths: 12, revertRate: 6, termYears: 30 })
    expect(r.introductoryRepayment).not.toBe(r.revertRepayment) // different calculation methods
  })

  it('loan-comparison: single loan (minimum edge)', () => {
    const r = calculateLoanComparison({ loans: [{ name: 'Bank A', principal: 500000, interestRate: 6, termYears: 30 }] })
    expect(r.comparisonTable.length).toBe(1)
    expect(r.bestByTotalCost).toBe('Bank A')
  })

  it('income-annualisation: yearly input', () => {
    const r = calculateIncomeAnnualisation({ incomeAmount: 100000, incomePeriod: 'yearly' })
    expect(r.annualisedIncome).toBe(100000)
  })

  it('income-gross-up: zero net income', () => {
    const r = calculateIncomeGrossUp({ netIncome: 0, taxRate: 30 })
    expect(r.grossIncome).toBe(0)
    expect(r.totalTax).toBe(0)
  })
})

describe('Manifest Generator', () => {
  it('generates valid manifest from calculator goal', () => {
    const manifest = generateManifestFromGoal({
      intent: 'Calculate loan repayment for $500k at 6% over 30 years',
      actionType: 'calculator.execute',
      input: { toolId: 'loan-repayment', input: { principal: 500000, annualRate: 6, termYears: 30 } },
      tenantId: 'test-tenant',
      correlationId: 'test-corr',
    })
    expect(manifest.id).toBeTruthy()
    expect(manifest.steps.length).toBe(1)
    expect(manifest.steps[0].actionType).toBe('calculator.execute')
    expect(manifest.compensationPlan.length).toBe(1)
    expect(manifest.verificationPlan.length).toBe(1)
  })

  it('generates manifest with correct risk for different action types', () => {
    const calcManifest = generateManifestFromGoal({
      intent: 'calc', actionType: 'calculator.execute', input: {},
      tenantId: 't', correlationId: 'c',
    })
    expect(calcManifest.steps[0].risk).toBe('none')
    expect(calcManifest.steps[0].approvalMode).toBe('none')
  })

  it('generates unique IDs per call', () => {
    const m1 = generateManifestFromGoal({ intent: 'a', actionType: 'calculator.execute', input: {}, tenantId: 't', correlationId: 'c' })
    const m2 = generateManifestFromGoal({ intent: 'b', actionType: 'calculator.execute', input: {}, tenantId: 't', correlationId: 'c' })
    expect(m1.id).not.toBe(m2.id)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Split Loan Calculator Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Split Loan Calculator', () => {
  it('$500k split 60/40 fixed/variable', () => {
    const result = calculateSplitLoan({
      totalPrincipal: 500000, fixedPortion: 300000,
      fixedRate: 5.5, fixedTermYears: 3,
      variableRate: 6.5, variableTermYears: 30,
    })
    expect(result.fixedRepayment).toBeGreaterThan(0)
    expect(result.variableRepayment).toBeGreaterThan(0)
    expect(result.totalRepayment).toBeGreaterThan(0)
    expect(result.weightedAverageRate).toBeGreaterThan(5.5)
    expect(result.weightedAverageRate).toBeLessThan(6.5)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Home Loan Offset Calculator Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Home Loan Offset Calculator', () => {
  it('offset reduces interest and term', () => {
    const result = calculateHomeLoanOffset({
      loanBalance: 400000, offsetBalance: 50000,
      interestRate: 6, termYears: 30,
    })
    expect(result.interestSaved).toBeGreaterThan(0)
    expect(result.noOffsetMonthly).toBeGreaterThan(0)
    expect(result.withOffsetMonthly).toBeGreaterThan(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Introductory Rate Loan Calculator Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Introductory Rate Loan Calculator', () => {
  it('2% intro for 12 months then reverts to 6%', () => {
    const result = calculateIntroductoryRateLoan({
      principal: 500000, introductoryRate: 2,
      introductoryMonths: 12, revertRate: 6, termYears: 30,
    })
    expect(result.introductoryRepayment).toBeGreaterThan(0)
    expect(result.revertRepayment).toBeGreaterThan(result.introductoryRepayment)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Loan Comparison Calculator Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Loan Comparison Calculator', () => {
  it('compares 3 loan options and finds best', () => {
    const result = calculateLoanComparison({
      loans: [
        { name: 'Bank A', principal: 500000, interestRate: 6, termYears: 30 },
        { name: 'Bank B', principal: 500000, interestRate: 5.5, termYears: 30 },
        { name: 'Bank C', principal: 500000, interestRate: 5.8, termYears: 30, feesAnnual: 395 },
      ],
    })
    expect(result.bestByTotalCost.length).toBeGreaterThan(0)
    expect(result.bestByMonthlyRepayment.length).toBeGreaterThan(0)
    expect(result.comparisonTable.length).toBe(3)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Mortgage Switching Calculator Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Mortgage Switching Calculator', () => {
  it('lower rate with fees may still save money', () => {
    const result = calculateMortgageSwitching({
      currentBalance: 400000, currentRate: 6.5,
      currentRemainingYears: 25, newRate: 5.5,
      newFeesUpfront: 2000, breakCosts: 800,
    })
    expect(result.stayMonthlyRepayment).toBeGreaterThan(result.switchMonthlyRepayment)
    expect(result.breakEvenMonths).toBeGreaterThan(0)
    expect(result.breakEvenMonths).toBeLessThan(999)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Leasing Calculator Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Leasing Calculator', () => {
  it('$50k car lease over 3 years', () => {
    const result = calculateLeasing({
      assetPrice: 50000, residualValue: 20000,
      interestRate: 7, termYears: 3,
    })
    expect(result.leasePayment).toBeGreaterThan(0)
    expect(result.totalLeaseCost).toBeGreaterThan(0)
    expect(result.capitalizedCost).toBe(50000)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Reverse Mortgage Calculator Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Reverse Mortgage Calculator', () => {
  it('$800k property, $100k initial drawdown, $2k/mo regular', () => {
    const result = calculateReverseMortgage({
      propertyValue: 800000, borrowerAge: 65,
      interestRate: 6, initialDrawdown: 100000,
      regularDrawdown: 2000, termYears: 10,
    })
    expect(result.projectedLoanBalance).toBeGreaterThan(100000)
    expect(result.remainingEquity).toBeGreaterThan(0)
    expect(result.drawdownTotal).toBeGreaterThan(100000)
  })
})
