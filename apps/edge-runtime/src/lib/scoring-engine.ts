/**
 * EdgeGDE Runtime — Deterministic Lead Scoring Engine
 * Track 4 Phase 5: Rule-based scoring with no dynamic code execution.
 *
 * Input: lead fields + rubric ruleset
 * Output: { score, classification, trace }
 * Constraints: bounded 0-100, reproducible, no LLM calls
 */

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface RulesetRule {
  id: string
  type: 'numeric' | 'string' | 'regex'
  field: string
  op: 'gte' | 'lte' | 'eq' | 'contains' | 'regex'
  value: any
  points: number
}

export interface Classification {
  min: number
  max: number
  label: string
}

export interface Ruleset {
  version: number
  rules: RulesetRule[]
  scoring_metadata: {
    classifications: Classification[]
  }
}

export interface ScoreResult {
  score: number
  classification: string
  matchedRules: string[]
  scoreBreakdown: { ruleId: string; points: number }[]
  trace: RuleTrace[]
}

export interface RuleTrace {
  ruleId: string
  field: string
  op: string
  expected: any
  actual: any
  matched: boolean
  points: number
  pointsAwarded: number
}

// ═══════════════════════════════════════════════════════════════════════════
// Rule Evaluation (Deterministic, No Dynamic Code)
// ═══════════════════════════════════════════════════════════════════════════

function evaluateRule(rule: RulesetRule, fields: Record<string, unknown>): number {
  const actualValue = fields[rule.field]

  if (actualValue === undefined || actualValue === null) return 0

  const actual = typeof actualValue === 'string' ? actualValue.toLowerCase().trim() : actualValue
  const expected = typeof rule.value === 'string' ? rule.value.toLowerCase().trim() : rule.value

  let matched = false

  switch (rule.op) {
    case 'gte': {
      const numActual = typeof actual === 'number' ? actual : Number(actual)
      const numExpected = typeof expected === 'number' ? expected : Number(expected)
      if (!isNaN(numActual) && !isNaN(numExpected)) {
        matched = numActual >= numExpected
      }
      break
    }
    case 'lte': {
      const numActual = typeof actual === 'number' ? actual : Number(actual)
      const numExpected = typeof expected === 'number' ? expected : Number(expected)
      if (!isNaN(numActual) && !isNaN(numExpected)) {
        matched = numActual <= numExpected
      }
      break
    }
    case 'eq': {
      matched = String(actual) === String(expected)
      break
    }
    case 'contains': {
      if (typeof actual === 'string' && typeof expected === 'string') {
        matched = actual.includes(expected)
      }
      break
    }
    case 'regex': {
      if (typeof actual === 'string' && typeof expected === 'string') {
        try {
          matched = new RegExp(expected, 'i').test(actual)
        } catch {
          matched = false
        }
      }
      break
    }
  }

  return matched ? rule.points : 0
}

function classifyScore(score: number, classifications: Classification[]): string {
  for (const cls of classifications) {
    if (score >= cls.min && score <= cls.max) {
      return cls.label
    }
  }
  return 'Unknown'
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Scoring Function
// ═══════════════════════════════════════════════════════════════════════════

export function scoreLead(
  fields: Record<string, unknown>,
  ruleset: Ruleset,
): ScoreResult {
  let totalScore = 0
  const trace: RuleTrace[] = []
  const matchedRules: string[] = []
  const scoreBreakdown: { ruleId: string; points: number }[] = []

  for (const rule of ruleset.rules) {
    const pointsAwarded = evaluateRule(rule, fields)
    totalScore += pointsAwarded

    trace.push({
      ruleId: rule.id,
      field: rule.field,
      op: rule.op,
      expected: rule.value,
      actual: fields[rule.field],
      matched: pointsAwarded > 0,
      points: rule.points,
      pointsAwarded,
    })

    scoreBreakdown.push({ ruleId: rule.id, points: pointsAwarded })

    if (pointsAwarded > 0) {
      matchedRules.push(rule.id)
    }
  }

  // Clamp to 0-100
  const score = Math.max(0, Math.min(100, totalScore))

  const classification = classifyScore(
    score,
    ruleset.scoring_metadata?.classifications || [],
  )

  return { score, classification, matchedRules, scoreBreakdown, trace }
}
