/**
 * EdgeGDE — Calculator API Routes
 *
 * GET  /api/calculators — list available calculators
 * POST /api/calculators/calculate — execute a calculator
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import {
  listCalculators,
  executeCalculator,
} from '../lib/calculator-engine'

const calculatorApiRouter = new Hono()

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/calculators — list available calculators
// ═══════════════════════════════════════════════════════════════════════════

calculatorApiRouter.get('/api/calculators', (c) => {
  const calculators = listCalculators()
  return c.json({
    success: true,
    data: calculators.map((calc) => ({
      id: calc.id,
      name: calc.name,
      description: calc.description,
      category: calc.category,
    })),
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/calculators/calculate — execute a calculator
// ═══════════════════════════════════════════════════════════════════════════

calculatorApiRouter.post('/api/calculators/calculate', async (c) => {
  let body: { calculatorId?: string; input?: unknown }

  try {
    body = await c.req.json()
  } catch {
    return c.json(
      { success: false, error: 'Invalid JSON body' },
      400,
    )
  }

  if (!body.calculatorId || typeof body.calculatorId !== 'string') {
    return c.json(
      { success: false, error: 'calculatorId is required' },
      400,
    )
  }

  const result = executeCalculator(body.calculatorId, body.input)

  if (!result.success) {
    return c.json(result, 400)
  }

  return c.json(result)
})

export { calculatorApiRouter }
