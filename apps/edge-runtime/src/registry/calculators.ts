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
import { compileLayoutCompat } from '../lib/compile-layout-compat'
import type { KvStore, DesignArtifact } from '../lib/publish'
import type { LayoutDefinition, MortgageCalculatorInput } from '@edgegde/schema'
import {
  registerCalculator,
  listCalculators,
  getCalculator,
  executeCalculator,
} from '../lib/calculator-engine'
import {
  calculateLoanRepayment,
  LoanRepaymentInputSchema,
} from '../edr/domain/calculators/loan-repayment'
import {
  calculateBudgetPlanner,
  BudgetPlannerInputSchema,
} from '../edr/domain/calculators/budget-planner'
import {
  calculateStampDuty,
  StampDutyInputSchema,
} from '../edr/domain/calculators/stamp-duty'
import {
  calculateSavingsGoal,
  SavingsGoalInputSchema,
} from '../edr/domain/calculators/savings-goal'
import {
  calculateRepaymentComparison,
  RepaymentComparisonInputSchema,
} from '../edr/domain/calculators/repayment-comparison'
import {
  calculateLvr,
  LvrCalculatorInputSchema,
} from '../edr/domain/calculators/lvr-calculator'
import {
  calculateRentVsBuy,
  RentVsBuyInputSchema,
} from '../edr/domain/calculators/rent-vs-buy'
import {
  calculateBorrowingPower,
  BorrowingPowerInputSchema,
} from '../edr/domain/calculators/borrowing-power'
import {
  calculatePropertyBuyingCost,
  PropertyBuyingCostInputSchema,
} from '../edr/domain/calculators/property-buying-cost'
import {
  calculatePropertySellingCost,
  PropertySellingCostInputSchema,
} from '../edr/domain/calculators/property-selling-cost'
import {
  calculateComparisonRate,
  ComparisonRateInputSchema,
} from '../edr/domain/calculators/comparison-rate'
import {
  calculateExtraRepayment,
  ExtraRepaymentInputSchema,
} from '../edr/domain/calculators/extra-repayment'
import {
  calculateInterestOnly,
  InterestOnlyInputSchema,
} from '../edr/domain/calculators/interest-only-mortgage'
import {
  calculateHowLongToRepay,
  HowLongToRepayInputSchema,
} from '../edr/domain/calculators/how-long-to-repay'
import {
  calculateLumpSumRepayment,
  LumpSumRepaymentInputSchema,
} from '../edr/domain/calculators/lump-sum-repayment'
import {
  calculateIncomeTax,
  IncomeTaxInputSchema,
} from '../edr/domain/calculators/income-tax'
import {
  calculateCompoundInterest,
  CompoundInterestInputSchema,
} from '../edr/domain/calculators/compound-interest'
import {
  calculateCreditCard,
  CreditCardInputSchema,
} from '../edr/domain/calculators/credit-card'
import {
  calculateIncomeAnnualisation,
  IncomeAnnualisationInputSchema,
} from '../edr/domain/calculators/income-annualisation'
import {
  calculateIncomeGrossUp,
  IncomeGrossUpInputSchema,
} from '../edr/domain/calculators/income-gross-up'
import {
  calculateSplitLoan,
  SplitLoanInputSchema,
} from '../edr/domain/calculators/split-loan'
import {
  calculateHomeLoanOffset,
  HomeLoanOffsetInputSchema,
} from '../edr/domain/calculators/home-loan-offset'
import {
  calculateIntroductoryRateLoan,
  IntroductoryRateLoanInputSchema,
} from '../edr/domain/calculators/introductory-rate-loan'
import {
  calculateLoanComparison,
  LoanComparisonInputSchema,
} from '../edr/domain/calculators/loan-comparison'
import {
  calculateMortgageSwitching,
  MortgageSwitchingInputSchema,
} from '../edr/domain/calculators/mortgage-switching'
import {
  calculateLeasing,
  LeasingInputSchema,
} from '../edr/domain/calculators/leasing'
import {
  calculateReverseMortgage,
  ReverseMortgageInputSchema,
} from '../edr/domain/calculators/reverse-mortgage'

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

  return compileLayoutCompat(resultLayout)
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
    schema: mortgageCalculatorInputSchema as any,
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

// ═══════════════════════════════════════════════════════════════════════════
// New Calculator Engine Registrations
// ═══════════════════════════════════════════════════════════════════════════

registerCalculator({
  id: 'loan-repayment',
  name: 'Loan Repayment Calculator',
  description:
    'Calculate standard mortgage repayments using the Australian formula: ' +
    'M = P * r * (1+r)^n / ((1+r)^n - 1). Returns monthly, fortnightly, and ' +
    'weekly repayment amounts plus total interest and total cost.',
  category: 'loan',
  inputSchema: LoanRepaymentInputSchema,
  execute: (input) => calculateLoanRepayment(input),
})

