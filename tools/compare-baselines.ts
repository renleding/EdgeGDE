#!/usr/bin/env node
/**
 * EdgeGDE Baseline Comparison Tool
 * ===================================
 * Compares current codebase state against pinned baselines and reports
 * regressions. Used by weekly baseline cron and can run ad-hoc:
 *   npx tsx tools/compare-baselines.ts
 *
 * Baseline files:
 *   .hermes/baselines/typecheck.json   — { errors, timestamp }
 *   .hermes/baselines/test.json         — { passed, failed, skipped, timestamp }
 *   .hermes/baselines/code-quality.json — { fail_count, warn_count, files_checked, timestamp }
 */

import { execSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { resolve } from 'path'

const ROOT = resolve(import.meta.dirname, '..')
const BASELINE_DIR = resolve(ROOT, '.hermes/baselines')
const LOG_DIR = resolve(ROOT, '.hermes/logs/weekly-baseline')
const EDGE_RUNTIME = resolve(ROOT, 'apps/edge-runtime')

interface Baseline {
  date?: string
  errors?: number
  passed?: number
  failed?: number
  skipped?: number
  fail_count?: number
  warn_count?: number
  files_checked?: number
  timestamp?: string
  pinned?: boolean
}

interface Regression {
  category: string
  severity: 'HIGH' | 'MEDIUM' | 'LOW'
  field: string
  before: number | string
  after: number | string
  detail: string
}

interface ComparisonReport {
  timestamp: string
  verdict: 'GREEN' | 'YELLOW' | 'RED'
  regressions: Regression[]
  deltas: Record<string, { before: number; after: number; delta: number }>
}

function readBaseline(path: string): Baseline | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

function captureCurrentState(): {
  typecheck: { errors: number; raw: string }
  test: { passed: number; failed: number; skipped: number; raw: string }
} {
  // Typecheck
  let typecheckErrors = -1
  let typecheckRaw = ''
  try {
    typecheckRaw = execSync('npx tsc --noEmit 2>&1', {
      cwd: EDGE_RUNTIME, encoding: 'utf-8', timeout: 300,
    })
    typecheckErrors = 0
  } catch (e: any) {
    typecheckRaw = e.stdout || e.message || ''
    // Count error TS lines
    const matches = typecheckRaw.match(/error TS\d+/g)
    typecheckErrors = matches ? matches.length : 0
  }

  // Tests
  let testPassed = 0, testFailed = 0, testSkipped = 0
  let testRaw = ''
  try {
    testRaw = execSync('bun run test:unit 2>&1', {
      cwd: EDGE_RUNTIME, encoding: 'utf-8', timeout: 300,
    })
    const passMatch = testRaw.match(/(\d+)\s+passed/)
    const failMatch = testRaw.match(/(\d+)\s+failed/)
    const skipMatch = testRaw.match(/(\d+)\s+skipped/)
    testPassed = passMatch ? parseInt(passMatch[1]) : 0
    testFailed = failMatch ? parseInt(failMatch[1]) : 0
    testSkipped = skipMatch ? parseInt(skipMatch[1]) : 0
  } catch (e: any) {
    testRaw = e.stdout || e.message || ''
    const passMatch = testRaw.match(/(\d+)\s+passed/)
    const failMatch = testRaw.match(/(\d+)\s+failed/)
    testPassed = passMatch ? parseInt(passMatch[1]) : 0
    testFailed = failMatch ? parseInt(failMatch[1]) : 0
  }

  return {
    typecheck: { errors: typecheckErrors, raw: typecheckRaw },
    test: { passed: testPassed, failed: testFailed, skipped: testSkipped, raw: testRaw },
  }
}

function runComparison(): ComparisonReport {
  mkdirSync(LOG_DIR, { recursive: true })

  const typecheckBaseline = readBaseline(resolve(BASELINE_DIR, 'typecheck.json'))
  const testBaseline = readBaseline(resolve(BASELINE_DIR, 'test.json'))
  const qualityBaseline = readBaseline(resolve(BASELINE_DIR, 'code-quality.json'))

  const current = captureCurrentState()
  const regressions: Regression[] = []
  const deltas: Record<string, { before: number; after: number; delta: number }> = {}

  // Compare typecheck
  if (typecheckBaseline && typecheckBaseline.errors !== undefined) {
    const before = typecheckBaseline.errors
    const after = current.typecheck.errors
    deltas['typecheck_errors'] = { before, after, delta: after - before }
    if (after > before) {
      regressions.push({
        category: 'Typecheck',
        severity: after - before > 5 ? 'HIGH' : 'MEDIUM',
        field: 'errors',
        before,
        after,
        detail: `Typecheck errors increased from ${before} to ${after}`,
      })
    }
  }

  // Compare tests
  if (testBaseline && testBaseline.passed !== undefined) {
    const before = testBaseline.passed
    const after = current.test.passed
    deltas['tests_passed'] = { before, after, delta: after - before }
    if (after < before) {
      const drop = before - after
      regressions.push({
        category: 'Tests',
        severity: drop > 5 ? 'HIGH' : 'MEDIUM',
        field: 'passed',
        before,
        after,
        detail: `Tests passing dropped from ${before} to ${after} (${before - after} fewer)`,
      })
    }
  }

  if (testBaseline && testBaseline.failed !== undefined) {
    const before = testBaseline.failed
    const after = current.test.failed
    deltas['tests_failed'] = { before, after, delta: after - before }
    if (after > before) {
      regressions.push({
        category: 'Tests',
        severity: after > 0 ? 'HIGH' : 'LOW',
        field: 'failed',
        before,
        after,
        detail: `Tests failed increased from ${before} to ${after}`,
      })
    }
  }

  // Determine verdict
  const highRegressions = regressions.filter(r => r.severity === 'HIGH').length
  const mediumRegressions = regressions.filter(r => r.severity === 'MEDIUM').length
  const lowRegressions = regressions.filter(r => r.severity === 'LOW').length

  let verdict: 'GREEN' | 'YELLOW' | 'RED'
  if (highRegressions > 0) {
    verdict = 'RED'
  } else if (mediumRegressions > 0 || lowRegressions > 0) {
    verdict = 'YELLOW'
  } else {
    verdict = 'GREEN'
  }

  return {
    timestamp: new Date().toISOString(),
    verdict,
    regressions,
    deltas,
  }
}

// Main
const report = runComparison()

// Save report
const dateStr = new Date().toISOString().split('T')[0]
const reportPath = resolve(LOG_DIR, `${dateStr}.json`)
writeFileSync(reportPath, JSON.stringify(report, null, 2))

// Output
console.log(JSON.stringify(report, null, 2))
console.error(`\nVerdict: ${report.verdict}`)
for (const r of report.regressions) {
  console.error(`  [${r.severity}] ${r.category} — ${r.detail}`)
}

if (report.regressions.length === 0) {
  console.error('  No regressions found.')
}

// Exit with status code
if (report.verdict === 'RED') process.exit(2)
if (report.verdict === 'YELLOW') process.exit(1)
process.exit(0)
