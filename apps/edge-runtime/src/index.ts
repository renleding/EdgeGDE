     1|/**
     2| * EdgeGDE Mortgage Calculator — Hono Edge Runtime
     3| * HSAES Phase 3: Hono runtime with health check, MCP discovery, and route mounting.
     4| *
     5| * @packageDocumentation
     6| */
     7|
     8|import { Hono } from 'hono'
     9|import { router as calculatorRouter } from './routes/staged/calculator'
    10|
    11|// ═══════════════════════════════════════════════════════════════════════════
    12|// MCP Calculator Registry — dynamic source of truth for tool definitions
    13|// ═══════════════════════════════════════════════════════════════════════════
    14|
    15|const CALCULATOR_REGISTRY = [
    16|  {
    17|    name: 'calculate_mortgage',
    18|    description:
    19|      'Calculate mortgage repayments based on Australian lending standards',
    20|    inputSchema: {
    21|      type: 'object' as const,
    22|      properties: {
    23|        principal: {
    24|          type: 'number' as const,
    25|          description: 'Loan amount in AUD',
    26|        },
    27|        interestRate: {
    28|          type: 'number' as const,
    29|          description: 'Annual interest rate as percentage',
    30|        },
    31|        loanTerm: {
    32|          type: 'number' as const,
    33|          description: 'Loan term in years',
    34|        },
    35|        repaymentFrequency: {
    36|          type: 'string' as const,
    37|          enum: ['monthly', 'fortnightly', 'weekly'],
    38|          description: 'Repayment frequency',
    39|        },
    40|        rateType: {
    41|          type: 'string' as const,
    42|          enum: ['fixed', 'variable', 'split'],
    43|          description: 'Type of interest rate',
    44|        },
    45|        fixedRatePeriod: {
    46|          type: 'number' as const,
    47|          description:
    48|            'Fixed rate period in years (required if rateType is fixed)',
    49|        },
    50|        additionalRepayment: {
    51|          type: 'number' as const,
    52|          description: 'Additional monthly repayment amount',
    53|        },
    54|      },
    55|      required: ['principal', 'interestRate', 'loanTerm'],
    56|    },
    57|  },
    58|]
    59|
    60|// ═══════════════════════════════════════════════════════════════════════════
    61|// App Initialization
    62|// ═══════════════════════════════════════════════════════════════════════════
    63|
    64|const app = new Hono()
    65|
    66|// ═══════════════════════════════════════════════════════════════════════════
    67|// Health Check — zero dependency endpoint
    68|// ═══════════════════════════════════════════════════════════════════════════
    69|
    70|app.get('/healthz', (c) => {
    71|  return c.text('ok')
    72|})
    73|
    74|// ═══════════════════════════════════════════════════════════════════════════
    75|// MCP Discovery Document — dynamically derived from CALCULATOR_REGISTRY
    76|// ═══════════════════════════════════════════════════════════════════════════
    77|
    78|app.get('/.well-known/mcp.json', (c) => {
    79|  const discoveryDoc = {
    80|    protocolVersion: '2025-03-26',
    81|    tools: CALCULATOR_REGISTRY,
    82|  }
    83|  c.header('Cache-Control', 'public, max-age=60')
    84|  return c.json(discoveryDoc)
    85|})
    86|
    87|// ═══════════════════════════════════════════════════════════════════════════
    88|// Mount Calculator Routes
    89|// ═══════════════════════════════════════════════════════════════════════════
    90|
    91|app.route('/api', calculatorRouter)
    92|
    93|export default app
    94|