registerCalculator({
  id: 'budget-planner',
  name: 'Budget Planner Calculator',
  description:
    'Calculate budget surplus or deficit based on income (4 categories) and ' +
    'expenses (10 categories). Returns savings rate, expense ratio, and detailed breakdowns.',
  category: 'budget',
  inputSchema: BudgetPlannerInputSchema,
  execute: (input) => calculateBudgetPlanner(input),
})

registerCalculator({
  id: 'stamp-duty',
  name: 'Stamp Duty Calculator',
  description:
    'Calculate stamp duty / transfer duty for all 8 Australian states and territories. ' +
    'Includes first home buyer concessions for NSW, VIC, QLD, WA, and SA. ' +
    'Returns duty amount, effective rate, and concession details.',
  category: 'stamp-duty',
  inputSchema: StampDutyInputSchema,
  execute: (input) => calculateStampDuty(input),
})

registerCalculator({
  id: 'savings-goal',
  name: 'Savings Goal Calculator',
  description:
    'Calculate how long it will take to reach a savings goal. Given current savings, ' +
    'monthly contributions, and interest rate, returns months to goal, total contributions, ' +
    'and total interest earned.',
  category: 'investment',
  inputSchema: SavingsGoalInputSchema,
  execute: (input) => calculateSavingsGoal(input),
})

registerCalculator({
  id: 'repayment-comparison',
  name: 'Repayment Comparison Calculator',
  description:
    'Compare standard loan repayment with an extra repayment strategy. Shows months saved, ' +
    'interest saved, and the new total cost when making extra repayments on a loan.',
  category: 'loan',
  inputSchema: RepaymentComparisonInputSchema,
  execute: (input) => calculateRepaymentComparison(input),
})

registerCalculator({
  id: 'lvr-calculator',
  name: 'LVR Calculator',
  description:
    'Calculate Loan-to-Value Ratio (LVR) for a property purchase. Given property value ' +
    'and loan amount, returns LVR percentage, estimated stamp duty, and LMI indicator.',
  category: 'property',
  inputSchema: LvrCalculatorInputSchema,
  execute: (input) => calculateLvr(input),
})

registerCalculator({
  id: 'rent-vs-buy',
  name: 'Rent vs Buy Calculator',
  description:
    'Compare the financial outcome of renting vs buying a home. Given property price, ' +
    'rent, savings, and investment returns, compares net worth over a time horizon.',
  category: 'comparison',
  inputSchema: RentVsBuyInputSchema,
  execute: (input) => calculateRentVsBuy(input),
})

registerCalculator({
  id: 'borrowing-power',
  name: 'Borrowing Power Calculator',
  description:
    'Estimate maximum borrowable amount from income, expenses, and serviceability assumptions. ' +
    'Uses conservative buffer rates and employment-type stability multipliers.',
  category: 'loan',
  inputSchema: BorrowingPowerInputSchema,
  execute: (input) => calculateBorrowingPower(input),
})

registerCalculator({
  id: 'property-buying-cost',
  name: 'Property Buying Cost Calculator',
  description:
    'Estimate total upfront and ongoing costs when purchasing a property. ' +
    'Includes stamp duty (by state), LMI, legal fees, inspection, moving costs, and grants.',
  category: 'property',
  inputSchema: PropertyBuyingCostInputSchema,
  execute: (input) => calculatePropertyBuyingCost(input),
})

registerCalculator({
  id: 'property-selling-cost',
  name: 'Property Selling Cost Calculator',
  description:
    'Estimate selling costs and net proceeds. ' +
    'Includes agent commission, marketing, conveyancing, mortgage discharge, and moving costs.',
  category: 'property',
  inputSchema: PropertySellingCostInputSchema,
  execute: (input) => calculatePropertySellingCost(input),
})

registerCalculator({
  id: 'comparison-rate',
  name: 'Comparison Rate Calculator',
  description:
    'Estimate the true annualised cost of a loan including fees and charges. ' +
    'Uses Newton-Raphson iteration to solve for the comparison rate.',
  category: 'loan',
  inputSchema: ComparisonRateInputSchema,
  execute: (input) => calculateComparisonRate(input),
})

registerCalculator({
  id: 'extra-repayment',
  name: 'Extra Repayment Calculator',
  description:
    'Model the impact of additional repayments on a loan. ' +
    'Shows months saved, interest saved, and new total cost.',
  category: 'loan',
  inputSchema: ExtraRepaymentInputSchema,
  execute: (input) => calculateExtraRepayment(input),
})

registerCalculator({
  id: 'interest-only-mortgage',
  name: 'Interest Only Mortgage Calculator',
  description:
    'Calculate interest-only repayments and compare with principal-and-interest. ' +
    'Shows the extra cost of an interest-only period vs standard P&I.',
  category: 'loan',
  inputSchema: InterestOnlyInputSchema,
  execute: (input) => calculateInterestOnly(input),
})

