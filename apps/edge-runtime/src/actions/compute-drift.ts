/**
 * EdgeGDE computeDrift — Pure function for deterministic state comparison
 *
 * FRS-001 / Q4: Drift = deterministic diff between expected mission state
 * and actual system state. Pure function — no side effects, operates on
 * projections not live mutation.
 *
 * @see docs/FRs-001-compensation-replay-reconcile-dryrun.md
 */

import type { DriftCategory, DriftResult } from './types'

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isPlainValue(v: unknown): boolean {
  return (
    typeof v === 'string' ||
    typeof v === 'number' ||
    typeof v === 'boolean' ||
    v === null ||
    v === undefined
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Comparison
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compare two flat or nested state objects and return an array of drifts.
 *
 * Rules:
 * - Keys in `expected` but not in `actual` → category: 'missing'
 * - Keys in `actual` but not in `expected` → category: 'extra'
 * - Keys present in both with different values:
 *   - Both primitive → category: 'mismatch'
 *   - Both objects → recursive comparison with joined path
 *   - Type differs → category: 'mismatch' with error severity
 * - If both values are objects with a `version` field and versions differ:
 *   - category: 'stale' (takes precedence over 'mismatch')
 * - If a key ends with `_computed` or `_derived` and value mismatches:
 *   - category: 'derived_error'
 */
export function computeDrift(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
  parentPath = '',
): DriftResult[] {
  const results: DriftResult[] = []
  const expectedKeys = new Set(Object.keys(expected))
  const actualKeys = new Set(Object.keys(actual))

  // Check for missing keys
  for (const key of expectedKeys) {
    const path = parentPath ? `${parentPath}.${key}` : key
    const expVal = expected[key]

    if (!actualKeys.has(key)) {
      // Compute severity based on value type
      // A missing critical number/string is error; missing optional bool is warning
      const severity = expVal === undefined ? 'info' : 'error'
      results.push({
        key,
        path,
        expected: expVal,
        actual: undefined,
        type: inferMissingType(expVal),
        severity,
      })
      continue
    }

    const actVal = actual[key]

    // Check for version staleness
    if (
      isObject(expVal) &&
      isObject(actVal) &&
      typeof expVal.version === 'number' &&
      typeof actVal.version === 'number' &&
      expVal.version !== actVal.version
    ) {
      results.push({
        key,
        path,
        expected: expVal.version,
        actual: actVal.version,
        type: 'stale',
        severity: 'error',
      })
      continue
    }

    // Recursive for nested objects
    if (isObject(expVal) && isObject(actVal)) {
      results.push(...computeDrift(expVal, actVal, path))
      continue
    }

    // Primitive comparison
    if (isPlainValue(expVal) && isPlainValue(actVal)) {
      if (expVal !== actVal) {
        const category = key.endsWith('_computed') || key.endsWith('_derived')
          ? 'derived_error'
          : 'mismatch'
        const severity = category === 'derived_error' ? 'error' : 'warning'
        results.push({ key, path, expected: expVal, actual: actVal, type: category, severity })
      }
      continue
    }

    // Type mismatch (one is object, other is primitive)
    results.push({
      key,
      path,
      expected: expVal,
      actual: actVal,
      type: 'mismatch',
      severity: 'error',
    })
  }

  // Check for extra keys
  for (const key of actualKeys) {
    if (!expectedKeys.has(key)) {
      const path = parentPath ? `${parentPath}.${key}` : key
      results.push({
        key,
        path,
        expected: undefined,
        actual: actual[key],
        type: 'extra',
        severity: 'info',
      })
    }
  }

  return results
}

/**
 * Infer the drift type for a missing value based on what was expected.
 * null/undefined expected → 'extra' (wasn't expected to exist)
 * everything else → 'missing'
 */
function inferMissingType(expected: unknown): DriftCategory {
  if (expected === null || expected === undefined) return 'extra'
  return 'missing'
}

/**
 * Compute a numeric drift score from an array of DriftResults.
 * Used by the reconciler to decide whether to continue, compensate, or halt.
 *
 * Scoring:
 * - Each 'error' severity result  → 1.0 point
 * - Each 'warning' severity       → 0.3 points
 * - Each 'info' severity          → 0.1 points
 * - 'missing' keys                → +0.5 bonus (expected data is absent)
 * - 'stale' entries               → +1.0 bonus (version drift is serious)
 */
export function computeDriftScore(results: DriftResult[]): number {
  let score = 0

  for (const r of results) {
    switch (r.severity) {
      case 'error':
        score += 1.0
        break
      case 'warning':
        score += 0.3
        break
      case 'info':
        score += 0.1
        break
      default:
        score += 0.5
    }

    // Bonus modifiers
    if (r.type === 'missing') score += 0.5
    if (r.type === 'stale') score += 1.0
  }

  return score
}
