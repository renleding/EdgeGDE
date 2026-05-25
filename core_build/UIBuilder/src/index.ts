/**
 * EdgeGDE Mortgage Calculator — Hono Edge Runtime
 * HSAES Phase 3: Hono runtime with health check, MCP discovery, and route mounting.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import { router as calculatorRouter } from './routes/staged/calculator'

// ═══════════════════════════════════════════════════════════════════════════
// MCP Calculator Registry — dynamic source of truth for tool definitions
// ═══════════════════════════════════════════════════════════════════════════

const CALCULATOR_REGISTRY = [
  {
    name: 'calculate_mortgage',
    description:
      'Calculate mortgage repayments based on Australian lending standards',
    inputSchema: {
      type: 'object' as const,
      properties: {
        principal: {
          type: 'number' as const,
          description: 'Loan amount in AUD',
        },
        interestRate: {
          type: 'number' as const,
          description: 'Annual interest rate as percentage',
        },
        loanTerm: {
          type: 'number' as const,
          description: 'Loan term in years',
        },
        repaymentFrequency: {
          type: 'string' as const,
          enum: ['monthly', 'fortnightly', 'weekly'],
          description: 'Repayment frequency',
        },
        rateType: {
          type: 'string' as const,
          enum: ['fixed', 'variable', 'split'],
          description: 'Type of interest rate',
        },
        fixedRatePeriod: {
          type: 'number' as const,
          description:
            'Fixed rate period in years (required if rateType is fixed)',
        },
        additionalRepayment: {
          type: 'number' as const,
          description: 'Additional monthly repayment amount',
        },
      },
      required: ['principal', 'interestRate', 'loanTerm'],
    },
  },
]

// ═══════════════════════════════════════════════════════════════════════════
// App Initialization
// ═══════════════════════════════════════════════════════════════════════════

const app = new Hono()

// ═══════════════════════════════════════════════════════════════════════════
// Health Check — zero dependency endpoint
// ═══════════════════════════════════════════════════════════════════════════

app.get('/healthz', (c) => {
  return c.text('ok')
})

// ═══════════════════════════════════════════════════════════════════════════
// MCP Discovery Document — dynamically derived from CALCULATOR_REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

app.get('/.well-known/mcp.json', (c) => {
  const discoveryDoc = {
    protocolVersion: '2025-03-26',
    tools: CALCULATOR_REGISTRY,
  }
  c.header('Cache-Control', 'public, max-age=60')
  return c.json(discoveryDoc)
})

// ═══════════════════════════════════════════════════════════════════════════
// Mount Calculator Routes
// ═══════════════════════════════════════════════════════════════════════════

app.route('/api', calculatorRouter)

export default app
