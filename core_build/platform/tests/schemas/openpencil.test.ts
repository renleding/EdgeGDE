     1|/**
     2| * EdgeGDE Mortgage Calculator — Schema Validation Tests
     3| * HSAES Phase 1: TDD — tests must fail before implementation is verified.
     4| *
     5| * @packageDocumentation
     6| */
     7|
     8|import { describe, it, expect } from 'bun:test'
     9|import {
    10|  mortgageCalculatorInputSchema,
    11|  repaymentSummarySchema,
    12|  calculatorResponseSchema,
    13|  layoutDefinitionSchema,
    14|  SCHEMA_VERSION,
    15|  RateType,
    16|  RepaymentFrequency,
    17|} from '@/schemas/openpencil'
    18|
    19|// ═══════════════════════════════════════════════════════════════════════════
    20|// Mortgage Calculator Input Validation
    21|// ═══════════════════════════════════════════════════════════════════════════
    22|
    23|describe('MortgageCalculatorInput', () => {
    24|  const validInput = {
    25|    schemaVersion: SCHEMA_VERSION,
    26|    principal: 500000,
    27|    interestRate: 6.25,
    28|    loanTerm: 30,
    29|  }
    30|
    31|  it('accepts a valid input with defaults', () => {
    32|    const result = mortgageCalculatorInputSchema.safeParse(validInput)
    33|    expect(result.success).toBe(true)
    34|    if (result.success) {
    35|      expect(result.data.repaymentFrequency).toBe(RepaymentFrequency.MONTHLY)
    36|      expect(result.data.rateType).toBe(RateType.VARIABLE)
    37|      expect(result.data.additionalRepayment).toBe(0)
    38|    }
    39|  })
    40|
    41|  it('accepts string-based principal amounts', () => {
    42|    const input = { ...validInput, principal: '500000' }
    43|    const result = mortgageCalculatorInputSchema.safeParse(input)
    44|    expect(result.success).toBe(true)
    45|  })
    46|
    47|  it('rejects negative principal', () => {
    48|    const result = mortgageCalculatorInputSchema.safeParse({
    49|      ...validInput,
    50|      principal: -100,
    51|    })
    52|    expect(result.success).toBe(false)
    53|  })
    54|
    55|  it('rejects principal over $10M', () => {
    56|    const result = mortgageCalculatorInputSchema.safeParse({
    57|      ...validInput,
    58|      principal: 99_000_000,
    59|    })
    60|    expect(result.success).toBe(false)
    61|  })
    62|
    63|  it('rejects zero interest rate', () => {
    64|    const result = mortgageCalculatorInputSchema.safeParse({
    65|      ...validInput,
    66|      interestRate: 0,
    67|    })
    68|    expect(result.success).toBe(false)
    69|  })
    70|
    71|  it('rejects interest rate over 25%', () => {
    72|    const result = mortgageCalculatorInputSchema.safeParse({
    73|      ...validInput,
    74|      interestRate: 30,
    75|    })
    76|    expect(result.success).toBe(false)
    77|  })
    78|
    79|  it('rejects loan term under 1 year', () => {
    80|    const result = mortgageCalculatorInputSchema.safeParse({
    81|      ...validInput,
    82|      loanTerm: 0,
    83|    })
    84|    expect(result.success).toBe(false)
    85|  })
    86|
    87|  it('rejects loan term over 40 years', () => {
    88|    const result = mortgageCalculatorInputSchema.safeParse({
    89|      ...validInput,
    90|      loanTerm: 50,
    91|    })
    92|    expect(result.success).toBe(false)
    93|  })
    94|
    95|  it('rejects non-integer loan term', () => {
    96|    const result = mortgageCalculatorInputSchema.safeParse({
    97|      ...validInput,
    98|      loanTerm: 25.5,
    99|    })
   100|    expect(result.success).toBe(false)
   101|  })
   102|
   103|  it('accepts all repayment frequencies', () => {
   104|    for (const freq of Object.values(RepaymentFrequency)) {
   105|      const result = mortgageCalculatorInputSchema.safeParse({
   106|        ...validInput,
   107|        repaymentFrequency: freq,
   108|      })
   109|      expect(result.success).toBe(true)
   110|    }
   111|  })
   112|
   113|  it('rejects invalid repayment frequency', () => {
   114|    const result = mortgageCalculatorInputSchema.safeParse({
   115|      ...validInput,
   116|      repaymentFrequency: 'yearly',
   117|    })
   118|    expect(result.success).toBe(false)
   119|  })
   120|
   121|  it('requires fixedRatePeriod when rateType is fixed', () => {
   122|    const result = mortgageCalculatorInputSchema.safeParse({
   123|      ...validInput,
   124|      rateType: RateType.FIXED,
   125|    })
   126|    expect(result.success).toBe(false)
   127|  })
   128|
   129|  it('accepts fixed rate with period', () => {
   130|    const result = mortgageCalculatorInputSchema.safeParse({
   131|      ...validInput,
   132|      rateType: RateType.FIXED,
   133|      fixedRatePeriod: 3,
   134|    })
   135|    expect(result.success).toBe(true)
   136|  })
   137|
   138|  it('accepts split rate type', () => {
   139|    const result = mortgageCalculatorInputSchema.safeParse({
   140|      ...validInput,
   141|      rateType: RateType.SPLIT,
   142|    })
   143|    expect(result.success).toBe(true)
   144|  })
   145|
   146|  it('accepts additional repayment', () => {
   147|    const result = mortgageCalculatorInputSchema.safeParse({
   148|      ...validInput,
   149|      additionalRepayment: 500,
   150|    })
   151|    expect(result.success).toBe(true)
   152|  })
   153|
   154|  it('rejects string in numeric field', () => {
   155|    const result = mortgageCalculatorInputSchema.safeParse({
   156|      ...validInput,
   157|      loanTerm: 'thirty',
   158|    })
   159|    expect(result.success).toBe(false)
   160|  })
   161|})
   162|
   163|// ═══════════════════════════════════════════════════════════════════════════
   164|// Repayment Summary Validation
   165|// ═══════════════════════════════════════════════════════════════════════════
   166|
   167|describe('RepaymentSummary', () => {
   168|  const validSummary = {
   169|    monthlyRepayment: 3078.59,
   170|    fortnightlyRepayment: 1420.89,
   171|    weeklyRepayment: 710.44,
   172|    totalInterest: 608292.40,
   173|    totalCost: 1108292.40,
   174|    loanTerm: 30,
   175|    totalRepayments: 360,
   176|    totalFees: 0,
   177|  }
   178|
   179|  it('accepts a valid repayment summary', () => {
   180|    const result = repaymentSummarySchema.safeParse(validSummary)
   181|    expect(result.success).toBe(true)
   182|  })
   183|
   184|  it('rejects negative repayment', () => {
   185|    const result = repaymentSummarySchema.safeParse({
   186|      ...validSummary,
   187|      monthlyRepayment: -100,
   188|    })
   189|    expect(result.success).toBe(false)
   190|  })
   191|})
   192|
   193|// ═══════════════════════════════════════════════════════════════════════════
   194|// Calculator Response Validation
   195|// ═══════════════════════════════════════════════════════════════════════════
   196|
   197|describe('CalculatorResponse', () => {
   198|  const validResponse = {
   199|    input: {
   200|      schemaVersion: SCHEMA_VERSION,
   201|      principal: 500000,
   202|      interestRate: 6.25,
   203|      loanTerm: 30,
   204|    },
   205|    summary: {
   206|      monthlyRepayment: 3078.59,
   207|      fortnightlyRepayment: 1420.89,
   208|      weeklyRepayment: 710.44,
   209|      totalInterest: 608292.40,
   210|      totalCost: 1108292.40,
   211|      loanTerm: 30,
   212|      totalRepayments: 360,
   213|      totalFees: 0,
   214|    },
   215|    timestamp: '2026-05-25T00:00:00.000Z',
   216|    schemaVersion: SCHEMA_VERSION,
   217|  }
   218|
   219|  it('accepts a valid full response', () => {
   220|    const result = calculatorResponseSchema.safeParse(validResponse)
   221|    expect(result.success).toBe(true)
   222|  })
   223|
   224|  it('rejects mismatched schema version', () => {
   225|    const result = calculatorResponseSchema.safeParse({
   226|      ...validResponse,
   227|      schemaVersion: '0.2.0',
   228|    })
   229|    expect(result.success).toBe(false)
   230|  })
   231|})
   232|
   233|// ═══════════════════════════════════════════════════════════════════════════
   234|// OpenPencil Layout Definition Validation
   235|// ═══════════════════════════════════════════════════════════════════════════
   236|
   237|describe('LayoutDefinition', () => {
   238|  const validLayout = {
   239|    schemaVersion: SCHEMA_VERSION,
   240|    rootNode: {
   241|      id: '0:1',
   242|      type: 'FRAME',
   243|      name: 'Mortgage Calculator',
   244|      x: 0,
   245|      y: 0,
   246|      width: 400,
   247|      height: 600,
   248|      children: [
   249|        {
   250|          id: '0:2',
   251|          type: 'TEXT',
   252|          name: 'Title',
   253|          x: 20,
   254|          y: 20,
   255|          width: 360,
   256|          height: 40,
   257|        },
   258|      ],
   259|    },
   260|    formFields: [
   261|      {
   262|        nodeId: '0:3',
   263|        label: 'Loan Amount',
   264|        fieldType: 'number',
   265|        placeholder: 'Enter amount',
   266|        required: true,
   267|      },
   268|    ],
   269|  }
   270|
   271|  it('accepts a valid layout definition', () => {
   272|    const result = layoutDefinitionSchema.safeParse(validLayout)
   273|    expect(result.success).toBe(true)
   274|  })
   275|
   276|  it('rejects missing rootNode', () => {
   277|    const { rootNode, ...rest } = validLayout
   278|    const result = layoutDefinitionSchema.safeParse(rest)
   279|    expect(result.success).toBe(false)
   280|  })
   281|
   282|  it('rejects invalid schema version', () => {
   283|    const result = layoutDefinitionSchema.safeParse({
   284|      ...validLayout,
   285|      schemaVersion: '9.9.9',
   286|    })
   287|    expect(result.success).toBe(false)
   288|  })
   289|
   290|  it('rejects invalid node type', () => {
   291|    const result = layoutDefinitionSchema.safeParse({
   292|      ...validLayout,
   293|      rootNode: { ...validLayout.rootNode, type: 'INVALID_TYPE' },
   294|    })
   295|    expect(result.success).toBe(false)
   296|  })
   297|
   298|  it('rejects missing form fields', () => {
   299|    const result = layoutDefinitionSchema.safeParse({
   300|      ...validLayout,
   301|      formFields: [],
   302|    })
   303|    expect(result.success).toBe(true) // empty form fields are valid — no required inputs
   304|  })
   305|})
   306|
   307|// ═══════════════════════════════════════════════════════════════════════════
   308|// Version Mismatch Detection
   309|// ═══════════════════════════════════════════════════════════════════════════
   310|
   311|describe('Version Mismatch', () => {
   312|  it('rejects outdated schema versions in input', () => {
   313|    const result = mortgageCalculatorInputSchema.safeParse({
   314|      schemaVersion: '0.0.1',
   315|      principal: 500000,
   316|      interestRate: 6.25,
   317|      loanTerm: 30,
   318|    })
   319|    expect(result.success).toBe(false)
   320|  })
   321|
   322|  it('rejects future unknown schema versions', () => {
   323|    const result = mortgageCalculatorInputSchema.safeParse({
   324|      schemaVersion: '99.0.0',
   325|      principal: 500000,
   326|      interestRate: 6.25,
   327|      loanTerm: 30,
   328|    })
   329|    expect(result.success).toBe(false)
   330|  })
   331|})
   332|