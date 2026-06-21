# Functional Specification: EdgeGDE Calculator Catalog

## 1. Objective

This specification defines the complete EdgeGDE calculator catalog and the deterministic architecture required to support it.

The goal is to replace the current partial mortgage/budget implementation with a catalog-grade calculator platform that can safely support:

- mortgage and loan calculators
- property transaction calculators
- savings and budget calculators
- repayment strategy calculators
- comparison and switching calculators
- income and leasing calculators

The calculator platform must remain deterministic, auditable, tenant-safe, and compatible with EdgeGDE's Cloudflare Workers runtime.

## 2. Scope

### 2.1 In Scope

This spec covers:

1. The full calculator catalog.
2. The calculator engine architecture.
3. The registry and MCP/API contract.
4. The schema and form contract.
5. The result display contract.
6. The validation and disclosure contract.
7. The test strategy.
8. The implementation phases.

### 2.2 Out of Scope

This spec does not prescribe:

- lender-specific approval rules
- credit policy decisions
- exact lender comparison-rate tables
- legal advice
- tax advice
- investment advice
- production deployment strategy
- tenant UI branding beyond the calculator framework

## 3. Assumptions

The following assumptions are made unless explicitly corrected:

1. EdgeGDE calculators are Australian financial-estimation tools.
2. Currency is AUD.
3. Calculators are estimates only and must display a non-advice disclosure.
4. Core calculation engines must be pure functions with no runtime dependencies.
5. All calculators must be deterministic for the same inputs and schema version.
6. No calculator may call an LLM to compute a result.
7. No calculator may write to KV, D1, R2, or external systems during calculation.
8. Existing `mortgage` and `budget` behavior must be preserved or explicitly migrated with compatibility aliases.
9. The current `CALCULATOR_REGISTRY` remains the runtime source of truth for calculator discovery.
10. The MCP discovery document must continue to derive calculator tools from the registry.

## 4. Current Baseline

Current calculator evidence:

- `apps/edge-runtime/src/registry/calculators.ts`
  - Contains `CALCULATOR_REGISTRY`
  - Currently registers only `mortgage`
  - Uses a mortgage-shaped result type
- `apps/edge-runtime/src/routes/api.ts`
  - `POST /api/v1/:toolId` executes registry tools
  - `GET /api/calculator/:toolId` renders a generic calculator page
  - JSON response assumes mortgage fields
- `apps/edge-runtime/src/index.ts`
  - `/.well-known/mcp.json` derives calculator tools from `CALCULATOR_REGISTRY`
- `apps/edge-runtime/src/edr/domain/calculator.ts`
  - Pure `calculateLoan`
- `apps/edge-runtime/src/edr/domain/budget.ts`
  - Pure `calculateBudget`
- `apps/edge-runtime/src/lib/calculator.ts`
  - Pure `calculateLoanMetrics`
- `apps/edge-runtime/src/registry/forms.ts`
  - Registers mortgage form only
- `apps/edge-runtime/src/routes/fragment.ts`
  - Provides legacy loan and budget fragments
- `packages/op-schema/src/openpencil.ts`
  - Mortgage schemas
- `apps/ui-builder/UIBuilder/src/schemas/openpencil.ts`
  - Duplicate mortgage schema

Current coverage against the requested catalog:

- Complete: 0 / 28
- Partial: 3 / 28
- Missing: 25 / 28

Partial coverage:

- Loan Repayment Calculator
- Fortnightly Repayment Calculator
- Budget Planner

## 5. Catalog Inventory

