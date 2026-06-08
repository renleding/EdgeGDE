/**
 * EdgeGDE — Policy Rule Engine
 * Deterministic condition evaluation over flattened projection state.
 * No flow, no trees — just ordered conditions producing outputs.
 *
 * @packageDocumentation
 */

export interface Rule {
  id: string
  tenant_id: string
  condition: string
  output: string
  priority: number
  active: boolean | number
  created_at: number
}

export interface RuleOutput {
  stage?: string
  flags: string[]
  required_disclosures: string[]
  required_fields: string[]
}

// ═══════════════════════════════════════════════════════════════════════════
// Condition tokenizer
// ═══════════════════════════════════════════════════════════════════════════

interface Token {
  type: 'field' | 'op' | 'value' | 'and' | 'or'
  raw: string
}

function tokenize(condition: string): Token[] {
  const tokens: Token[] = []
  const parts = condition.match(/(?:[<>=!]+|[A-Za-z_][A-Za-z0-9_]*|'[^']*'|"[^"]*"|\d+\.?\d*|\band\b|\bor\b)/gi)
  if (!parts) return tokens

  for (const p of parts) {
    const lower = p.toLowerCase()
    if (lower === 'and') tokens.push({ type: 'and', raw: p })
    else if (lower === 'or') tokens.push({ type: 'or', raw: p })
    else if (/^[<>=!]+$/.test(p)) tokens.push({ type: 'op', raw: p })
    else if (/^\d+\.?\d*$/.test(p)) tokens.push({ type: 'value', raw: p })
    else tokens.push({ type: 'field', raw: p.replace(/['"]/g, '') })
  }

  return tokens
}

// ═══════════════════════════════════════════════════════════════════════════
// Simple expression evaluator — compares field OP value
// Returns the evaluation result and a description for simulation output
// ═══════════════════════════════════════════════════════════════════════════

export function evaluateCondition(condition: string, state: Record<string, unknown>): boolean {
  const tokens = tokenize(condition)

  // Supports simple: field op value [AND|OR field op value]*
  // Each clause: field op value
  // Multiple clauses joined by AND/OR

  let overallResult = false
  let currentMode: 'and' | 'or' = 'and'
  let i = 0

  while (i < tokens.length) {
    if (tokens[i].type === 'and') { currentMode = 'and'; i++; continue }
    if (tokens[i].type === 'or') { currentMode = 'or'; i++; continue }
    if (tokens[i].type === 'field' && i + 2 < tokens.length && tokens[i + 1].type === 'op') {
      const field = tokens[i].raw
      const op = tokens[i + 1].raw
      // Value can be a literal or another field
      let rawVal = tokens[i + 2]?.raw ?? ''
      // If the next token is also a field, it's a field-to-field comparison
      if (tokens[i + 2]?.type === 'value') {
        // literal value — keep as-is
      }

      const leftRaw = state[field]
      const result = compareValues(leftRaw, op, rawVal)

      if (currentMode === 'and') {
        overallResult = i === 0 ? result : (overallResult && result)
      } else {
        overallResult = overallResult || result
      }

      i += 3
    } else {
      i++
    }
  }

  return overallResult
}

// ═══════════════════════════════════════════════════════════════════════════
// Value comparison
// ═══════════════════════════════════════════════════════════════════════════

function compareValues(left: unknown, op: string, rightRaw: string): boolean {
  // Try numeric comparison first
  const leftNum = Number(left)
  const rightNum = Number(rightRaw)

  if (!isNaN(leftNum) && !isNaN(rightNum)) {
    switch (op) {
      case '<': return leftNum < rightNum
      case '>': return leftNum > rightNum
      case '<=': return leftNum <= rightNum
      case '>=': return leftNum >= rightNum
      case '==': return leftNum === rightNum
      case '!=': return leftNum !== rightNum
    }
  }

  // String fallback
  const leftStr = String(left ?? '')
  const rightStr = rightRaw.replace(/['"]/g, '')

  switch (op) {
    case '==': return leftStr === rightStr
    case '!=': return leftStr !== rightStr
    default: return false
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Flatten projection into a single Record<string, unknown>
// ═══════════════════════════════════════════════════════════════════════════

export function flattenProjection(projection: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(projection)) {
    const flatKey = prefix ? `${prefix}.${key}` : key

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Merge nested objects at top level (no nested path support in v1)
      Object.assign(result, flattenProjection(value as Record<string, unknown>, flatKey))
    } else {
      // Store with flat key AND try to lift to top level for match-anywhere access
      result[flatKey] = value
      // For common fields, also add without prefix for simpler conditions
      if (!prefix) result[key] = value
    }
  }

  return result
}

// ═══════════════════════════════════════════════════════════════════════════
// Parse rule output string into structured format
// "stage=blocked" → { stage: "blocked" }
// "flag=high_risk" → appends to flags[]
// ═══════════════════════════════════════════════════════════════════════════

export function parseRuleOutput(output: string): RuleOutput {
  const result: RuleOutput = { flags: [], required_disclosures: [], required_fields: [] }

  const parts = output.split(';').map(s => s.trim())
  for (const part of parts) {
    const eqIdx = part.indexOf('=')
    if (eqIdx === -1) continue

    const key = part.substring(0, eqIdx).trim()
    const val = part.substring(eqIdx + 1).trim()

    switch (key) {
      case 'stage':
        result.stage = val
        break
      case 'flag':
        result.flags.push(val)
        break
      case 'require_disclosure':
        result.required_disclosures.push(val)
        break
      case 'field_required':
        result.required_fields.push(val)
        break
    }
  }

  return result
}

// ═══════════════════════════════════════════════════════════════════════════
// Evaluate all active rules against a projection, return collected outputs
// ═══════════════════════════════════════════════════════════════════════════

export function evaluateRules(rules: Rule[], projection: Record<string, unknown>): RuleOutput {
  const outputs: RuleOutput = { flags: [], required_disclosures: [], required_fields: [] }

  // Sort: highest priority first, then newest
  const sorted = [...rules].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority
    return b.created_at - a.created_at
  })

  const state = flattenProjection(projection)

  for (const rule of sorted) {
    if (!rule.active) continue

    try {
      if (evaluateCondition(rule.condition, state)) {
        const parsed = parseRuleOutput(rule.output)

        if (parsed.stage) outputs.stage = parsed.stage
        outputs.flags.push(...parsed.flags)
        outputs.required_disclosures.push(...parsed.required_disclosures)
        outputs.required_fields.push(...parsed.required_fields)
      }
    } catch {
      // Skip rules that can't be evaluated (malformed conditions, etc.)
      continue
    }
  }

  return outputs
}

// ═══════════════════════════════════════════════════════════════════════════
// Simulate rules against mock input (for admin simulation UI)
// ═══════════════════════════════════════════════════════════════════════════

export interface SimulationResult {
  rule: Rule
  triggered: boolean
  output?: RuleOutput
}

export function simulateRules(rules: Rule[], mockState: Record<string, unknown>): SimulationResult[] {
  const state = flattenProjection(mockState)
  const sorted = [...rules].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority
    return b.created_at - a.created_at
  })

  return sorted.map(rule => {
    const triggered = evaluateCondition(rule.condition, state)
    return {
      rule,
      triggered,
      output: triggered ? parseRuleOutput(rule.output) : undefined,
    }
  })
}
