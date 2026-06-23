/**
 * EdgeGDE — Calculator Engine MVP
 *
 * Calculator engine with safe formula evaluation using pre-defined functions,
 * Zod input validation per calculator, and rounding helpers.
 *
 * INVARIANTS:
 *   - must_be_pure_function (except KV-backed registry lookups)
 *   - must_be_deterministic
 *   - must_not_use_eval
 *
 * @packageDocumentation
 */

import { z } from 'zod'

// ═══════════════════════════════════════════════════════════════════════════
// Rounding Helpers
// ═══════════════════════════════════════════════════════════════════════════

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

export function formatAud(value: number): string {
  const formatted = Math.abs(value).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return value < 0 ? `-$${formatted}` : `$${formatted}`
}

export function formatPercent(value: number, decimals = 2): string {
  return `${value.toFixed(decimals)}%`
}

// ═══════════════════════════════════════════════════════════════════════════
// Calculator Definition Types
// ═══════════════════════════════════════════════════════════════════════════

export interface CalculatorDefinition {
  id: string
  name: string
  description: string
  category: 'loan' | 'budget' | 'stamp-duty' | 'investment' | 'general'
  inputSchema: z.ZodType<any, any, any>
  execute: (input: any) => Record<string, any>
}

// ═══════════════════════════════════════════════════════════════════════════
// In-memory registry
// ═══════════════════════════════════════════════════════════════════════════

const internalRegistry = new Map<string, CalculatorDefinition>()

export function registerCalculator(definition: CalculatorDefinition): void {
  if (internalRegistry.has(definition.id)) {
    throw new Error(`Calculator "${definition.id}" is already registered`)
  }
  internalRegistry.set(definition.id, definition)
}

export function listCalculators(): CalculatorDefinition[] {
  return Array.from(internalRegistry.values())
}

export function getCalculator(id: string): CalculatorDefinition | undefined {
  return internalRegistry.get(id)
}

// ═══════════════════════════════════════════════════════════════════════════
// Calculator Engine
// ═══════════════════════════════════════════════════════════════════════════

export interface CalculatorResult {
  calculatorId: string
  calculatorName: string
  success: boolean
  data?: Record<string, any>
  error?: string
  executedAt: string
}

export function executeCalculator(
  calculatorId: string,
  input: unknown,
): CalculatorResult {
  const calculator = getCalculator(calculatorId)

  if (!calculator) {
    return {
      calculatorId,
      calculatorName: calculatorId,
      success: false,
      error: `Unknown calculator: "${calculatorId}"`,
      executedAt: new Date().toISOString(),
    }
  }

  const parsed = calculator.inputSchema.safeParse(input)

  if (!parsed.success) {
    return {
      calculatorId,
      calculatorName: calculator.name,
      success: false,
      error: parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; '),
      executedAt: new Date().toISOString(),
    }
  }

  try {
    const data = calculator.execute(parsed.data)
    return {
      calculatorId,
      calculatorName: calculator.name,
      success: true,
      data,
      executedAt: new Date().toISOString(),
    }
  } catch (err: unknown) {
    return {
      calculatorId,
      calculatorName: calculator.name,
      success: false,
      error: err instanceof Error ? err.message : String(err),
      executedAt: new Date().toISOString(),
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Safe evaluation helpers (no eval)
// ═══════════════════════════════════════════════════════════════════════════

export function safePow(base: number, exponent: number): number {
  return Math.pow(base, exponent)
}

export function safeDivide(numerator: number, denominator: number): number {
  if (denominator === 0) {
    throw new Error('Division by zero')
  }
  return numerator / denominator
}