| ID | Display Name | Category | Current Status | Priority |
|---|---|---|---:|---:|
| `loan-repayment` | Loan Repayment Calculator | Loan | Partial | P0 |
| `borrowing-power` | Borrowing Power Calculator | Loan | Missing | P0 |
| `interest-only-mortgage` | Interest Only Mortgage Calculator | Loan | Missing | P1 |
| `stamp-duty` | Stamp Duty Calculator | Property | Missing | P0 |
| `income-tax` | Income Tax Calculator | Income | Missing | P2 |
| `saving` | Saving Calculator | Savings | Missing | P1 |
| `comparison-rate` | Comparison Rate Calculator | Loan | Missing | P1 |
| `extra-repayment` | Extra Repayment Calculator | Repayment Strategy | Missing | P1 |
| `lump-sum-repayment` | Lump Sum Repayment Calculator | Repayment Strategy | Missing | P1 |
| `how-long-to-repay` | How Long to Repay Calculator | Repayment Strategy | Missing | P1 |
| `split-loan` | Split Loan Calculator | Loan | Missing | P2 |
| `home-loan-offset` | Home Loan Offset Calculator | Loan | Missing | P2 |
| `introductory-rate-loan` | Introductory Rate Loan Calculator | Loan | Missing | P2 |
| `loan-comparison` | Loan Comparison Calculator | Comparison | Missing | P1 |
| `leasing` | Leasing Calculator | Asset Finance | Missing | P2 |
| `property-buying-cost` | Property Buying Cost Calculator | Property | Missing | P0 |
| `property-selling-cost` | Property Selling Cost Calculator | Property | Missing | P0 |
| `compound-interest` | Compound Interest Calculator | Savings | Missing | P1 |
| `budget-planner` | Budget Planner | Budget | Partial | P0 |
| `credit-card` | Credit Card Calculator | Credit | Missing | P1 |
| `reverse-mortgage` | Reverse Mortgage Calculator | Specialist | Missing | P3 |
| `income-annualisation` | Income Annualisation Calculator | Income | Missing | P1 |
| `income-gross-up` | Income Gross Up Calculator | Income | Missing | P1 |
| `savings-goal-how-long-to-save` | Savings Goal Calculator How Long to Save | Savings | Missing | P1 |
| `savings-goal-how-much-to-deposit` | Savings Goal Calculator How Much to Deposit | Savings | Missing | P1 |
| `fortnightly-repayment` | Fortnightly Repayment Calculator | Repayment | Partial | P1 |
| `mortgage-switching` | Mortgage Switching Calculator | Comparison | Missing | P2 |
| `rent-vs-buy` | Rent vs Buy Calculator | Comparison | Missing | P2 |

## 6. Target Architecture

### 6.1 Layering

The target architecture is:

```text
Browser / MCP client
  -> EdgeGDE API route
    -> Calculator registry
      -> Calculator engine
        -> Pure deterministic calculation
          -> Generic result envelope
            -> JSON / HTML / MCP response
```

### 6.2 Engine Location

New calculator engines must live under:

```text
apps/edge-runtime/src/edr/domain/calculators/
```

Recommended file map:

```text
src/edr/domain/calculators/
  loan-repayment.ts
  borrowing-power.ts
  interest-only-mortgage.ts
  stamp-duty.ts
  income-tax.ts
  saving.ts
  comparison-rate.ts
  extra-repayment.ts
  lump-sum-repayment.ts
  how-long-to-repay.ts
  split-loan.ts
  home-loan-offset.ts
  introductory-rate-loan.ts
  loan-comparison.ts
  leasing.ts
  property-buying-cost.ts
  property-selling-cost.ts
  compound-interest.ts
  budget-planner.ts
  credit-card.ts
  reverse-mortgage.ts
  income-annualisation.ts
  income-gross-up.ts
  savings-goal-how-long-to-save.ts
  savings-goal-how-much-to-deposit.ts
  fortnightly-repayment.ts
  mortgage-switching.ts
  rent-vs-buy.ts
  index.ts
```

### 6.3 Registry

`apps/edge-runtime/src/registry/calculators.ts` must become a true catalog registry.

Each calculator entry must include:

- `id`
- `displayName`
- `description`
- `category`
- `schema`
- `inputSchemaVersion`
- `engine`
- `summarize`
- `display`
- `disclosures`
- `aliases`

### 6.4 API Route

The current route:

```text
POST /api/v1/:toolId
GET  /api/calculator/:toolId
```

must remain supported.

The JSON response must be generic and must not assume mortgage-shaped fields.

### 6.5 MCP Discovery

`/.well-known/mcp.json` must continue deriving tools from `CALCULATOR_REGISTRY`.

Tool names must remain stable:

```text
calculate_<calculatorId>
```

Example:

```text
calculate_loan-repayment
calculate_stamp-duty
calculate_budget-planner
```

### 6.6 UI Builder Duplication

The duplicate mortgage schema in:

```text
apps/ui-builder/UIBuilder/src/schemas/openpencil.ts
```

must be synchronized with shared schema or removed from the UI Builder copy.

Shared schema must remain authoritative.

