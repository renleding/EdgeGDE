/**
 * EdgeGDE — Form Definitions
 * Phase 29: All application forms registered via the Universal Form Engine.
 * Pure compute orchestration — math stays in lib/calculator.ts.
 *
 * @packageDocumentation
 */

import { registerForm } from '../lib/form-registry'
import type { FormDefinition, FormFieldDef } from '../lib/schemas'
import { calculateLoanMetrics } from '../lib/calculator'

// ═══════════════════════════════════════════════════════════════════════════
// Mortgage Calculator
// ═══════════════════════════════════════════════════════════════════════════

const mortgageFields: FormFieldDef[] = [
  {
    fieldName: 'loanAmount',
    label: 'Loan Amount',
    fieldType: 'number',
    validation: { required: true, min: 1, max: 100_000_000 },
    placeholder: 'e.g. 500000',
  },
  {
    fieldName: 'interestRate',
    label: 'Interest Rate (%)',
    fieldType: 'number',
    validation: { required: true, min: 0, max: 100 },
    placeholder: 'e.g. 5.5',
  },
  {
    fieldName: 'termYears',
    label: 'Term (years)',
    fieldType: 'number',
    validation: { required: true, min: 1, max: 30 },
    placeholder: 'e.g. 30',
  },
  {
    fieldName: 'income',
    label: 'Monthly Income',
    fieldType: 'number',
    validation: { min: 0 },
    placeholder: 'e.g. 10000',
  },
  {
    fieldName: 'expenses',
    label: 'Monthly Expenses',
    fieldType: 'number',
    validation: { min: 0 },
    placeholder: 'e.g. 3000',
  },
]

const mortgageForm: FormDefinition = {
  id: 'mortgage',
  label: 'Mortgage Calculator',
  endpoint: '/api/form/mortgage',
  fields: mortgageFields,
  submitLabel: 'Calculate',
  resultTargetId: 'results-mortgage',
}

// ═══════════════════════════════════════════════════════════════════════════
// Registration
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Register all application forms.
 * Call once at startup before mountFormRoutes().
 */
export function registerForms(): void {
  registerForm(mortgageForm, async (data) => {
    const metrics = calculateLoanMetrics({
      loanAmount: data.loanAmount as number,
      interestRate: data.interestRate as number,
      termYears: data.termYears as number,
      income: data.income as number,
      expenses: data.expenses as number,
    })

    const surplusClass = metrics.isSurplusPositive ? 'positive' : 'negative'
    const surplusPrefix = metrics.isSurplusPositive ? '' : '-'

    return (
      `<div id="results-mortgage" class="calculator-results">\n` +
      `  <div class="result-row">\n` +
      `    <span class="result-label">Monthly Repayment</span>\n` +
      `    <span class="result-value">${metrics.monthlyRepaymentFormatted}</span>\n` +
      `  </div>\n` +
      `  <div class="result-row">\n` +
      `    <span class="result-label">Total Repayment</span>\n` +
      `    <span class="result-value">${metrics.totalRepaymentFormatted}</span>\n` +
      `  </div>\n` +
      `  <div class="result-row">\n` +
      `    <span class="result-label">Surplus Income</span>\n` +
      `    <span class="result-value ${surplusClass}">${surplusPrefix}${metrics.surplusIncomeFormatted}</span>\n` +
      `  </div>\n` +
      `</div>`
    )
  })
}
