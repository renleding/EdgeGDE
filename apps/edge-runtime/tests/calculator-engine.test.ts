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

import { describe, it, expect } from 'vitest'
import {
  roundMoney,
  formatAud,
  formatPercent,
  executeCalculator,
  listCalculators,
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
    expect(ids).toContain('budget-planner')
    expect(ids).toContain('stamp-duty')
    expect(ids).toContain('savings-goal')
    expect(ids).toContain('repayment-comparison')
    expect(ids).toContain('lvr-calculator')
    expect(ids).toContain('rent-vs-buy')
  })
})