## 7. Common Type Contract

### 7.1 Core Types

```ts
export type CalculatorId = string

export type CalculatorCategory =
  | 'loan'
  | 'repayment-strategy'
  | 'property'
  | 'savings'
  | 'budget'
  | 'income'
  | 'credit'
  | 'comparison'
  | 'asset-finance'
  | 'specialist'

export interface CalculatorDisclosure {
  type: 'estimate' | 'not-financial-advice' | 'jurisdictional' | 'data-limit'
  text: string
}

export interface CalculatorSummaryItem {
  label: string
  value: string
  type: 'money' | 'percent' | 'number' | 'date' | 'text'
  tone?: 'positive' | 'negative' | 'neutral'
}

export interface CalculatorDisplaySection {
  title: string
  items: CalculatorSummaryItem[]
}

export interface CalculatorEngine<TInput, TResult> {
  (input: TInput): TResult
}

export interface CalculatorToolDefinition<TInput = unknown, TResult = unknown> {
  id: CalculatorId
  displayName: string
  description: string
  category: CalculatorCategory
  schema: z.ZodType<TInput>
  inputSchemaVersion: string
  engine: CalculatorEngine<TInput, TResult>
  summarize: (input: TInput, result: TResult) => CalculatorDisplaySection[]
  disclosures: CalculatorDisclosure[]
  aliases?: string[]
}
```

### 7.2 Response Envelope

All calculator responses must use a generic envelope:

```ts
export interface CalculatorResponseEnvelope<TResult> {
  calculatorId: CalculatorId
  displayName: string
  schemaVersion: string
  inputSchemaVersion: string
  input: unknown
  result: TResult
  summary: CalculatorDisplaySection[]
  disclosures: CalculatorDisclosure[]
  timestamp: string
}
```

### 7.3 Rounding Rules

All calculators must follow these rules:

1. Use integer cents internally where possible.
2. Expose currency values as numbers with two decimal places.
3. Round money to nearest cent.
4. Round percentages to two decimal places.
5. Never silently accept invalid negative principal or term values.
6. Never use `Date.now()` inside calculation engines.

## 8. Calculator Specifications

### 8.1 `loan-repayment` — Loan Repayment Calculator

**Purpose:** Calculate standard principal-and-interest loan repayments.

**Inputs:**

- `principal`
- `interestRate`
- `termYears`
- `repaymentFrequency`
- `feesUpfront`
- `feesAnnual`

**Outputs:**

- `monthlyRepayment`
- `fortnightlyRepayment`
- `weeklyRepayment`
- `totalInterest`
- `totalFees`
- `totalCost`
- `amortizationSchedule`

**Behavior:**

- Uses standard amortization formula.
- Handles zero interest.
- Converts between monthly, fortnightly, and weekly frequencies.
- Includes optional fees in total cost.

**Validation:**

- `principal > 0`
- `interestRate >= 0`
- `termYears >= 1`
- `repaymentFrequency` in `monthly | fortnightly | weekly`

**Tests:**

- Zero interest.
- Standard 30-year mortgage.
- Fee inclusion.
- Weekly/fortnightly/monthly equivalence.

### 8.2 `borrowing-power` — Borrowing Power Calculator

**Purpose:** Estimate maximum borrowable amount from income, expenses, and serviceability assumptions.

**Inputs:**

- `annualIncome`
- `monthlyExpenses`
- `existingDebtPayments`
- `deposit`
- `interestRate`
- `termYears`
- `interestRateBuffer`
- `employmentType`
- `dependents`
- `creditCommitments`

**Outputs:**

- `estimatedBorrowingPower`
- `serviceabilitySurplus`
- `assessedInterestRate`
- `maxLvrAmount`
- `depositRequiredForLvr`

**Behavior:**

- Applies deterministic serviceability formula.
- Uses conservative buffer.
- Does not claim lender approval.

**Validation:**

- Income non-negative.
- Expenses non-negative.
- Deposit non-negative.
- Interest rate non-negative.
- Term positive.

### 8.3 `interest-only-mortgage` — Interest Only Mortgage Calculator

**Purpose:** Calculate interest-only repayments and compare with principal-and-interest repayments.

**Inputs:**

- `principal`
- `interestRate`
- `interestOnlyYears`
- `totalTermYears`

**Outputs:**

