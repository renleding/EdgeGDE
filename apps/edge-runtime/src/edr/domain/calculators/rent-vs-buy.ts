/**
 * EdgeGDE — Domain: Rent vs Buy Calculator
 *
 * Compare net worth after N years for buying a property vs renting and
 * investing the savings. Includes property appreciation, mortgage costs,
 * and investment returns.
 *
 * Buy scenario: Use savings as deposit, borrow the remainder at a mortgage
 * rate. Property appreciates annually. Net worth = property value - remaining
 * loan balance.
 *
 * Rent scenario: Invest savings at the investment return rate. Rent is paid
 * from income (not modelled here, so net worth = invested savings).
 *
 * @packageDocumentation
 */

import { z } from 'zod'
import { roundMoney } from '../../../lib/calculator-engine'

// ═══════════════════════════════════════════════════════════════════════════
// Zod Schema
// ═══════════════════════════════════════════════════════════════════════════

export const RentVsBuyInputSchema = z
  .object({
    propertyPrice: z.number().positive('Property price must be positive'),
    weeklyRent: z.number().positive('Weekly rent must be positive'),
    savings: z.number().min(0, 'Savings cannot be negative'),
    investmentReturnRate: z.number().min(0, 'Investment return rate must be >= 0').max(100, 'Investment return rate must be <= 100'),
    timeHorizonYears: z.number().int('Time horizon must be whole years').positive('Time horizon must be positive'),
    mortgageRate: z.number().min(0, 'Mortgage rate must be >= 0').default(6),
    propertyAppreciation: z.number().min(0, 'Property appreciation must be >= 0').default(3),
    rentIncrease: z.number().min(0, 'Rent increase rate must be >= 0').default(3),
  })
  .strict()

export type RentVsBuyInput = z.infer<typeof RentVsBuyInputSchema>

// ═══════════════════════════════════════════════════════════════════════════
// Output Type
// ═══════════════════════════════════════════════════════════════════════════

export interface YearSnapshot {
  year: number
  buyNetWorth: number
  rentNetWorth: number
  buyAdvantage: number
}

export interface RentVsBuyOutput {
  buyNetWorth: number
  rentNetWorth: number
  netAdvantage: number
  buyAdvantage: boolean
  breakEvenYear: number | null
  yearSnapshots: YearSnapshot[]
}

// ═══════════════════════════════════════════════════════════════════════════
// Pure Calculation Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate the monthly mortgage repayment: M = P * r * (1+r)^n / ((1+r)^n - 1)
 */
function calcMonthlyPayment(principal: number, annualRate: number, termYears: number): number {
  const r = annualRate / 100 / 12
  const n = termYears * 12
  if (r === 0) return principal / n
  const onePlusR = 1 + r
  const powR = Math.pow(onePlusR, n)
  return principal * (r * powR) / (powR - 1)
}

/**
 * Calculate the remaining mortgage balance after a given number of years.
 */
function calcRemainingBalance(
  principal: number,
  annualRate: number,
  termYears: number,
  yearsElapsed: number,
): number {
  const r = annualRate / 100 / 12
  const n = termYears * 12
  const paymentsMade = Math.floor(yearsElapsed * 12)
  if (paymentsMade <= 0) return principal
  if (paymentsMade >= n) return 0

  const monthlyPayment = calcMonthlyPayment(principal, annualRate, termYears)

  if (r === 0) {
    return Math.max(0, principal - monthlyPayment * paymentsMade)
  }

  const onePlusR = 1 + r
  const balance =
    principal * Math.pow(onePlusR, paymentsMade) -
    monthlyPayment * (Math.pow(onePlusR, paymentsMade) - 1) / r
  return Math.max(0, balance)
}

// ═══════════════════════════════════════════════════════════════════════════
// Pure Calculation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compare buying vs renting over a time horizon.
 *
 * Buy: net worth = property value (appreciated) - remaining loan balance.
 * Rent: net worth = savings invested at investmentReturnRate.
 *
 * @param input - validated rent vs buy input
 * @returns net worth comparison with year-by-year snapshots
 */
export function calculateRentVsBuy(input: RentVsBuyInput): RentVsBuyOutput {
  const {
    propertyPrice,
    savings,
    investmentReturnRate,
    timeHorizonYears,
    mortgageRate = 6,
    propertyAppreciation = 3,
  } = input

  // Cap loan amount to property price
  const deposit = Math.min(savings, propertyPrice)
  const loanAmount = propertyPrice - deposit

  const invRate = investmentReturnRate / 100
  const apprRate = propertyAppreciation / 100
  const mortgageTerm = 30 // standard Australian mortgage term

  const yearSnapshots: YearSnapshot[] = []
  let breakEvenYear: number | null = null

  for (let y = 1; y <= timeHorizonYears; y++) {
    // --- Buy scenario ---
    const propertyValue = roundMoney(propertyPrice * Math.pow(1 + apprRate, y))

    const remainingLoan = loanAmount > 0
      ? calcRemainingBalance(loanAmount, mortgageRate, mortgageTerm, y)
      : 0

    const buyNetWorth = roundMoney(propertyValue - remainingLoan)

    // --- Rent scenario ---
    // Savings invested at the investment return rate; rent is paid from income
    const rentNetWorth = roundMoney(savings * Math.pow(1 + invRate, y))

    const buyAdvantage = roundMoney(buyNetWorth - rentNetWorth)

    yearSnapshots.push({
      year: y,
      buyNetWorth,
      rentNetWorth,
      buyAdvantage,
    })

    if (breakEvenYear === null && buyNetWorth >= rentNetWorth) {
      breakEvenYear = y
    }
  }

  const last = yearSnapshots[yearSnapshots.length - 1]

  return {
    buyNetWorth: last.buyNetWorth,
    rentNetWorth: last.rentNetWorth,
    netAdvantage: last.buyAdvantage,
    buyAdvantage: last.buyAdvantage > 0,
    breakEvenYear,
    yearSnapshots,
  }
}
