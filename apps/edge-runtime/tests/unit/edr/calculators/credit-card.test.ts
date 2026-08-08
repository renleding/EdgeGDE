import { describe, it, expect } from 'vitest'
import {
  CreditCardInputSchema,
  calculateCreditCard,
} from '../../../../src/edr/domain/calculators/credit-card'

describe('CreditCardInputSchema', () => {
  it('accepts a valid input and applies defaults', () => {
    const r = CreditCardInputSchema.safeParse({ balance: 5000, interestRate: 18, monthlyPayment: 200 })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.introRate).toBeUndefined()
      expect(r.data.introMonths).toBe(0)
      expect(r.data.transferFee).toBe(0)
    }
  })

  it('accepts optional intro rate', () => {
    const r = CreditCardInputSchema.safeParse({ balance: 5000, interestRate: 18, monthlyPayment: 200, introRate: 0 })
    expect(r.success).toBe(true)
  })

  it('rejects negative balance, non-positive payment, and out-of-range rates', () => {
    expect(CreditCardInputSchema.safeParse({ balance: -1, interestRate: 18, monthlyPayment: 200 }).success).toBe(false)
    expect(CreditCardInputSchema.safeParse({ balance: 5000, interestRate: 18, monthlyPayment: 0 }).success).toBe(false)
    expect(CreditCardInputSchema.safeParse({ balance: 5000, interestRate: 18, monthlyPayment: -10 }).success).toBe(false)
    expect(CreditCardInputSchema.safeParse({ balance: 5000, interestRate: 100.01, monthlyPayment: 200 }).success).toBe(false)
    expect(CreditCardInputSchema.safeParse({ balance: 5000, interestRate: 18, monthlyPayment: 200, introRate: 100.01 }).success).toBe(false)
  })

  it('rejects invalid intro months, negative transfer fee, and unknown keys', () => {
    expect(CreditCardInputSchema.safeParse({ balance: 5000, interestRate: 18, monthlyPayment: 200, introMonths: -1 }).success).toBe(false)
    expect(CreditCardInputSchema.safeParse({ balance: 5000, interestRate: 18, monthlyPayment: 200, introMonths: 2.5 }).success).toBe(false)
    expect(CreditCardInputSchema.safeParse({ balance: 5000, interestRate: 18, monthlyPayment: 200, transferFee: -1 }).success).toBe(false)
    expect(CreditCardInputSchema.safeParse({ balance: 5000, interestRate: 18, monthlyPayment: 200, extra: 1 }).success).toBe(false)
  })
})

describe('calculateCreditCard', () => {
  it('pays off with zero interest when rate is 0', () => {
    const r = calculateCreditCard({ balance: 5000, interestRate: 0, monthlyPayment: 200 })
    expect(r.monthsToPayoff).toBe(25)
    expect(r.totalInterest).toBe(0)
    expect(r.totalPaid).toBe(5000)
    expect(r.finalPayment).toBe(200)
    expect(r.monthsFormatted).toBe('25 months (2y 1m)')
    expect(r.totalInterestFormatted).toBe('$0.00')
    expect(r.totalPaidFormatted).toBe('$5000.00')
  })

  it('accumulates interest on the outstanding balance', () => {
    const r = calculateCreditCard({ balance: 10000, interestRate: 20, monthlyPayment: 300 })
    expect(r.monthsToPayoff).toBe(50)
    expect(r.totalInterest).toBe(4718.19)
    expect(r.totalPaid).toBe(14718.19)
  })

  it('applies the introductory rate for the intro period, then the standard rate', () => {
    const r = calculateCreditCard({ balance: 10000, interestRate: 20, monthlyPayment: 300, introRate: 0, introMonths: 12, transferFee: 100 })
    expect(r.monthsToPayoff).toBe(40)
    expect(r.totalInterest).toBe(1631.7)
    expect(r.totalPaid).toBe(11731.7) // balance + interest + transfer fee
  })

  it('returns zero months for a zero balance', () => {
    const r = calculateCreditCard({ balance: 0, interestRate: 18, monthlyPayment: 200 })
    expect(r.monthsToPayoff).toBe(0)
    expect(r.totalInterest).toBe(0)
    expect(r.totalPaid).toBe(0)
    expect(r.monthsFormatted).toBe('0 months (0y 0m)')
  })

  it('hits the 600-month cap when payment does not cover interest', () => {
    const r = calculateCreditCard({ balance: 100000, interestRate: 25, monthlyPayment: 100 })
    expect(r.monthsToPayoff).toBe(600)
    expect(r.monthsFormatted).toBe('600 months (50y 0m)')
  })
})