- `interestOnlyRepayment`
- `principalAndInterestRepaymentAfterIo`
- `totalInterest`
- `totalRepayment`
- `extraCostVsPAndI`

**Behavior:**

- Calculates interest-only payment for interest-only period.
- Calculates P&I repayment over remaining term.
- Compares to standard P&I over full term.

### 8.4 `stamp-duty` — Stamp Duty Calculator

**Purpose:** Estimate property transfer duty.

**Inputs:**

- `stateOrTerritory`
- `propertyValue`
- `propertyType`
- `isFirstHomeBuyer`
- `isPrincipalPlaceOfResidence`
- `concessionType`

**Outputs:**

- `stampDuty`
- `concessionsApplied`
- `effectiveRate`
- `breakdown`

**Behavior:**

- Uses jurisdictional rate tables.
- Applies concessions only when criteria are met.
- Displays jurisdictional disclaimer.

**Validation:**

- Valid state/territory.
- Property value positive.
- Concession must be compatible with property type and buyer status.

### 8.5 `income-tax` — Income Tax Calculator

**Purpose:** Estimate Australian income tax liability.

**Inputs:**

- `taxableIncome`
- `residentStatus`
- `medicareLevyApplicable`
- `offsets`
- `deductions`

**Outputs:**

- `taxPayable`
- `medicareLevy`
- `offsetsApplied`
- `netTaxPayable`

**Behavior:**

- Uses progressive tax brackets.
- Applies offsets after tax calculation.
- Does not replace ATO advice.

### 8.6 `saving` — Saving Calculator

**Purpose:** Project future savings balance.

**Inputs:**

- `initialDeposit`
- `regularContribution`
- `contributionFrequency`
- `interestRate`
- `termYears`
- `compoundingFrequency`

**Outputs:**

- `futureBalance`
- `totalContributions`
- `interestEarned`
- `effectiveAnnualYield`

### 8.7 `comparison-rate` — Comparison Rate Calculator

**Purpose:** Estimate comparison rate including fees and charges.

**Inputs:**

- `principal`
- `interestRate`
- `termYears`
- `upfrontFees`
- `ongoingAnnualFees`
- `repaymentFrequency`

**Outputs:**

- `comparisonRate`
- `nominalRate`
- `totalFees`
- `effectiveAnnualCost`

**Behavior:**

- Solve for the annualized rate that reflects loan cost including fees.
- Use deterministic bisection or Newton method.
- Disclose lender-specific comparison rates may differ.

### 8.8 `extra-repayment` — Extra Repayment Calculator

**Purpose:** Model additional repayments against a loan.

**Inputs:**

- `principal`
- `interestRate`
- `termYears`
- `regularRepayment`
- `extraRepayment`
- `extraFrequency`
- `startDate`

**Outputs:**

- `newPayoffDate`
- `monthsSaved`
- `interestSaved`
- `totalInterest`
- `amortizationSchedule`

**Behavior:**

- Applies extra repayments on schedule.
- Stops when balance reaches zero.
- Recalculates interest saved against baseline.

### 8.9 `lump-sum-repayment` — Lump Sum Repayment Calculator

**Purpose:** Model a one-off lump-sum repayment.

**Inputs:**

- `principal`
- `interestRate`
- `termYears`
- `lumpSumAmount`
- `lumpSumMonth`
- `recalculateRepayment`

**Outputs:**

- `balanceAfterLumpSum`
- `interestSaved`
- `newPayoffDate`
- `newMonthlyRepayment` if recalculated

**Behavior:**

- Supports recast or keep-payment mode.
- Ensures lump sum does not exceed balance.

### 8.10 `how-long-to-repay` — How Long to Repay Calculator

**Purpose:** Solve payoff duration from payment amount.

**Inputs:**

- `principal`
- `interestRate`
- `repaymentAmount`
- `repaymentFrequency`

**Outputs:**

- `monthsToRepay`
- `yearsToRepay`
- `totalInterest`
- `finalPayment`

**Behavior:**

- Solves by iteration or closed-form logarithm.
- Rejects payment below interest-only amount.

### 8.11 `split-loan` — Split Loan Calculator

**Purpose:** Calculate loans split across fixed and variable portions.

**Inputs:**

- `totalPrincipal`
- `fixedPortion`
- `fixedRate`
- `fixedTermYears`
- `variableRate`
- `variableTermYears`

