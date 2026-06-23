/**
 * EdgeGDE — Domain: Calculators barrel export
 *
 * @packageDocumentation
 */

export {
  calculateLoanRepayment,
  LoanRepaymentInputSchema,
} from './loan-repayment'
export type { LoanRepaymentInput, LoanRepaymentOutput } from './loan-repayment'

export {
  calculateBudgetPlanner,
  BudgetPlannerInputSchema,
} from './budget-planner'
export type { BudgetPlannerInput, BudgetPlannerOutput, BudgetLine } from './budget-planner'

export {
  calculateStampDuty,
  StampDutyInputSchema,
  StampDutyStateSchema,
} from './stamp-duty'
export type { StampDutyInput, StampDutyOutput } from './stamp-duty'

export {
  calculateSavingsGoal,
  SavingsGoalInputSchema,
} from './savings-goal'
export type { SavingsGoalInput, SavingsGoalOutput } from './savings-goal'

export {
  calculateRepaymentComparison,
  RepaymentComparisonInputSchema,
} from './repayment-comparison'
export type { RepaymentComparisonInput, RepaymentComparisonOutput } from './repayment-comparison'

export {
  calculateLvr,
  LvrCalculatorInputSchema,
} from './lvr-calculator'
export type { LvrCalculatorInput, LvrCalculatorOutput } from './lvr-calculator'

export {
  calculateRentVsBuy,
  RentVsBuyInputSchema,
} from './rent-vs-buy'
export type { RentVsBuyInput, RentVsBuyOutput, YearSnapshot } from './rent-vs-buy'