registerCalculator({
  id: 'how-long-to-repay',
  name: 'How Long to Repay Calculator',
  description:
    'Calculate how long it will take to repay a loan given a fixed repayment amount. ' +
    'Returns months to payoff and total interest paid.',
  category: 'loan',
  inputSchema: HowLongToRepayInputSchema,
  execute: (input) => calculateHowLongToRepay(input),
})

registerCalculator({
  id: 'lump-sum-repayment',
  name: 'Lump Sum Repayment Calculator',
  description:
    'Calculate the impact of a lump sum payment on a loan. ' +
    'Shows months saved, interest saved, and new payoff date.',
  category: 'loan',
  inputSchema: LumpSumRepaymentInputSchema,
  execute: (input) => calculateLumpSumRepayment(input),
})

registerCalculator({
  id: 'income-tax',
  name: 'Income Tax Calculator',
  description:
    'Estimate Australian income tax liability using progressive tax brackets ' +
    'with medicare levy and offsets. Uses 2025-26 ATO rates.',
  category: 'general',
  inputSchema: IncomeTaxInputSchema,
  execute: (input) => calculateIncomeTax(input),
})

registerCalculator({
  id: 'compound-interest',
  name: 'Compound Interest Calculator',
  description:
    'Project future value of an investment with regular contributions ' +
    'and compound interest. Supports monthly, quarterly, and annual compounding.',
  category: 'investment',
  inputSchema: CompoundInterestInputSchema,
  execute: (input) => calculateCompoundInterest(input),
})

registerCalculator({
  id: 'credit-card',
  name: 'Credit Card Calculator',
  description:
    'Estimate credit card payoff time and total interest. ' +
    'Supports introductory rates and balance transfer fees.',
  category: 'general',
  inputSchema: CreditCardInputSchema,
  execute: (input) => calculateCreditCard(input),
})

registerCalculator({
  id: 'income-annualisation',
  name: 'Income Annualisation Calculator',
  description:
    'Convert irregular or part-period income into annualized, weekly, ' +
    'and monthly equivalent figures.',
  category: 'general',
  inputSchema: IncomeAnnualisationInputSchema,
  execute: (input) => calculateIncomeAnnualisation(input),
})

registerCalculator({
  id: 'income-gross-up',
  name: 'Income Gross Up Calculator',
  description:
    'Convert net (after-tax) income to gross (pre-tax) equivalent ' +
    'using a given tax rate or gross-up rate.',
  category: 'general',
  inputSchema: IncomeGrossUpInputSchema,
  execute: (input) => calculateIncomeGrossUp(input),
})

registerCalculator({
  id: 'split-loan',
  name: 'Split Loan Calculator',
  description: 'Calculate loans split across fixed and variable portions. Returns individual repayments, total, and weighted average rate.',
  category: 'loan',
  inputSchema: SplitLoanInputSchema,
  execute: (input) => calculateSplitLoan(input),
})

registerCalculator({
  id: 'home-loan-offset',
  name: 'Home Loan Offset Calculator',
  description: 'Estimate interest savings from an offset account. Compares with-offset amortization against no-offset baseline.',
  category: 'loan',
  inputSchema: HomeLoanOffsetInputSchema,
  execute: (input) => calculateHomeLoanOffset(input),
})

registerCalculator({
  id: 'introductory-rate-loan',
  name: 'Introductory Rate Loan Calculator',
  description: 'Model an introductory (honeymoon) rate loan that reverts after a fixed period. Shows the jump in repayments.',
  category: 'loan',
  inputSchema: IntroductoryRateLoanInputSchema,
  execute: (input) => calculateIntroductoryRateLoan(input),
})

registerCalculator({
  id: 'loan-comparison',
  name: 'Loan Comparison Calculator',
  description: 'Compare two or more loan options side-by-side. Finds best by total cost, monthly repayment, and interest saved.',
  category: 'comparison',
  inputSchema: LoanComparisonInputSchema,
  execute: (input) => calculateLoanComparison(input),
})

registerCalculator({
  id: 'mortgage-switching',
  name: 'Mortgage Switching Calculator',
  description: 'Compare staying with current loan vs switching/refinancing. Includes break-even analysis with upfront costs.',
  category: 'comparison',
  inputSchema: MortgageSwitchingInputSchema,
  execute: (input) => calculateMortgageSwitching(input),
})

registerCalculator({
  id: 'leasing',
  name: 'Leasing Calculator',
  description: 'Estimate lease payments for an asset given price, residual value, interest rate, term, and fees.',
  category: 'general',
  inputSchema: LeasingInputSchema,
  execute: (input) => calculateLeasing(input),
})

registerCalculator({
  id: 'reverse-mortgage',
  name: 'Reverse Mortgage Calculator',
  description: 'Estimate reverse mortgage drawdown and projected loan balance over time. Includes equity remaining analysis.',
  category: 'general',
  inputSchema: ReverseMortgageInputSchema,
  execute: (input) => calculateReverseMortgage(input),
})

/** Re-export the engine utilities for convenience */
export { registerCalculator, listCalculators, getCalculator, executeCalculator }