**Outputs:**

- `fixedRepayment`
- `variableRepayment`
- `totalRepayment`
- `totalInterest`
- `weightedAverageRate`

### 8.12 `home-loan-offset` — Home Loan Offset Calculator

**Purpose:** Estimate interest savings from an offset account.

**Inputs:**

- `loanBalance`
- `offsetBalance`
- `interestRate`
- `termYears`
- `offsetContributionFrequency`

**Outputs:**

- `interestSaved`
- `newPayoffDate`
- `effectiveLoanBalance`
- `monthlySaving`

**Behavior:**

- Applies offset balance against loan balance for interest calculation.
- Compares against no-offset baseline.

### 8.13 `introductory-rate-loan` — Introductory Rate Loan Calculator

**Purpose:** Model an introductory rate that reverts after a period.

**Inputs:**

- `principal`
- `introductoryRate`
- `introductoryMonths`
- `revertRate`
- `termYears`

**Outputs:**

- `introductoryRepayment`
- `revertRepayment`
- `totalInterest`
- `averageRate`

### 8.14 `loan-comparison` — Loan Comparison Calculator

**Purpose:** Compare two or more loan options side-by-side.

**Inputs:**

- `loans[]`
  - `name`
  - `principal`
  - `interestRate`
  - `termYears`
  - `feesUpfront`
  - `feesAnnual`
  - `repaymentFrequency`

**Outputs:**

- `bestByTotalCost`
- `bestByMonthlyRepayment`
- `bestByInterestSaved`
- `comparisonTable`

### 8.15 `leasing` — Leasing Calculator

**Purpose:** Estimate lease payments for an asset.

**Inputs:**

- `assetPrice`
- `residualValue`
- `interestRate`
- `termYears`
- `fees`
- `paymentFrequency`

**Outputs:**

- `leasePayment`
- `totalLeaseCost`
- `totalInterest`
- `residualAtEnd`

### 8.16 `property-buying-cost` — Property Buying Cost Calculator

**Purpose:** Estimate total upfront and ongoing buying costs.

**Inputs:**

- `purchasePrice`
- `deposit`
- `stateOrTerritory`
- `firstHomeBuyer`
- `lmiRequired`
- `legalFees`
- `inspectionFees`
- `movingCosts`
- `grantAmount`

**Outputs:**

- `stampDuty`
- `totalUpfrontCashRequired`
- `totalBuyingCost`
- `netCashRequiredAfterGrant`
- `breakdown`

### 8.17 `property-selling-cost` — Property Selling Cost Calculator

**Purpose:** Estimate selling costs and net proceeds.

**Inputs:**

- `salePrice`
- `agentCommissionRate`
- `marketingCosts`
- `conveyancingFees`
- `mortgageDischargeFee`
- `movingCosts`

**Outputs:**

- `totalSellingCost`
- `netProceeds`
- `breakdown`

### 8.18 `compound-interest` — Compound Interest Calculator

**Purpose:** Project compound growth.

**Inputs:**

- `principal`
- `regularContribution`
- `interestRate`
- `termYears`
- `compoundingFrequency`
- `contributionTiming`

**Outputs:**

- `futureValue`
- `totalContributions`
- `interestEarned`
- `effectiveAnnualRate`

### 8.19 `budget-planner` — Budget Planner

**Purpose:** Compare income and expenses.

**Inputs:**

- `salary`
- `investments`
- `government`
- `otherIncome`
- `housing`
- `food`
- `transport`
- `utilities`
- `insurance`
- `entertainment`
- `healthcare`
- `education`
- `debtPayments`
- `otherExpenses`

**Outputs:**

- `totalIncome`
- `totalExpenses`
- `surplus`
- `savingsRate`
- `expenseRatio`
- `incomeBreakdown`
- `expenseBreakdown`
- `isDeficit`

**Current status:** Partially implemented.

### 8.20 `credit-card` — Credit Card Calculator

**Purpose:** Estimate credit card payoff time and interest.

**Inputs:**

- `balance`
- `interestRate`
- `monthlyPayment`
- `introRate`
- `introMonths`
- `transferFee`

**Outputs:**

- `monthsToPayoff`
- `totalInterest`
- `totalPaid`
- `finalPayment`

### 8.21 `reverse-mortgage` — Reverse Mortgage Calculator

