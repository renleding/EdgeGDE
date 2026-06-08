/**
 * EdgeGDE — Pack Upgrade Validator & Differ
 * Pre-upgrade checks: condition syntax, field references, schema compatibility.
 * Semantic diff: rule-level added/removed/modified with impact scoring.
 */

import { evaluateCondition } from '../../lib/rule-engine'

export interface CompatibilityReport {
  ok: boolean
  errors: string[]
  warnings: string[]
}

export interface SemanticDiff {
  rulesAdded: string[]
  rulesRemoved: string[]
  rulesModified: { condition: string; oldOutput: string; newOutput: string }[]
  complianceAdded: string[]
  complianceRemoved: string[]
  impactStatements: string[]
  impactScore: 'LOW' | 'MEDIUM' | 'HIGH'
}

// ═══════════════════════════════════════════════════════════════════════════
// Compatibility check
// ═══════════════════════════════════════════════════════════════════════════

export function validatePackCompatibility(
  newRules: any[],
  blueprintFields: string[],
): CompatibilityReport {
  const errors: string[] = []
  const warnings: string[] = []

  for (let i = 0; i < newRules.length; i++) {
    const rule = newRules[i]
    // Check condition is a string
    if (!rule.condition || typeof rule.condition !== 'string') {
      errors.push(`Rule ${i}: missing or invalid condition`)
      continue
    }

    // Check condition syntax by evaluating against empty state
    try {
      evaluateCondition(rule.condition, {})
    } catch {
      errors.push(`Rule ${i}: invalid condition syntax "${rule.condition}"`)
    }

    // Check that referenced fields exist in blueprint (skip string literals and operators)
    const fieldRefs = rule.condition.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []
    const ignored = new Set(['and', 'or', 'true', 'false', 'yes', 'no', 'self', 'employed'])
    for (const ref of fieldRefs) {
      if (ignored.has(ref.toLowerCase())) continue
      if (/^[A-Z][a-z]/.test(ref) && ref !== ref.toUpperCase()) continue  // skip CamelCase values
      if (!blueprintFields.includes(ref)) {
        warnings.push(`Rule ${i}: condition references "${ref}" which is not in blueprint fields`)
      }
    }

    // Check output format
    if (!rule.output || typeof rule.output !== 'string') {
      errors.push(`Rule ${i}: missing or invalid output`)
    }
  }

  return { ok: errors.length === 0, errors, warnings }
}

// ═══════════════════════════════════════════════════════════════════════════
// Semantic diff
// ═══════════════════════════════════════════════════════════════════════════

export function generatePackDiff(
  oldRules: any[],
  newRules: any[],
  oldCompliance?: any[],
  newCompliance?: any[],
): SemanticDiff {
  // Normalise conditions for comparison
  const oldMap = new Map<string, any>()
  for (const r of oldRules) oldMap.set(r.condition.trim(), r)

  const newMap = new Map<string, any>()
  for (const r of newRules) newMap.set(r.condition.trim(), r)

  const added: string[] = []
  const removed: string[] = []
  const modified: { condition: string; oldOutput: string; newOutput: string }[] = []

  // Detect added and modified
  for (const [cond, rule] of newMap) {
    if (!oldMap.has(cond)) {
      added.push(cond)
    } else {
      const old = oldMap.get(cond)
      if ((old.output || '') !== (rule.output || '')) {
        modified.push({ condition: cond, oldOutput: old.output || '', newOutput: rule.output || '' })
      }
    }
  }

  // Detect removed
  for (const [cond] of oldMap) {
    if (!newMap.has(cond)) removed.push(cond)
  }

  // Compliance diff
  const compAdded: string[] = []
  const compRemoved: string[] = []
  if (oldCompliance && newCompliance) {
    const oldCompSet = new Set(oldCompliance.map((e: any) => (e.value || '').trim()))
    const newCompSet = new Set(newCompliance.map((e: any) => (e.value || '').trim()))
    for (const v of newCompSet) { if (!oldCompSet.has(v)) compAdded.push(v) }
    for (const v of oldCompSet) { if (!newCompSet.has(v)) compRemoved.push(v) }
  }

  // Impact statements
  const impact: string[] = []
  if (added.length > 0) impact.push(`${added.length} new rule(s) added`)
  if (removed.length > 0) impact.push(`${removed.length} rule(s) removed`)
  if (modified.length > 0) impact.push(`${modified.length} rule(s) modified`)
  if (compAdded.length > 0) impact.push(`${compAdded.length} new disclosure(s) added`)
  if (compRemoved.length > 0) impact.push(`${compRemoved.length} disclosure(s) removed`)

  // Impact score
  let score: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW'
  const totalChanges = added.length + removed.length + modified.length + compAdded.length + compRemoved.length
  if (totalChanges > 5) score = 'HIGH'
  else if (totalChanges > 2) score = 'MEDIUM'

  return {
    rulesAdded: added,
    rulesRemoved: removed,
    rulesModified: modified,
    complianceAdded: compAdded,
    complianceRemoved: compRemoved,
    impactStatements: impact,
    impactScore: score,
  }
}