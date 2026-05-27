/**
 * EdgeGDE EDR — Domain: Loan Calculator
 * v4.9.0: Pure, deterministic financial calculation engine.
 * Zero dependencies on HTMX, KV, or any framework.
 *
 * INVARIANTS:
 *   - must_be_pure_function
 *   - must_be_deterministic
 *   - must_not_depend_on_htmx
 *   - must_not_use_kv
 *
 * @packageDocumentation
 */

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface LoanInput {
  loanAmount: number
  interestRate: number
  termYears: number
}

export interface LoanOutput {
  monthly: number
  fortnightly: number
  weekly: number
  totalInterest: number
  totalRepayment: number
}

// ═══════════════════════════════════════════════════════════════════════════
// Pure Calculation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Standard Australian mortgage formula:
 *   M = P * [r(1 + r)^n] / [(1 + r)^n - 1]
 *
 * Where:
 *   P = loanAmount (principal)
 *   r = monthly interest rate (interestRate / 12 / 100)
 *   n = total monthly payments (termYears * 12)
 *
 * @returns Deterministic LoanOutput with rounded (2dp) values
 */
export function calculateLoan(input: LoanInput): LoanOutput {
  const { loanAmount, interestRate, termYears } = input
  const r = interestRate / 100 / 12
  const n = termYears * 12

  let monthly: number
  if (r <= 0 || loanAmount <= 0) {
    monthly = 0
  } else {
    monthly = (loanAmount * r) / (1 - Math.pow(1 + r, -n))
  }

  const round2 = (v: number) => Math.round(v * 100) / 100

  monthly = round2(monthly)
  const annualCost = monthly * 12

  return {
    monthly,
    fortnightly: round2(annualCost / 26),
    weekly: round2(annualCost / 52),
    totalInterest: round2(Math.max(0, monthly * n - loanAmount)),
    totalRepayment: round2(monthly * n),
  }
}