**Purpose:** Estimate reverse mortgage drawdown and balance over time.

**Inputs:**

- `propertyValue`
- `borrowerAge`
- `interestRate`
- `initialDrawdown`
- `regularDrawdown`
- `termYears`

**Outputs:**

- `projectedLoanBalance`
- `remainingEquity`
- `drawdownTotal`
- `equityRemainingPercent`

**Disclosures:**

- Specialist product.
- Must include strong not-financial-advice warning.

### 8.22 `income-annualisation` — Income Annualisation Calculator

**Purpose:** Convert irregular income into annualized estimate.

**Inputs:**

- `incomeAmount`
- `incomePeriod`
- `weeksWorkedPerYear`
- `employmentType`

**Outputs:**

- `annualisedIncome`
- `weeklyEquivalent`
- `monthlyEquivalent`

### 8.23 `income-gross-up` — Income Gross Up Calculator

**Purpose:** Convert net income to gross equivalent.

**Inputs:**

- `netIncome`
- `grossUpRate`
- `taxRate`
- `incomePeriod`

**Outputs:**

- `grossIncome`
- `grossUpAmount`
- `effectiveRate`

### 8.24 `savings-goal-how-long-to-save` — Savings Goal Calculator How Long to Save

**Purpose:** Calculate time required to reach a savings target.

**Inputs:**

- `targetAmount`
- `currentSavings`
- `regularContribution`
- `interestRate`
- `contributionFrequency`

**Outputs:**

- `monthsToGoal`
- `yearsToGoal`
- `finalContribution`
- `interestEarned`

### 8.25 `savings-goal-how-much-to-deposit` — Savings Goal Calculator How Much to Deposit

**Purpose:** Calculate required deposit amount to reach a goal.

**Inputs:**

- `targetAmount`
- `currentSavings`
- `termYears`
- `interestRate`
- `contributionFrequency`

**Outputs:**

- `requiredMonthlyDeposit`
- `requiredFortnightlyDeposit`
- `requiredWeeklyDeposit`
- `totalContributions`

### 8.26 `fortnightly-repayment` — Fortnightly Repayment Calculator

**Purpose:** Show fortnightly repayment view for a loan.

**Inputs:**

- Same as `loan-repayment`
- `repaymentFrequency` defaults to `fortnightly`

**Outputs:**

- Same as `loan-repayment`
- Emphasizes fortnightly payment and annual repayment count

**Behavior:**

- Implement as an alias/wrapper around `loan-repayment`.
- Do not duplicate calculation logic.

### 8.27 `mortgage-switching` — Mortgage Switching Calculator

**Purpose:** Compare staying with current loan versus switching/refinancing.

**Inputs:**

- `currentBalance`
- `currentRate`
- `currentRemainingYears`
- `newRate`
- `newFeesUpfront`
- `breakCosts`
- `newTermYears`

**Outputs:**

- `stayTotalCost`
- `switchTotalCost`
- `netSavingOrCost`
- `breakEvenMonths`

### 8.28 `rent-vs-buy` — Rent vs Buy Calculator

**Purpose:** Compare renting versus buying over a time horizon.

**Inputs:**

- `rentMonthly`
- `purchasePrice`
- `deposit`
- `mortgageRate`
- `mortgageTermYears`
- `propertyAppreciationRate`
- `sellingCostRate`
- `investmentReturnRate`
- `horizonYears`
- `maintenanceAnnual`
- `insuranceAnnual`

**Outputs:**

- `buyNetPosition`
- `rentNetPosition`
- `difference`
- `breakEvenYear`
- `comparisonTable`

## 9. Validation Rules

Every calculator must have:

1. Zod input schema.
2. Positive-value guards for money and term fields.
3. Enum validation for frequencies, states, property types, and resident status.
4. Cross-field validation where fields depend on each other.
5. Disclosure text.
6. At least one unit test for normal inputs.
7. At least one unit test for boundary inputs.
8. At least one unit test for invalid inputs.

## 10. Disclosure Rules

Every calculator must include:

- estimate-only disclosure
- not-financial-advice disclosure
- jurisdiction-specific disclosure where relevant

Example disclosures:

```text
This is an estimate only and is not financial advice.
Your actual result may vary based on your individual circumstances.
```

For property calculators:

```text
Duties, concessions, and grants vary by state or territory and may change.
```

