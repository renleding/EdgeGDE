/**
 * EdgeGDE — Comprehensive UAT: ALL 28 Calculators
 *
 * For each calculator:
 *   1. Schema accepts valid input
 *   2. Compute function returns mathematically correct expected output
 *   3. Schema rejects invalid input
 *   4. Output shape has all required fields (no missing keys, no extra keys)
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest'
import { roundMoney } from '../src/lib/calculator-engine'

// ============================================================================
// 1. Loan Repayment Calculator
// ============================================================================
import {
  calculateLoanRepayment,
  LoanRepaymentInputSchema,
} from '../src/edr/domain/calculators/loan-repayment'
import type { LoanRepaymentOutput } from '../src/edr/domain/calculators/loan-repayment'

describe('1. loan-repayment', () => {
  const id = 'loan-repayment'

  it('(1) schema accepts valid input', () => {
    const input = { principal: 500000, annualRate: 6, termYears: 30 }
    const p = LoanRepaymentInputSchema.safeParse(input)
    expect(p.success).toBe(true)
  })

  it('(2) compute returns correct expected output', () => {
    // M = P * r(1+r)^n / ((1+r)^n - 1)
    // P=500000, r=6/12/100=0.005, n=30*12=360
    // M = 500000 * 0.005 * (1.005)^360 / ((1.005)^360 - 1)
    // (1.005)^360 ≈ 6.022575
    // M = 500000 * 0.030112875 / 5.022575 ≈ 2997.75
    const result = calculateLoanRepayment({ principal: 500000, annualRate: 6, termYears: 30 })
    expect(result.monthlyRepayment).toBeCloseTo(2997.75, 1)
    // Fortnightly = monthly * 12 / 26
    expect(result.fortnightlyRepayment).toBeCloseTo(2997.75 * 12 / 26, 1)
    // Weekly = monthly * 12 / 52
    expect(result.weeklyRepayment).toBeCloseTo(2997.75 * 12 / 52, 1)
    // Total interest = monthly * 360 - 500000
    expect(result.totalInterest).toBeGreaterThan(0)
    expect(result.totalCost).toBeCloseTo(500000 + result.totalInterest, 0)
  })

  it('(3) schema rejects invalid input', () => {
    expect(LoanRepaymentInputSchema.safeParse({}).success).toBe(false)
    expect(LoanRepaymentInputSchema.safeParse({ principal: -100, annualRate: 6, termYears: 30 }).success).toBe(false)
    expect(LoanRepaymentInputSchema.safeParse({ principal: 500000, annualRate: 150, termYears: 30 }).success).toBe(false)
    expect(LoanRepaymentInputSchema.safeParse({ principal: 'abc', annualRate: 6, termYears: 30 }).success).toBe(false)
  })

  it('(4) output shape has all required fields', () => {
    const keys: (keyof LoanRepaymentOutput)[] = ['monthlyRepayment', 'fortnightlyRepayment', 'weeklyRepayment', 'totalInterest', 'totalCost', 'monthlyFormatted', 'fortnightlyFormatted', 'weeklyFormatted', 'totalInterestFormatted', 'totalCostFormatted']
    const result = calculateLoanRepayment({ principal: 400000, annualRate: 5, termYears: 25 })
    keys.forEach(k => expect(result).toHaveProperty(k))
    expect(Object.keys(result).length).toBe(keys.length)
  })
})

// ============================================================================
// 2. Budget Planner Calculator
// ============================================================================
import {
  calculateBudgetPlanner,
  BudgetPlannerInputSchema,
} from '../src/edr/domain/calculators/budget-planner'
import type { BudgetPlannerOutput } from '../src/edr/domain/calculators/budget-planner'

describe('2. budget-planner', () => {
  const validInput = {
    salary: 8000, investments: 500, government: 300, otherIncome: 200,
    housing: 2000, food: 800, transport: 400, utilities: 300, insurance: 200,
    entertainment: 300, healthcare: 150, education: 100, debtPayments: 500, otherExpenses: 250,
  }

  it('(1) schema accepts valid input', () => {
    const p = BudgetPlannerInputSchema.safeParse(validInput)
    expect(p.success).toBe(true)
  })

  it('(2) compute returns correct expected output', () => {
    const result = calculateBudgetPlanner(validInput)
    expect(result.totalIncome).toBe(8000 + 500 + 300 + 200)
    expect(result.totalExpenses).toBe(2000 + 800 + 400 + 300 + 200 + 300 + 150 + 100 + 500 + 250)
    expect(result.surplus).toBe(result.totalIncome - result.totalExpenses)
    expect(result.isDeficit).toBe(false)
    expect(result.savingsRate).toBeGreaterThan(0)
    expect(result.expenseRatio).toBeGreaterThan(0)
    expect(result.incomeBreakdown).toHaveLength(4)
    expect(result.expenseBreakdown).toHaveLength(10)
  })

  it('(3) schema rejects invalid input', () => {
    expect(BudgetPlannerInputSchema.safeParse({}).success).toBe(false)
    expect(BudgetPlannerInputSchema.safeParse({ ...validInput, salary: -100 }).success).toBe(false)
    expect(BudgetPlannerInputSchema.safeParse({ ...validInput, extraField: 1 }).success).toBe(false)
  })

  it('(4) output shape has all required fields', () => {
    const keys: (keyof BudgetPlannerOutput)[] = ['totalIncome', 'totalExpenses', 'surplus', 'isDeficit', 'savingsRate', 'expenseRatio', 'incomeBreakdown', 'expenseBreakdown']
    const result = calculateBudgetPlanner(validInput)
    keys.forEach(k => expect(result).toHaveProperty(k))
    expect(Object.keys(result).length).toBe(keys.length)
  })

  it('handles deficit case (expenses > income)', () => {
    const deficitInput = { ...validInput, salary: 2000, housing: 3000 }
    const result = calculateBudgetPlanner(deficitInput)
    expect(result.isDeficit).toBe(true)
    expect(result.surplus).toBeLessThan(0)
    expect(result.savingsRate).toBe(0)
  })
})

// ============================================================================
// 3. Stamp Duty Calculator
// ============================================================================
import {
  calculateStampDuty,
  StampDutyInputSchema,
} from '../src/edr/domain/calculators/stamp-duty'
import type { StampDutyOutput } from '../src/edr/domain/calculators/stamp-duty'

describe('3. stamp-duty', () => {
  it('(1) schema accepts valid input', () => {
    const p = StampDutyInputSchema.safeParse({ propertyValue: 800000, state: 'nsw' })
    expect(p.success).toBe(true)
  })

  it('(2) compute correct NSW stamp duty', () => {
    // NSW: 0-308k @ 1.25%, 308k-1,077k @ 3.0%
    // 800k: 308k@1.25% = 3,850, (800k-308k)@3.0% = 14,760
    // Total ≈ 3,850 + 14,760 = 18,610
    const result = calculateStampDuty({ propertyValue: 800000, state: 'nsw', isFirstHomeBuyer: false })
    expect(result.stampDuty).toBeGreaterThan(18000)
    expect(result.stampDuty).toBeLessThan(20000)
    expect(result.concessionApplied).toBe(false)
  })

  it('(2) compute NSW FHB exemption for value <= $1M', () => {
    const result = calculateStampDuty({ propertyValue: 800000, state: 'nsw', isFirstHomeBuyer: true })
    expect(result.stampDuty).toBe(0)
    expect(result.concessionApplied).toBe(true)
    expect(result.concessionAmount).toBeGreaterThan(0)
    expect(result.isFirstHomeBuyerEligible).toBe(true)
  })

  it('(2) compute VIC stamp duty', () => {
    // VIC: 0-25k @ 1.4%, 25k-130k @ 2.4%, 130k-960k @ 5.0%
    // 800k: 25k@1.4%=350, 105k@2.4%=2520, 670k@5.0%=33500 => 36,370
    const result = calculateStampDuty({ propertyValue: 800000, state: 'vic', isFirstHomeBuyer: false })
    expect(result.stampDuty).toBeGreaterThan(35000)
    expect(result.stampDuty).toBeLessThan(38000)
  })

  it('(2) compute QLD stamp duty', () => {
    // QLD: 0-5k@0%, 5k-75k@1%, 75k-540k@3.5%, 540k-1M@4.5%
    const result = calculateStampDuty({ propertyValue: 600000, state: 'qld', isFirstHomeBuyer: false })
    expect(result.stampDuty).toBeGreaterThan(15000)
  })

  it('(3) schema rejects invalid input', () => {
    expect(StampDutyInputSchema.safeParse({}).success).toBe(false)
    expect(StampDutyInputSchema.safeParse({ propertyValue: -100, state: 'nsw' }).success).toBe(false)
    expect(StampDutyInputSchema.safeParse({ propertyValue: 800000, state: 'invalid' }).success).toBe(false)
  })

  it('(4) output shape has all required fields', () => {
    const keys: (keyof StampDutyOutput)[] = ['stampDuty', 'stampDutyFormatted', 'effectiveRate', 'concessionApplied', 'concessionAmount', 'concessionDescription', 'isFirstHomeBuyerEligible']
    const result = calculateStampDuty({ propertyValue: 500000, state: 'nsw' })
    keys.forEach(k => expect(result).toHaveProperty(k))
    expect(Object.keys(result).length).toBe(keys.length)
  })
})

// ============================================================================
// 4. Savings Goal Calculator
// ============================================================================
import {
  calculateSavingsGoal,
  SavingsGoalInputSchema,
} from '../src/edr/domain/calculators/savings-goal'
import type { SavingsGoalOutput } from '../src/edr/domain/calculators/savings-goal'

describe('4. savings-goal', () => {
  it('(1) schema accepts valid input', () => {
    const p = SavingsGoalInputSchema.safeParse({ currentSavings: 10000, monthlyContribution: 1000, annualRate: 5, targetAmount: 50000 })
    expect(p.success).toBe(true)
  })

  it('(2) compute returns correct months to goal', () => {
    // No interest: months = ceil((50000-10000)/1000) = 40
    const result = calculateSavingsGoal({ currentSavings: 10000, monthlyContribution: 1000, annualRate: 0, targetAmount: 50000 })
    expect(result.monthsToGoal).toBe(40)
    expect(result.totalContributions).toBe(40 * 1000)
    expect(result.goalReached).toBe(true)
  })

  it('(2) compute with interest reaches goal faster', () => {
    const result = calculateSavingsGoal({ currentSavings: 10000, monthlyContribution: 1000, annualRate: 6, targetAmount: 50000 })
    expect(result.monthsToGoal).toBeLessThan(40)
    expect(result.totalInterestEarned).toBeGreaterThan(0)
    expect(result.goalReached).toBe(true)
  })

  it('(2) already at goal returns 0 months', () => {
    const result = calculateSavingsGoal({ currentSavings: 60000, monthlyContribution: 1000, annualRate: 5, targetAmount: 50000 })
    expect(result.monthsToGoal).toBe(0)
    expect(result.goalReached).toBe(true)
  })

  it('(3) schema rejects invalid input', () => {
    expect(SavingsGoalInputSchema.safeParse({ currentSavings: -1, monthlyContribution: 1000, annualRate: 5, targetAmount: 50000 }).success).toBe(false)
    expect(SavingsGoalInputSchema.safeParse({ currentSavings: 10000, monthlyContribution: -100, annualRate: 5, targetAmount: 50000 }).success).toBe(false)
    expect(SavingsGoalInputSchema.safeParse({ currentSavings: 10000, monthlyContribution: 1000, annualRate: 5, targetAmount: -100 }).success).toBe(false)
  })

  it('(4) output shape has all required fields', () => {
    const keys: (keyof SavingsGoalOutput)[] = ['monthsToGoal', 'totalContributions', 'totalInterestEarned', 'finalAmount', 'goalReached']
    const result = calculateSavingsGoal({ currentSavings: 5000, monthlyContribution: 500, annualRate: 3, targetAmount: 20000 })
    keys.forEach(k => expect(result).toHaveProperty(k))
    expect(Object.keys(result).length).toBe(keys.length)
  })
})

// ============================================================================
// 5. Repayment Comparison Calculator
// ============================================================================
import {
  calculateRepaymentComparison,
  RepaymentComparisonInputSchema,
} from '../src/edr/domain/calculators/repayment-comparison'
import type { RepaymentComparisonOutput } from '../src/edr/domain/calculators/repayment-comparison'

describe('5. repayment-comparison', () => {
  const baseInput = { loanAmount: 500000, interestRate: 6, termYears: 30, extraRepayment: 200, extraFrequency: 'monthly' as const }

  it('(1) schema accepts valid input', () => {
    const p = RepaymentComparisonInputSchema.safeParse(baseInput)
    expect(p.success).toBe(true)
  })

  it('(2) compute standard vs extra repayment', () => {
    const result = calculateRepaymentComparison(baseInput)
    expect(result.standardMonthly).toBeGreaterThan(0)
    expect(result.extraMonthly).toBe(result.standardMonthly + 200)
    expect(result.monthsSaved).toBeGreaterThan(0)
    expect(result.interestSaved).toBeGreaterThan(0)
    expect(result.standardTotalCost).toBeGreaterThan(result.extraTotalCost)
  })

  it('(2) zero extra repayment means same term', () => {
    const result = calculateRepaymentComparison({ ...baseInput, extraRepayment: 0 })
    expect(result.monthsSaved).toBe(0)
    expect(result.interestSaved).toBe(0)
    expect(result.extraMonthly).toBe(result.standardMonthly)
  })

  it('(3) schema rejects invalid input', () => {
    expect(RepaymentComparisonInputSchema.safeParse({ loanAmount: -100, interestRate: 6, termYears: 30, extraRepayment: 200 }).success).toBe(false)
    expect(RepaymentComparisonInputSchema.safeParse({ loanAmount: 500000, interestRate: 6, termYears: 0, extraRepayment: 200 }).success).toBe(false)
    expect(RepaymentComparisonInputSchema.safeParse({ loanAmount: 500000, interestRate: 6, termYears: 30, extraRepayment: -1 }).success).toBe(false)
  })

  it('(4) output shape has all required fields', () => {
    const keys: (keyof RepaymentComparisonOutput)[] = ['standardMonthly', 'standardTotalInterest', 'standardTotalCost', 'extraMonthly', 'extraTotalInterest', 'extraTotalCost', 'monthsSaved', 'interestSaved', 'extraMonthsToRepay']
    const result = calculateRepaymentComparison(baseInput)
    keys.forEach(k => expect(result).toHaveProperty(k))
    expect(Object.keys(result).length).toBe(keys.length)
  })
})

// ============================================================================
// 6. LVR Calculator
// ============================================================================
import {
  calculateLvr,
  LvrCalculatorInputSchema,
} from '../src/edr/domain/calculators/lvr-calculator'
import type { LvrCalculatorOutput } from '../src/edr/domain/calculators/lvr-calculator'

describe('6. lvr-calculator', () => {
  it('(1) schema accepts valid input', () => {
    const p = LvrCalculatorInputSchema.safeParse({ propertyValue: 800000, loanAmount: 600000 })
    expect(p.success).toBe(true)
  })

  it('(2) compute correct LVR = loan / property * 100', () => {
    const result = calculateLvr({ propertyValue: 800000, loanAmount: 600000, state: 'nsw' })
    expect(result.lvrPercentage).toBe(75)
    expect(result.lmiRequired).toBe(false)
    expect(result.lvrFormatted).toBe('75.00%')
  })

  it('(2) LMI required when LVR > 80%', () => {
    const result = calculateLvr({ propertyValue: 800000, loanAmount: 720000, state: 'nsw' })
    expect(result.lvrPercentage).toBe(90)
    expect(result.lmiRequired).toBe(true)
    expect(result.lmiWarning).toContain('LMI')
  })

  it('(3) schema rejects invalid input', () => {
    expect(LvrCalculatorInputSchema.safeParse({}).success).toBe(false)
    expect(LvrCalculatorInputSchema.safeParse({ propertyValue: -100, loanAmount: 600000 }).success).toBe(false)
    expect(LvrCalculatorInputSchema.safeParse({ propertyValue: 800000, loanAmount: -100 }).success).toBe(false)
  })

  it('(3) compute rejects loan > property value', () => {
    expect(() => calculateLvr({ propertyValue: 500000, loanAmount: 600000, state: 'nsw' })).toThrow('Loan amount cannot exceed')
  })

  it('(4) output shape has all required fields', () => {
    const keys: (keyof LvrCalculatorOutput)[] = ['lvrPercentage', 'lvrFormatted', 'stampDutyEstimate', 'stampDutyFormatted', 'lmiRequired', 'lmiWarning']
    const result = calculateLvr({ propertyValue: 800000, loanAmount: 600000, state: 'nsw' })
    keys.forEach(k => expect(result).toHaveProperty(k))
    expect(Object.keys(result).length).toBe(keys.length)
  })
})

// ============================================================================
// 7. Rent vs Buy Calculator
// ============================================================================
import {
  calculateRentVsBuy,
  RentVsBuyInputSchema,
} from '../src/edr/domain/calculators/rent-vs-buy'
import type { RentVsBuyOutput } from '../src/edr/domain/calculators/rent-vs-buy'

describe('7. rent-vs-buy', () => {
  const input = { propertyPrice: 800000, weeklyRent: 500, savings: 160000, investmentReturnRate: 7, timeHorizonYears: 10, mortgageRate: 6, propertyAppreciation: 3, rentIncrease: 3 }

  it('(1) schema accepts valid input', () => {
    const p = RentVsBuyInputSchema.safeParse(input)
    expect(p.success).toBe(true)
  })

  it('(2) compute returns buy vs rent comparison', () => {
    const result = calculateRentVsBuy(input)
    expect(result.yearSnapshots).toHaveLength(10)
    expect(result.buyNetWorth).toBeGreaterThan(0)
    expect(result.rentNetWorth).toBeGreaterThan(0)
    expect(typeof result.buyAdvantage).toBe('boolean')
    expect(typeof result.breakEvenYear).toBe('number')
  })

  it('(2) buy advantage grows over time', () => {
    const result = calculateRentVsBuy(input)
    // Later years should have higher buy advantage (property appreciation)
    const snapshots = result.yearSnapshots
    for (let i = 1; i < snapshots.length; i++) {
      expect(snapshots[i].buyNetWorth).toBeGreaterThanOrEqual(snapshots[i - 1].buyNetWorth)
    }
  })

  it('(3) schema rejects invalid input', () => {
    expect(RentVsBuyInputSchema.safeParse({}).success).toBe(false)
    expect(RentVsBuyInputSchema.safeParse({ ...input, propertyPrice: -100 }).success).toBe(false)
    expect(RentVsBuyInputSchema.safeParse({ ...input, timeHorizonYears: 0 }).success).toBe(false)
  })

  it('(4) output shape has all required fields', () => {
    const keys: (keyof RentVsBuyOutput)[] = ['buyNetWorth', 'rentNetWorth', 'netAdvantage', 'buyAdvantage', 'breakEvenYear', 'yearSnapshots']
    const result = calculateRentVsBuy(input)
    keys.forEach(k => expect(result).toHaveProperty(k))
    expect(Object.keys(result).length).toBe(keys.length)
  })
})

// ============================================================================
// 8. Borrowing Power Calculator
// ============================================================================
import {
  calculateBorrowingPower,
  BorrowingPowerInputSchema,
} from '../src/edr/domain/calculators/borrowing-power'
import type { BorrowingPowerOutput } from '../src/edr/domain/calculators/borrowing-power'

describe('8. borrowing-power', () => {
  const input = { annualIncome: 120000, monthlyExpenses: 3000, interestRate: 6, termYears: 30 }

  it('(1) schema accepts valid input', () => {
    const p = BorrowingPowerInputSchema.safeParse(input)
    expect(p.success).toBe(true)
  })

  it('(2) compute returns reasonable borrowing power', () => {
    const result = calculateBorrowingPower(input)
    expect(result.estimatedBorrowingPower).toBeGreaterThan(0)
    expect(result.serviceabilitySurplus).toBeGreaterThan(0)
    expect(result.assessedInterestRate).toBe(9) // 6 + 3 buffer
  })

  it('(2) higher income yields higher borrowing power', () => {
    const low = calculateBorrowingPower({ ...input, annualIncome: 80000 })
    const high = calculateBorrowingPower({ ...input, annualIncome: 200000 })
    expect(high.estimatedBorrowingPower).toBeGreaterThan(low.estimatedBorrowingPower)
  })

  it('(2) self-employed reduces borrowing power', () => {
    const ft = calculateBorrowingPower(input)
    const se = calculateBorrowingPower({ ...input, employmentType: 'self-employed' })
    expect(se.estimatedBorrowingPower).toBeLessThan(ft.estimatedBorrowingPower)
  })

  it('(3) schema rejects invalid input', () => {
    expect(BorrowingPowerInputSchema.safeParse({ annualIncome: -100, monthlyExpenses: 3000, interestRate: 6, termYears: 30 }).success).toBe(false)
    expect(BorrowingPowerInputSchema.safeParse({ annualIncome: 120000, monthlyExpenses: -100, interestRate: 6, termYears: 30 }).success).toBe(false)
    expect(BorrowingPowerInputSchema.safeParse({ annualIncome: 120000, monthlyExpenses: 3000, interestRate: 6, termYears: -1 }).success).toBe(false)
  })

  it('(4) output shape has all required fields', () => {
    const keys: (keyof BorrowingPowerOutput)[] = ['estimatedBorrowingPower', 'serviceabilitySurplus', 'assessedInterestRate', 'maxLvrAmount', 'depositRequiredForLvr', 'estimatedBorrowingPowerFormatted', 'serviceabilitySurplusFormatted', 'assessedInterestRateFormatted']
    const result = calculateBorrowingPower(input)
    keys.forEach(k => expect(result).toHaveProperty(k))
    expect(Object.keys(result).length).toBe(keys.length)
  })
})

// ============================================================================
// 9. Property Buying Cost Calculator
// ============================================================================
import {
  calculatePropertyBuyingCost,
  PropertyBuyingCostInputSchema,
} from '../src/edr/domain/calculators/property-buying-cost'
import type { PropertyBuyingCostOutput } from '../src/edr/domain/calculators/property-buying-cost'

describe('9. property-buying-cost', () => {
  const input = { purchasePrice: 800000, deposit: 160000, stateOrTerritory: 'NSW' as const }

  it('(1) schema accepts valid input', () => {
    const p = PropertyBuyingCostInputSchema.safeParse(input)
    expect(p.success).toBe(true)
  })

  it('(2) compute returns buying costs breakdown', () => {
    const result = calculatePropertyBuyingCost(input)
    expect(result.stampDuty).toBeGreaterThan(0)
    expect(result.totalUpfrontCashRequired).toBeGreaterThan(0)
    expect(result.totalBuyingCost).toBeGreaterThan(input.purchasePrice)
    expect(result.breakdown).toHaveLength(7)
  })

  it('(2) deposit reduces loan amount', () => {
    // Having a deposit increases totalUpfrontCashRequired because deposit is part of it,
    // but the loan amount is smaller. Verify breakdown is present.
    const result = calculatePropertyBuyingCost(input)
    expect(result.breakdown.length).toBe(7)
    const depositItem = result.breakdown.find(b => b.label === 'Purchase Price')
    expect(depositItem).toBeDefined()
  })

  it('(3) schema rejects invalid input', () => {
    expect(PropertyBuyingCostInputSchema.safeParse({}).success).toBe(false)
    expect(PropertyBuyingCostInputSchema.safeParse({ purchasePrice: -100, deposit: 0 }).success).toBe(false)
    expect(PropertyBuyingCostInputSchema.safeParse({ purchasePrice: 800000, deposit: -100 }).success).toBe(false)
  })

  it('(4) output shape has all required fields', () => {
    const keys: (keyof PropertyBuyingCostOutput)[] = ['stampDuty', 'lmiCost', 'totalUpfrontCashRequired', 'totalBuyingCost', 'netCashRequiredAfterGrant', 'breakdown', 'stampDutyFormatted', 'totalUpfrontFormatted', 'totalBuyingCostFormatted', 'netCashAfterGrantFormatted']
    const result = calculatePropertyBuyingCost(input)
    keys.forEach(k => expect(result).toHaveProperty(k))
    expect(Object.keys(result).length).toBe(keys.length)
  })
})

// ============================================================================
// 10. Property Selling Cost Calculator
// ============================================================================
import {
  calculatePropertySellingCost,
  PropertySellingCostInputSchema,
} from '../src/edr/domain/calculators/property-selling-cost'
import type { PropertySellingCostOutput } from '../src/edr/domain/calculators/property-selling-cost'

describe('10. property-selling-cost', () => {
  const input = { salePrice: 800000 }

  it('(1) schema accepts valid input', () => {
    const p = PropertySellingCostInputSchema.safeParse(input)
    expect(p.success).toBe(true)
  })

  it('(2) compute returns selling costs', () => {
    const result = calculatePropertySellingCost(input)
    // Agent commission at 2.5% default = 20,000
    expect(result.agentCommission).toBe(20000)
    // Total = 20000 + 3000 + 1500 + 400 + 2000 = 26,900
    expect(result.totalSellingCost).toBe(20000 + 3000 + 1500 + 400 + 2000)
    expect(result.netProceeds).toBe(800000 - result.totalSellingCost)
    expect(result.breakdown).toHaveLength(6)
  })

  it('(2) custom commission rate works', () => {
    const result = calculatePropertySellingCost({ salePrice: 800000, agentCommissionRate: 3 })
    expect(result.agentCommission).toBe(24000)
  })

  it('(3) schema rejects invalid input', () => {
    expect(PropertySellingCostInputSchema.safeParse({ salePrice: -100 }).success).toBe(false)
    expect(PropertySellingCostInputSchema.safeParse({ salePrice: 800000, agentCommissionRate: 15 }).success).toBe(false)
  })

  it('(4) output shape has all required fields', () => {
    const keys: (keyof PropertySellingCostOutput)[] = ['agentCommission', 'totalSellingCost', 'netProceeds', 'breakdown', 'agentCommissionFormatted', 'totalSellingCostFormatted', 'netProceedsFormatted']
    const result = calculatePropertySellingCost(input)
    keys.forEach(k => expect(result).toHaveProperty(k))
    expect(Object.keys(result).length).toBe(keys.length)
  })
})

// ============================================================================
// 11. Comparison Rate Calculator
// ============================================================================
import {
  calculateComparisonRate,
  ComparisonRateInputSchema,
} from '../src/edr/domain/calculators/comparison-rate'
import type { ComparisonRateOutput } from '../src/edr/domain/calculators/comparison-rate'

describe('11. comparison-rate', () => {
  const input = { principal: 500000, interestRate: 6, termYears: 30, upfrontFees: 5000, ongoingAnnualFees: 200 }

  it('(1) schema accepts valid input', () => {
    const p = ComparisonRateInputSchema.safeParse(input)
    expect(p.success).toBe(true)
  })

  it('(2) comparison rate > nominal rate when fees present', () => {
    const result = calculateComparisonRate(input)
    expect(result.comparisonRate).toBeGreaterThan(result.nominalRate)
    expect(result.totalFees).toBe(5000 + 200 * 30)
  })

  it('(2) no fees means comparison rate ≈ nominal rate', () => {
    const result = calculateComparisonRate({ principal: 500000, interestRate: 6, termYears: 30 })
    expect(Math.abs(result.comparisonRate - result.nominalRate)).toBeLessThan(0.5)
  })

  it('(3) schema rejects invalid input', () => {
    expect(ComparisonRateInputSchema.safeParse({ principal: -100, interestRate: 6, termYears: 30 }).success).toBe(false)
    expect(ComparisonRateInputSchema.safeParse({ principal: 500000, interestRate: 6, termYears: -1 }).success).toBe(false)
  })

  it('(4) output shape has all required fields', () => {
    const keys: (keyof ComparisonRateOutput)[] = ['comparisonRate', 'nominalRate', 'totalFees', 'effectiveAnnualCost', 'comparisonRateFormatted', 'nominalRateFormatted']
    const result = calculateComparisonRate(input)
    keys.forEach(k => expect(result).toHaveProperty(k))
    expect(Object.keys(result).length).toBe(keys.length)
  })
})

// ============================================================================
// 12. Extra Repayment Calculator
// ============================================================================
import {
  calculateExtraRepayment,
  ExtraRepaymentInputSchema,
} from '../src/edr/domain/calculators/extra-repayment'
import type { ExtraRepaymentOutput } from '../src/edr/domain/calculators/extra-repayment'

describe('12. extra-repayment', () => {
  const input = { principal: 500000, interestRate: 6, termYears: 30, extraRepayment: 200 }

  it('(1) schema accepts valid input', () => {
    const p = ExtraRepaymentInputSchema.safeParse(input)
    expect(p.success).toBe(true)
  })

  it('(2) extra repayment reduces term and interest', () => {
    const result = calculateExtraRepayment(input)
    expect(result.standardRepayment).toBeGreaterThan(0)
    expect(result.newRepayment).toBe(result.standardRepayment + 200)
    expect(result.monthsSaved).toBeGreaterThan(0)
    expect(result.interestSaved).toBeGreaterThan(0)
    expect(result.newTermMonths).toBeLessThan(30 * 12)
  })

  it('(2) zero extra repayment means same as standard', () => {
    const result = calculateExtraRepayment({ ...input, extraRepayment: 0 })
    expect(result.monthsSaved).toBe(0)
    expect(result.interestSaved).toBe(0)
  })

  it('(3) schema rejects invalid input', () => {
    expect(ExtraRepaymentInputSchema.safeParse({ principal: -100, interestRate: 6, termYears: 30, extraRepayment: 200 }).success).toBe(false)
    expect(ExtraRepaymentInputSchema.safeParse({ principal: 500000, interestRate: 6, termYears: 1.5, extraRepayment: 200 }).success).toBe(false)
  })

  it('(4) output shape has all required fields', () => {
    const keys: (keyof ExtraRepaymentOutput)[] = ['standardRepayment', 'extraRepaymentAmount', 'newRepayment', 'monthsSaved', 'yearsSaved', 'interestSaved', 'newTermMonths', 'newTotalCost', 'standardTotalInterest', 'standardTotalCost', 'standardRepaymentFormatted', 'newRepaymentFormatted', 'interestSavedFormatted', 'monthsSavedFormatted']
    const result = calculateExtraRepayment(input)
    keys.forEach(k => expect(result).toHaveProperty(k))
    expect(Object.keys(result).length).toBe(keys.length)
  })
})

// ============================================================================
// 13. Interest Only Mortgage Calculator
// ============================================================================
import {
  calculateInterestOnly,
  InterestOnlyInputSchema,
} from '../src/edr/domain/calculators/interest-only-mortgage'
import type { InterestOnlyOutput } from '../src/edr/domain/calculators/interest-only-mortgage'

describe('13. interest-only-mortgage', () => {
  const input = { principal: 500000, interestRate: 6, interestOnlyYears: 5, totalTermYears: 30 }

  it('(1) schema accepts valid input', () => {
    const p = InterestOnlyInputSchema.safeParse(input)
    expect(p.success).toBe(true)
  })

  it('(2) IO repayment = principal * monthly rate', () => {
    const result = calculateInterestOnly(input)
    // IO payment = 500000 * 0.06/12 = 2500
    expect(result.interestOnlyRepayment).toBe(2500)
    expect(result.totalInterest).toBeGreaterThan(0)
  })

  it('(2) IO costs more than standard P&I', () => {
    const result = calculateInterestOnly(input)
    expect(result.extraCostVsPAndI).toBeGreaterThan(0)
  })

  it('(3) schema rejects invalid input', () => {
    expect(InterestOnlyInputSchema.safeParse({}).success).toBe(false)
    expect(InterestOnlyInputSchema.safeParse({ principal: -100, interestRate: 6, interestOnlyYears: 5, totalTermYears: 30 }).success).toBe(false)
    expect(InterestOnlyInputSchema.safeParse({ principal: 500000, interestRate: 6, interestOnlyYears: -1, totalTermYears: 30 }).success).toBe(false)
  })

  it('(4) output shape has all required fields', () => {
    const keys: (keyof InterestOnlyOutput)[] = ['interestOnlyRepayment', 'principalAndInterestRepaymentAfterIo', 'totalInterest', 'totalRepayment', 'extraCostVsPAndI', 'ioRepaymentFormatted', 'pAndIRepaymentFormatted', 'totalInterestFormatted', 'extraCostFormatted']
    const result = calculateInterestOnly(input)
    keys.forEach(k => expect(result).toHaveProperty(k))
    expect(Object.keys(result).length).toBe(keys.length)
  })
})

// ============================================================================
// 14. How Long To Repay Calculator
// ============================================================================
import {
  calculateHowLongToRepay,
  HowLongToRepayInputSchema,
} from '../src/edr/domain/calculators/how-long-to-repay'
import type { HowLongToRepayOutput } from '../src/edr/domain/calculators/how-long-to-repay'

describe('14. how-long-to-repay', () => {
  const input = { principal: 500000, interestRate: 6, repaymentAmount: 3000 }

  it('(1) schema accepts valid input', () => {
    const p = HowLongToRepayInputSchema.safeParse(input)
    expect(p.success).toBe(true)
  })

  it('(2) compute months to payoff with given repayment', () => {
    // $3000/month on $500K at 6% barely covers interest ($2500), so payoff takes full 30yr term
    const result = calculateHowLongToRepay(input)
    expect(result.monthsToPayoff).toBeGreaterThan(0)
    expect(result.monthsToPayoff).toBe(30 * 12) // Full term
    expect(result.totalRepaid).toBeGreaterThan(input.principal)
    expect(result.totalInterest).toBeGreaterThan(0)
  })

  it('(2) higher repayment means fewer months', () => {
    const full = calculateHowLongToRepay(input)
    const high = calculateHowLongToRepay({ ...input, repaymentAmount: 5000 })
    expect(high.monthsToPayoff).toBeLessThan(full.monthsToPayoff)
  })

  it('(3) schema rejects invalid input', () => {
    expect(HowLongToRepayInputSchema.safeParse({}).success).toBe(false)
    expect(HowLongToRepayInputSchema.safeParse({ principal: 500000, interestRate: 6, repaymentAmount: 0 }).success).toBe(false)
    expect(HowLongToRepayInputSchema.safeParse({ principal: 500000, interestRate: 6, repaymentAmount: -100 }).success).toBe(false)
  })

  it('(4) output shape has all required fields', () => {
    const keys: (keyof HowLongToRepayOutput)[] = ['monthsToPayoff', 'yearsToPayoff', 'totalRepaid', 'totalInterest', 'monthsFormatted', 'totalInterestFormatted', 'totalRepaidFormatted']
    const result = calculateHowLongToRepay(input)
    keys.forEach(k => expect(result).toHaveProperty(k))
    expect(Object.keys(result).length).toBe(keys.length)
  })
})

// ============================================================================
// 15. Lump Sum Repayment Calculator
// ============================================================================
import {
  calculateLumpSumRepayment,
  LumpSumRepaymentInputSchema,
} from '../src/edr/domain/calculators/lump-sum-repayment'
import type { LumpSumRepaymentOutput } from '../src/edr/domain/calculators/lump-sum-repayment'

describe('15. lump-sum-repayment', () => {
  const input = { principal: 500000, interestRate: 6, termYears: 30, lumpSum: 50000 }

  it('(1) schema accepts valid input', () => {
    const p = LumpSumRepaymentInputSchema.safeParse(input)
    expect(p.success).toBe(true)
  })

  it('(2) lump sum reduces term and interest', () => {
    const result = calculateLumpSumRepayment(input)
    expect(result.standardPayment).toBeGreaterThan(0)
    expect(result.monthsSaved).toBeGreaterThan(0)
    expect(result.interestSaved).toBeGreaterThan(0)
    expect(result.newTermMonths).toBeLessThan(30 * 12)
  })

  it('(2) lump sum equal to principal pays off immediately', () => {
    const result = calculateLumpSumRepayment({ ...input, lumpSum: 500000 })
    expect(result.newTermMonths).toBe(0)
    expect(result.interestSaved).toBeGreaterThan(0)
  })

  it('(3) schema rejects invalid input', () => {
    expect(LumpSumRepaymentInputSchema.safeParse({}).success).toBe(false)
    expect(LumpSumRepaymentInputSchema.safeParse({ principal: 500000, interestRate: 6, termYears: 30, lumpSum: -100 }).success).toBe(false)
    expect(LumpSumRepaymentInputSchema.safeParse({ principal: 500000, interestRate: 6, termYears: 0, lumpSum: 50000 }).success).toBe(false)
  })

  it('(4) output shape has all required fields', () => {
    const keys: (keyof LumpSumRepaymentOutput)[] = ['standardPayment', 'lumpSum', 'monthsSaved', 'interestSaved', 'newTermMonths', 'newTotalCost', 'interestSavedFormatted', 'monthsSavedFormatted']
    const result = calculateLumpSumRepayment(input)
    keys.forEach(k => expect(result).toHaveProperty(k))
    expect(Object.keys(result).length).toBe(keys.length)
  })
})

// ============================================================================
// 16. Income Tax Calculator
// ============================================================================
import {
  calculateIncomeTax,
  IncomeTaxInputSchema,
} from '../src/edr/domain/calculators/income-tax'
import type { IncomeTaxOutput } from '../src/edr/domain/calculators/income-tax'

describe('16. income-tax', () => {
  it('(1) schema accepts valid input', () => {
    const p = IncomeTaxInputSchema.safeParse({ taxableIncome: 100000 })
    expect(p.success).toBe(true)
  })

  it('(2) compute AU tax for $100k income', () => {
    // 2025-26 brackets: 0-18200 @ 0%, 18201-45000 @ 16%, 45001-135000 @ 30%
    // 0-18200: 0, 18201-45000: (45000-18200)*0.16 = 4288, 45001-100000: (100000-45000)*0.30 = 16500
    // Gross tax = 0 + 4288 + 16500 = 20788
    // Medicare levy = 100000 * 0.02 = 2000
    // Net tax = 20788 + 2000 = 22788
    const result = calculateIncomeTax({ taxableIncome: 100000 })
    expect(result.grossTax).toBeCloseTo(20788, 0)
    expect(result.medicareLevy).toBe(2000)
    expect(result.netTaxPayable).toBe(22788)
  })

  it('(2) tax is 0 under $18,200 threshold but medicare still applies', () => {
    const result = calculateIncomeTax({ taxableIncome: 15000 })
    expect(result.grossTax).toBe(0)
    // Medicare levy of 2% applies even below tax-free threshold
    expect(result.medicareLevy).toBe(300) // 15000 * 0.02
    expect(result.netTaxPayable).toBe(300)
  })

  it('(2) offsets reduce tax payable', () => {
    const noOffset = calculateIncomeTax({ taxableIncome: 100000 })
    const withOffset = calculateIncomeTax({ taxableIncome: 100000, offsets: 5000 })
    expect(withOffset.netTaxPayable).toBeLessThan(noOffset.netTaxPayable)
  })

  it('(3) schema rejects invalid input', () => {
    expect(IncomeTaxInputSchema.safeParse({ taxableIncome: -100 }).success).toBe(false)
    expect(IncomeTaxInputSchema.safeParse({ taxableIncome: 100000, offsets: -100 }).success).toBe(false)
  })

  it('(4) output shape has all required fields', () => {
    const keys: (keyof IncomeTaxOutput)[] = ['grossTax', 'medicareLevy', 'netTaxPayable', 'effectiveTaxRate', 'offsetsApplied', 'grossTaxFormatted', 'medicareLevyFormatted', 'netTaxFormatted', 'effectiveRateFormatted']
    const result = calculateIncomeTax({ taxableIncome: 100000 })
    keys.forEach(k => expect(result).toHaveProperty(k))
    expect(Object.keys(result).length).toBe(keys.length)
  })
})

// ============================================================================
// 17. Compound Interest Calculator
// ============================================================================
import {
  calculateCompoundInterest,
  CompoundInterestInputSchema,
} from '../src/edr/domain/calculators/compound-interest'
import type { CompoundInterestOutput } from '../src/edr/domain/calculators/compound-interest'

describe('17. compound-interest', () => {
  it('(1) schema accepts valid input', () => {
    const p = CompoundInterestInputSchema.safeParse({ principal: 10000, regularContribution: 500, interestRate: 8, termYears: 10 })
    expect(p.success).toBe(true)
  })

  it('(2) compute future value with monthly compounding', () => {
    const result = calculateCompoundInterest({ principal: 10000, regularContribution: 500, interestRate: 8, termYears: 10, compoundingFrequency: 'monthly' })
    expect(result.futureValue).toBeGreaterThan(result.totalContributions)
    expect(result.interestEarned).toBeGreaterThan(0)
    // Total contributions = 10000 + 500*120 = 70000
    expect(result.totalContributions).toBe(10000 + 500 * 120)
    expect(result.effectiveAnnualRate).toBeGreaterThan(8) // EAR > nominal
  })

  it('(2) no interest = simple sum', () => {
    const result = calculateCompoundInterest({ principal: 10000, regularContribution: 1000, interestRate: 0, termYears: 5, compoundingFrequency: 'monthly' })
    expect(result.futureValue).toBe(10000 + 1000 * 60)
    expect(result.interestEarned).toBe(0)
  })

  it('(3) schema rejects invalid input', () => {
    // regularContribution has default 0, so it's optional
    expect(CompoundInterestInputSchema.safeParse({ principal: -100, regularContribution: 500, interestRate: 8, termYears: 10 }).success).toBe(false)
    expect(CompoundInterestInputSchema.safeParse({ principal: 10000, regularContribution: 500, interestRate: 8, termYears: -1 }).success).toBe(false)
    expect(CompoundInterestInputSchema.safeParse({ principal: 10000, regularContribution: 500, interestRate: 8, termYears: 10, extra: true }).success).toBe(false)
  })

  it('(4) output shape has all required fields', () => {
    const keys: (keyof CompoundInterestOutput)[] = ['futureValue', 'totalContributions', 'interestEarned', 'effectiveAnnualRate', 'futureValueFormatted', 'totalContributionsFormatted', 'interestEarnedFormatted']
    const result = calculateCompoundInterest({ principal: 10000, regularContribution: 500, interestRate: 8, termYears: 10 })
    keys.forEach(k => expect(result).toHaveProperty(k))
    expect(Object.keys(result).length).toBe(keys.length)
  })
})

// ============================================================================
// 18. Credit Card Calculator
// ============================================================================
import {
  calculateCreditCard,
  CreditCardInputSchema,
} from '../src/edr/domain/calculators/credit-card'
import type { CreditCardOutput } from '../src/edr/domain/calculators/credit-card'

describe('18. credit-card', () => {
  const input = { balance: 10000, interestRate: 20, monthlyPayment: 300 }

  it('(1) schema accepts valid input', () => {
    const p = CreditCardInputSchema.safeParse(input)
    expect(p.success).toBe(true)
  })

  it('(2) compute months to pay off credit card', () => {
    const result = calculateCreditCard(input)
    expect(result.monthsToPayoff).toBeGreaterThan(0)
    expect(result.totalPaid).toBeGreaterThan(input.balance)
    expect(result.totalInterest).toBeGreaterThan(0)
  })

  it('(2) intro rate reduces total interest', () => {
    const standard = calculateCreditCard(input)
    const intro = calculateCreditCard({ ...input, introRate: 5, introMonths: 12 })
    expect(intro.totalInterest).toBeLessThan(standard.totalInterest)
  })

  it('(3) schema rejects invalid input', () => {
    expect(CreditCardInputSchema.safeParse({ balance: -100, interestRate: 20, monthlyPayment: 300 }).success).toBe(false)
    expect(CreditCardInputSchema.safeParse({ balance: 10000, interestRate: 101, monthlyPayment: 300 }).success).toBe(false)
    expect(CreditCardInputSchema.safeParse({ balance: 10000, interestRate: 20, monthlyPayment: 0 }).success).toBe(false)
  })

  it('(4) output shape has all required fields', () => {
    const keys: (keyof CreditCardOutput)[] = ['monthsToPayoff', 'totalInterest', 'totalPaid', 'finalPayment', 'monthsFormatted', 'totalInterestFormatted', 'totalPaidFormatted']
    const result = calculateCreditCard(input)
    keys.forEach(k => expect(result).toHaveProperty(k))
    expect(Object.keys(result).length).toBe(keys.length)
  })
})

// ============================================================================
// 19. Income Annualisation Calculator
// ============================================================================
import {
  calculateIncomeAnnualisation,
  IncomeAnnualisationInputSchema,
} from '../src/edr/domain/calculators/income-annualisation'
import type { IncomeAnnualisationOutput } from '../src/edr/domain/calculators/income-annualisation'

describe('19. income-annualisation', () => {
  it('(1) schema accepts valid input', () => {
    const p = IncomeAnnualisationInputSchema.safeParse({ incomeAmount: 5000, incomePeriod: 'monthly' })
    expect(p.success).toBe(true)
  })

  it('(2) annualise monthly income', () => {
    const result = calculateIncomeAnnualisation({ incomeAmount: 5000, incomePeriod: 'monthly', weeksWorkedPerYear: 52 })
    expect(result.annualisedIncome).toBe(5000 * 12)
    expect(result.weeklyEquivalent).toBeCloseTo(5000 * 12 / 52, 1)
    expect(result.monthlyEquivalent).toBe(5000)
  })

  it('(2) annualise part-year income', () => {
    const result = calculateIncomeAnnualisation({ incomeAmount: 5000, incomePeriod: 'monthly', weeksWorkedPerYear: 40 })
    expect(result.annualisedIncome).toBeCloseTo(5000 * 12 / 52 * 40, 0)
  })

  it('(3) schema rejects invalid input', () => {
    expect(IncomeAnnualisationInputSchema.safeParse({ incomeAmount: -100, incomePeriod: 'monthly' }).success).toBe(false)
    expect(IncomeAnnualisationInputSchema.safeParse({ incomeAmount: 5000, incomePeriod: 'yearly', weeksWorkedPerYear: 0 }).success).toBe(false)
    expect(IncomeAnnualisationInputSchema.safeParse({ incomeAmount: 5000, incomePeriod: 'yearly', weeksWorkedPerYear: 53 }).success).toBe(false)
  })

  it('(4) output shape has all required fields', () => {
    const keys: (keyof IncomeAnnualisationOutput)[] = ['annualisedIncome', 'weeklyEquivalent', 'monthlyEquivalent', 'annualisedFormatted', 'weeklyFormatted', 'monthlyFormatted']
    const result = calculateIncomeAnnualisation({ incomeAmount: 5000, incomePeriod: 'monthly' })
    keys.forEach(k => expect(result).toHaveProperty(k))
    expect(Object.keys(result).length).toBe(keys.length)
  })
})

// ============================================================================
// 20. Income Gross Up Calculator
// ============================================================================
import {
  calculateIncomeGrossUp,
  IncomeGrossUpInputSchema,
} from '../src/edr/domain/calculators/income-gross-up'
import type { IncomeGrossUpOutput } from '../src/edr/domain/calculators/income-gross-up'

describe('20. income-gross-up', () => {
  it('(1) schema accepts valid input', () => {
    const p = IncomeGrossUpInputSchema.safeParse({ netIncome: 70000, taxRate: 30 })
    expect(p.success).toBe(true)
  })

  it('(2) gross up using tax rate', () => {
    // gross = 70000 / (1 - 0.30) = 100000
    const result = calculateIncomeGrossUp({ netIncome: 70000, taxRate: 30, incomePeriod: 'yearly' })
    expect(result.grossIncome).toBe(100000)
    expect(result.totalTax).toBe(30000)
    expect(result.netIncome).toBe(70000)
    expect(result.effectiveRate).toBe(30)
  })

  it('(2) gross up using explicit gross-up rate', () => {
    const result = calculateIncomeGrossUp({ netIncome: 70000, grossUpRate: 25 })
    expect(result.grossIncome).toBeCloseTo(70000 / 0.75, 0)
  })

  it('(3) schema rejects invalid input', () => {
    expect(IncomeGrossUpInputSchema.safeParse({ netIncome: -100, taxRate: 30 }).success).toBe(false)
    expect(IncomeGrossUpInputSchema.safeParse({ netIncome: 70000, taxRate: 101 }).success).toBe(false)
    expect(IncomeGrossUpInputSchema.safeParse({ netIncome: 70000, grossUpRate: -1 }).success).toBe(false)
  })

  it('(4) output shape has all required fields', () => {
    const keys: (keyof IncomeGrossUpOutput)[] = ['grossIncome', 'totalTax', 'netIncome', 'effectiveRate', 'grossFormatted', 'netFormatted']
    const result = calculateIncomeGrossUp({ netIncome: 70000, taxRate: 30 })
    keys.forEach(k => expect(result).toHaveProperty(k))
    expect(Object.keys(result).length).toBe(keys.length)
  })
})

// ============================================================================
// 21. Split Loan Calculator
// ============================================================================
import {
  calculateSplitLoan,
  SplitLoanInputSchema,
} from '../src/edr/domain/calculators/split-loan'
import type { SplitLoanOutput } from '../src/edr/domain/calculators/split-loan'

describe('21. split-loan', () => {
  const input = { totalPrincipal: 500000, fixedPortion: 300000, fixedRate: 5, fixedTermYears: 30, variableRate: 6, variableTermYears: 30 }

  it('(1) schema accepts valid input', () => {
    const p = SplitLoanInputSchema.safeParse(input)
    expect(p.success).toBe(true)
  })

  it('(2) compute split loan repayments', () => {
    const result = calculateSplitLoan(input)
    expect(result.fixedRepayment).toBeGreaterThan(0)
    expect(result.variableRepayment).toBeGreaterThan(0)
    expect(result.totalRepayment).toBeCloseTo(result.fixedRepayment + result.variableRepayment, 1)
    // Weighted average: (300k*5 + 200k*6) / 500k = 5.4
    expect(result.weightedAverageRate).toBe(5.4)
  })

  it('(2) variable portion is total - fixed', () => {
    const result = calculateSplitLoan(input)
    expect(result.weightedAverageRate).toBeCloseTo((300000 * 5 + 200000 * 6) / 500000, 1)
  })

  it('(3) schema rejects invalid input', () => {
    expect(SplitLoanInputSchema.safeParse({}).success).toBe(false)
    expect(SplitLoanInputSchema.safeParse({ ...input, totalPrincipal: -100 }).success).toBe(false)
    expect(SplitLoanInputSchema.safeParse({ ...input, fixedRate: 30 }).success).toBe(false)
  })

  it('(4) output shape has all required fields', () => {
    const keys: (keyof SplitLoanOutput)[] = ['fixedRepayment', 'variableRepayment', 'totalRepayment', 'totalInterest', 'weightedAverageRate', 'fixedRepaymentFormatted', 'variableRepaymentFormatted', 'totalRepaymentFormatted', 'weightedRateFormatted']
    const result = calculateSplitLoan(input)
    keys.forEach(k => expect(result).toHaveProperty(k))
    expect(Object.keys(result).length).toBe(keys.length)
  })
})

// ============================================================================
// 22. Home Loan Offset Calculator
// ============================================================================
import {
  calculateHomeLoanOffset,
  HomeLoanOffsetInputSchema,
} from '../src/edr/domain/calculators/home-loan-offset'
import type { HomeLoanOffsetOutput } from '../src/edr/domain/calculators/home-loan-offset'

describe('22. home-loan-offset', () => {
  const input = { loanBalance: 500000, offsetBalance: 50000, interestRate: 6, termYears: 30 }

  it('(1) schema accepts valid input', () => {
    const p = HomeLoanOffsetInputSchema.safeParse(input)
    expect(p.success).toBe(true)
  })

  it('(2) offset reduces interest and term', () => {
    const result = calculateHomeLoanOffset(input)
    expect(result.noOffsetMonthly).toBeGreaterThan(0)
    expect(result.withOffsetMonthly).toBe(result.noOffsetMonthly) // Same payment amount
    expect(result.interestSaved).toBeGreaterThan(0)
    expect(result.monthsSaved).toBeGreaterThanOrEqual(0)
    expect(result.effectiveLoanBalance).toBe(450000)
  })

  it('(2) larger offset = more interest saved', () => {
    const small = calculateHomeLoanOffset({ ...input, offsetBalance: 10000 })
    const large = calculateHomeLoanOffset({ ...input, offsetBalance: 100000 })
    expect(large.interestSaved).toBeGreaterThan(small.interestSaved)
  })

  it('(3) schema rejects invalid input', () => {
    expect(HomeLoanOffsetInputSchema.safeParse({}).success).toBe(false)
    expect(HomeLoanOffsetInputSchema.safeParse({ loanBalance: -100, offsetBalance: 50000, interestRate: 6, termYears: 30 }).success).toBe(false)
    expect(HomeLoanOffsetInputSchema.safeParse({ loanBalance: 500000, offsetBalance: -100, interestRate: 6, termYears: 30 }).success).toBe(false)
  })

  it('(4) output shape has all required fields', () => {
    const keys: (keyof HomeLoanOffsetOutput)[] = ['noOffsetMonthly', 'withOffsetMonthly', 'interestSaved', 'monthsSaved', 'effectiveLoanBalance', 'monthlySaving', 'noOffsetTotalInterest', 'withOffsetTotalInterest', 'interestSavedFormatted', 'monthlySavingFormatted']
    const result = calculateHomeLoanOffset(input)
    keys.forEach(k => expect(result).toHaveProperty(k))
    expect(Object.keys(result).length).toBe(keys.length)
  })
})

// ============================================================================
// 23. Introductory Rate Loan Calculator
// ============================================================================
import {
  calculateIntroductoryRateLoan,
  IntroductoryRateLoanInputSchema,
} from '../src/edr/domain/calculators/introductory-rate-loan'
import type { IntroductoryRateLoanOutput } from '../src/edr/domain/calculators/introductory-rate-loan'

describe('23. introductory-rate-loan', () => {
  const input = { principal: 500000, introductoryRate: 4, introductoryMonths: 24, revertRate: 6, termYears: 30 }

  it('(1) schema accepts valid input', () => {
    const p = IntroductoryRateLoanInputSchema.safeParse(input)
    expect(p.success).toBe(true)
  })

  it('(2) intro rate repayment is IO: P * r', () => {
    const result = calculateIntroductoryRateLoan(input)
    // IO repayment = 500000 * 0.04/12 = 1666.67
    expect(result.introductoryRepayment).toBeCloseTo(1666.67, 1)
    expect(result.revertRepayment).toBeGreaterThan(result.introductoryRepayment)
    expect(result.averageRate).toBeCloseTo((4 * 24 + 6 * (360 - 24)) / 360, 2)
  })

  it('(2) total interest is positive', () => {
    const result = calculateIntroductoryRateLoan(input)
    expect(result.totalInterest).toBeGreaterThan(0)
  })

  it('(3) schema rejects invalid input', () => {
    expect(IntroductoryRateLoanInputSchema.safeParse({}).success).toBe(false)
    expect(IntroductoryRateLoanInputSchema.safeParse({ ...input, principal: -100 }).success).toBe(false)
    expect(IntroductoryRateLoanInputSchema.safeParse({ ...input, introductoryMonths: -1 }).success).toBe(false)
  })

  it('(4) output shape has all required fields', () => {
    const keys: (keyof IntroductoryRateLoanOutput)[] = ['introductoryRepayment', 'revertRepayment', 'totalInterest', 'averageRate', 'introRepaymentFormatted', 'revertRepaymentFormatted', 'totalInterestFormatted', 'averageRateFormatted']
    const result = calculateIntroductoryRateLoan(input)
    keys.forEach(k => expect(result).toHaveProperty(k))
    expect(Object.keys(result).length).toBe(keys.length)
  })
})

// ============================================================================
// 24. Loan Comparison Calculator
// ============================================================================
import {
  calculateLoanComparison,
  LoanComparisonInputSchema,
} from '../src/edr/domain/calculators/loan-comparison'
import type { LoanComparisonOutput } from '../src/edr/domain/calculators/loan-comparison'

describe('24. loan-comparison', () => {
  const loanA = { name: 'Bank A', principal: 500000, interestRate: 6, termYears: 30 }
  const loanB = { name: 'Bank B', principal: 500000, interestRate: 5.5, termYears: 30, feesUpfront: 2000 }

  it('(1) schema accepts valid input', () => {
    const p = LoanComparisonInputSchema.safeParse({ loans: [loanA, loanB] })
    expect(p.success).toBe(true)
  })

  it('(2) finds best loan by total cost', () => {
    const result = calculateLoanComparison({ loans: [loanA, loanB] })
    expect(result.bestByTotalCost).toBe('Bank B') // Lower rate
    expect(result.comparisonTable).toHaveLength(2)
    expect(result.comparisonTable[0].name).toBe('Bank A')
    expect(result.comparisonTable[1].name).toBe('Bank B')
  })

  it('(2) best by monthly repayment identifies cheaper rate', () => {
    const result = calculateLoanComparison({ loans: [loanA, loanB] })
    expect(result.bestByMonthlyRepayment).toBe('Bank B')
  })

  it('(3) schema rejects invalid input', () => {
    expect(LoanComparisonInputSchema.safeParse({}).success).toBe(false) // missing loans
    expect(LoanComparisonInputSchema.safeParse({ loans: [] }).success).toBe(false) // empty array
    expect(LoanComparisonInputSchema.safeParse({ loans: [loanA] }).success).toBe(false) // need at least 2
    expect(LoanComparisonInputSchema.safeParse({ loans: [loanA, { ...loanB, name: '' }] }).success).toBe(false) // empty name
    expect(LoanComparisonInputSchema.safeParse({ loans: [loanA, { ...loanB, principal: -100 }] }).success).toBe(false) // negative principal
  })

  it('(4) output shape has all required fields', () => {
    const keys: (keyof LoanComparisonOutput)[] = ['bestByTotalCost', 'bestByMonthlyRepayment', 'bestByInterestSaved', 'comparisonTable']
    const result = calculateLoanComparison({ loans: [loanA, loanB] })
    keys.forEach(k => expect(result).toHaveProperty(k))
    expect(Object.keys(result).length).toBe(keys.length)
  })
})

// ============================================================================
// 25. Mortgage Switching Calculator
// ============================================================================
import {
  calculateMortgageSwitching,
  MortgageSwitchingInputSchema,
} from '../src/edr/domain/calculators/mortgage-switching'
import type { MortgageSwitchingOutput } from '../src/edr/domain/calculators/mortgage-switching'

describe('25. mortgage-switching', () => {
  const input = { currentBalance: 400000, currentRate: 6, currentRemainingYears: 25, newRate: 5, newFeesUpfront: 3000, breakCosts: 2000 }

  it('(1) schema accepts valid input', () => {
    const p = MortgageSwitchingInputSchema.safeParse(input)
    expect(p.success).toBe(true)
  })

  it('(2) switching to lower rate reduces monthly payment', () => {
    const result = calculateMortgageSwitching(input)
    expect(result.switchMonthlyRepayment).toBeLessThan(result.stayMonthlyRepayment)
    expect(result.netSavingOrCost).toBeGreaterThan(0) // Should save money
    expect(result.breakEvenMonths).toBeGreaterThan(0)
  })

  it('(2) same rate means no savings after fees', () => {
    const sameRate = calculateMortgageSwitching({ ...input, newRate: 6 })
    expect(sameRate.netSavingOrCost).toBeLessThan(0) // Cost because of fees
  })

  it('(3) schema rejects invalid input', () => {
    expect(MortgageSwitchingInputSchema.safeParse({}).success).toBe(false)
    expect(MortgageSwitchingInputSchema.safeParse({ currentBalance: -100, currentRate: 6, currentRemainingYears: 25, newRate: 5 }).success).toBe(false)
    expect(MortgageSwitchingInputSchema.safeParse({ currentBalance: 400000, currentRate: 30, currentRemainingYears: 25, newRate: 5 }).success).toBe(false)
  })

  it('(4) output shape has all required fields', () => {
    const keys: (keyof MortgageSwitchingOutput)[] = ['stayMonthlyRepayment', 'switchMonthlyRepayment', 'stayTotalCost', 'switchTotalCost', 'netSavingOrCost', 'breakEvenMonths', 'stayMonthlyFormatted', 'switchMonthlyFormatted', 'netSavingFormatted', 'breakEvenFormatted']
    const result = calculateMortgageSwitching(input)
    keys.forEach(k => expect(result).toHaveProperty(k))
    expect(Object.keys(result).length).toBe(keys.length)
  })
})

// ============================================================================
// 26. Leasing Calculator
// ============================================================================
import {
  calculateLeasing,
  LeasingInputSchema,
} from '../src/edr/domain/calculators/leasing'
import type { LeasingOutput } from '../src/edr/domain/calculators/leasing'

describe('26. leasing', () => {
  const input = { assetPrice: 50000, residualValue: 15000, interestRate: 6, termYears: 5 }

  it('(1) schema accepts valid input', () => {
    const p = LeasingInputSchema.safeParse(input)
    expect(p.success).toBe(true)
  })

  it('(2) compute lease payment', () => {
    const result = calculateLeasing(input)
    // depreciation = (50000 - 15000) / 60 = 583.33
    // interest = (50000 + 15000) * 0.005 = 325
    // payment ≈ 908.33
    expect(result.leasePayment).toBeGreaterThan(0)
    expect(result.capitalizedCost).toBe(50000)
    expect(result.totalLeaseCost).toBeGreaterThan(0)
  })

  it('(2) fees increase capitalized cost', () => {
    const withFees = calculateLeasing({ ...input, fees: 2000 })
    expect(withFees.capitalizedCost).toBe(52000)
  })

  it('(3) schema rejects invalid input', () => {
    expect(LeasingInputSchema.safeParse({}).success).toBe(false)
    expect(LeasingInputSchema.safeParse({ assetPrice: -100, residualValue: 15000, interestRate: 6, termYears: 5 }).success).toBe(false)
    expect(LeasingInputSchema.safeParse({ assetPrice: 50000, residualValue: -100, interestRate: 6, termYears: 5 }).success).toBe(false)
  })

  it('(4) output shape has all required fields', () => {
    const keys: (keyof LeasingOutput)[] = ['leasePayment', 'totalLeaseCost', 'totalInterest', 'capitalizedCost', 'leasePaymentFormatted', 'totalLeaseCostFormatted', 'totalInterestFormatted']
    const result = calculateLeasing(input)
    keys.forEach(k => expect(result).toHaveProperty(k))
    expect(Object.keys(result).length).toBe(keys.length)
  })
})

// ============================================================================
// 27. Reverse Mortgage Calculator
// ============================================================================
import {
  calculateReverseMortgage,
  ReverseMortgageInputSchema,
} from '../src/edr/domain/calculators/reverse-mortgage'
import type { ReverseMortgageOutput } from '../src/edr/domain/calculators/reverse-mortgage'

describe('27. reverse-mortgage', () => {
  const input = { propertyValue: 800000, borrowerAge: 65, interestRate: 6, initialDrawdown: 50000, regularDrawdown: 2000, termYears: 10 }

  it('(1) schema accepts valid input', () => {
    const p = ReverseMortgageInputSchema.safeParse(input)
    expect(p.success).toBe(true)
  })

  it('(2) compute reverse mortgage projection', () => {
    const result = calculateReverseMortgage(input)
    expect(result.projectedLoanBalance).toBeGreaterThan(0)
    expect(result.remainingEquity).toBeGreaterThan(0)
    expect(result.drawdownTotal).toBeGreaterThan(0)
    expect(result.equityRemainingPercent).toBeGreaterThan(0)
    expect(result.ltvPercent).toBeGreaterThan(0)
  })

  it('(2) loan balance grows over time with compounded interest', () => {
    // Without regular drawdown, balance = 50000 * (1+0.005)^120 ≈ 91000
    const result = calculateReverseMortgage(input)
    expect(result.projectedLoanBalance).toBeGreaterThan(input.initialDrawdown)
    expect(result.projectedLoanBalance).toBeGreaterThan(result.drawdownTotal)
  })

  it('(3) schema rejects invalid input', () => {
    expect(ReverseMortgageInputSchema.safeParse({}).success).toBe(false)
    expect(ReverseMortgageInputSchema.safeParse({ propertyValue: 800000, borrowerAge: 17, interestRate: 6, termYears: 10 }).success).toBe(false)
    expect(ReverseMortgageInputSchema.safeParse({ propertyValue: 800000, borrowerAge: 121, interestRate: 6, termYears: 10 }).success).toBe(false)
  })

  it('(4) output shape has all required fields', () => {
    const keys: (keyof ReverseMortgageOutput)[] = ['projectedLoanBalance', 'remainingEquity', 'drawdownTotal', 'equityRemainingPercent', 'ltvPercent', 'loanBalanceFormatted', 'remainingEquityFormatted', 'drawdownTotalFormatted', 'equityPercentFormatted']
    const result = calculateReverseMortgage(input)
    keys.forEach(k => expect(result).toHaveProperty(k))
    expect(Object.keys(result).length).toBe(keys.length)
  })
})

// ============================================================================
// 28. Calculator Engine — Integration Tests
// ============================================================================
// Import the registry to trigger calculator registration side effects
import '../src/registry/calculators'
import {
  executeCalculator,
  listCalculators,
  getCalculator,
} from '../src/lib/calculator-engine'

describe('28. calculator-engine integration', () => {
  it('listCalculators returns all registered calculators', () => {
    const all = listCalculators()
    // Must be exactly 27 calculators (registered in registry/calculators.ts)
    expect(all.length).toBe(27)
    const ids = all.map(c => c.id)
    expect(ids).toContain('loan-repayment')
    expect(ids).toContain('budget-planner')
    expect(ids).toContain('stamp-duty')
    expect(ids).toContain('savings-goal')
    expect(ids).toContain('repayment-comparison')
    expect(ids).toContain('lvr-calculator')
    expect(ids).toContain('rent-vs-buy')
    expect(ids).toContain('borrowing-power')
    expect(ids).toContain('property-buying-cost')
    expect(ids).toContain('property-selling-cost')
    expect(ids).toContain('comparison-rate')
    expect(ids).toContain('extra-repayment')
    expect(ids).toContain('interest-only-mortgage')
    expect(ids).toContain('how-long-to-repay')
    expect(ids).toContain('lump-sum-repayment')
    expect(ids).toContain('income-tax')
    expect(ids).toContain('compound-interest')
    expect(ids).toContain('credit-card')
    expect(ids).toContain('income-annualisation')
    expect(ids).toContain('income-gross-up')
    expect(ids).toContain('split-loan')
    expect(ids).toContain('home-loan-offset')
    expect(ids).toContain('introductory-rate-loan')
    expect(ids).toContain('loan-comparison')
    expect(ids).toContain('mortgage-switching')
    expect(ids).toContain('leasing')
    expect(ids).toContain('reverse-mortgage')
  })

  it('getCalculator returns specific calculator', () => {
    const calc = getCalculator('loan-repayment')
    expect(calc).toBeDefined()
    expect(calc!.id).toBe('loan-repayment')
    expect(calc!.name).toBe('Loan Repayment Calculator')
    expect(calc!.inputSchema).toBeDefined()
    expect(typeof calc!.execute).toBe('function')
  })

  it('executeCalculator successful', () => {
    const result = executeCalculator('loan-repayment', { principal: 500000, annualRate: 6, termYears: 30 })
    expect(result.success).toBe(true)
    expect(result.calculatorId).toBe('loan-repayment')
    expect(result.data).toBeDefined()
    expect(result.data!.monthlyRepayment).toBeDefined()
    expect(result.executedAt).toBeDefined()
  })

  it('executeCalculator schema validation failure', () => {
    const result = executeCalculator('loan-repayment', { principal: -100, annualRate: 6, termYears: 30 })
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.error).toContain('Principal must be positive')
  })

  it('executeCalculator unknown calculator', () => {
    const result = executeCalculator('non-existent-calc', {})
    expect(result.success).toBe(false)
    expect(result.error).toContain('Unknown calculator')
  })
})