For tax calculators:

```text
This is an estimate only and does not replace advice from a registered tax agent or the ATO.
```

## 11. Test Strategy

### 11.1 Unit Tests

Location:

```text
tests/edge-runtime/domain/calculators/
```

Each calculator must have a dedicated test file:

```text
loan-repayment.test.ts
borrowing-power.test.ts
...
```

Test style:

- deterministic exact assertions
- no ranges unless explicitly required
- known input -> known output
- boundary values included

### 11.2 Route Tests

Location:

```text
tests/edge-runtime/routes/calculators/
```

Must verify:

- valid JSON response
- validation errors
- generic response envelope
- MCP discovery compatibility
- HTMX HTML response
- unknown calculator returns 404

### 11.3 Schema Tests

Location:

```text
tests/packages/op-schema/
```

Must verify:

- schema parses valid inputs
- schema rejects invalid inputs
- schema version is present
- shared schema is authoritative

## 12. Implementation Phases

### Phase 1 — Foundation

Goals:

- generic calculator registry
- generic API response
- shared schema contract
- calculator test harness

Deliverables:

- `CalculatorToolDefinition`
- `CalculatorResponseEnvelope`
- generic route response
- first 3 tests

### Phase 2 — Core Loan Calculators

Implement:

- `loan-repayment`
- `fortnightly-repayment`
- `borrowing-power`
- `comparison-rate`
- `interest-only-mortgage`

### Phase 3 — Property Calculators

Implement:

- `stamp-duty`
- `property-buying-cost`
- `property-selling-cost`
- `rent-vs-buy`
- `mortgage-switching`

### Phase 4 — Repayment Strategy Calculators

Implement:

- `extra-repayment`
- `lump-sum-repayment`
- `how-long-to-repay`
- `split-loan`
- `home-loan-offset`
- `introductory-rate-loan`

### Phase 5 — Savings and Budget Calculators

Implement:

- `saving`
- `compound-interest`
- `budget-planner`
- `savings-goal-how-long-to-save`
- `savings-goal-how-much-to-deposit`

### Phase 6 — Income and Credit Calculators

Implement:

- `income-tax`
- `income-annualisation`
- `income-gross-up`
- `credit-card`
- `leasing`

### Phase 7 — Specialist Calculators

Implement:

- `reverse-mortgage`
- `loan-comparison`

## 13. Acceptance Criteria

This spec is complete when:

1. All 28 calculators are listed.
2. Each calculator has:
   - ID
   - display name
   - category
   - inputs
   - outputs
   - validation rules
   - disclosures
3. The architecture is generic enough to support all calculators without mortgage-specific coupling.
4. The response contract is generic.
5. The MCP discovery contract is preserved.
6. The test strategy is explicit.
7. No implementation code is required to be changed by this spec mission.

## 14. Non-Goals

This spec does not define:

- exact lender policy
- exact tax law
- exact stamp duty tables
- credit approval logic
- production deployment
- user onboarding flows

## 15. Risks and Mitigations

### Risk: Mortgage-specific API coupling

Mitigation:

- Replace hardcoded mortgage fields with generic result envelope.

### Risk: Duplicate schema drift

Mitigation:

- Shared schema remains authoritative.
- UI Builder duplicate must be synchronized or removed.

### Risk: Financial inaccuracy

Mitigation:

- Deterministic formulas.
- Explicit disclosures.
- Known-input tests.
- Jurisdictional data tables where required.

### Risk: Scope creep

Mitigation:

- Implement in phases.
- Do not add lender-specific policy in Phase 1.

## 16. Future Work

After this spec is accepted:

1. Create implementation mission.
2. Implement foundation types.
3. Implement Phase 1 calculators.
4. Verify with tests.
5. Commit and open PR.
6. Repeat by phase.

## 17. Verification Notes

This spec is documentation-only. It does not require runtime tests.

However, implementation must pass:

- `bun run typecheck`
- targeted calculator unit tests
- route smoke tests
- MCP discovery smoke test
- `git diff --check`

## 18. Final Checklist

- [x] Full catalog listed.
- [x] Current status captured.
- [x] Architecture defined.
- [x] API contract defined.
- [x] Schema contract defined.
- [x] Test strategy defined.
- [x] Disclosures defined.
- [x] Implementation phases defined.
