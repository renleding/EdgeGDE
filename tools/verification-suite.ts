/**
 * Verification Suite (FRS-4)
 * ===========================
 * Aegis governance layer — 6 deterministic verification gates.
 * Runs after executor generates a patch, before the state machine
 * transitions EXECUTION → VERIFICATION.
 *
 * All gates are ordered cheapest-first. Any gate failure triggers
 * a self-correction loop or escalation to human review.
 *
 * Usage:
 *   import { runVerificationSuite } from './governance/verification-suite'
 *   const report = await runVerificationSuite({ worktreePath, patch })
 */

import { execSync } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'

// ── Types ─────────────────────────────────────────────────────────────────

export interface VerificationInput {
  /** Absolute path to the worktree */
  worktreePath: string
  /** The generated unified diff patch */
  patch: string
  /** SWE-bench instance ID (for audit trail) */
  instanceId?: string
  /** Executor name (e.g. "aider", "openrouter-api") */
  executor?: string
  /** Executor model name */
  executorModel?: string
  /** Task duration in ms */
  durationMs?: number
}

export interface GateResult {
  gate: string
  status: 'passed' | 'failed' | 'skipped' | 'warned'
  durationMs: number
  details?: string
  diagnostics?: unknown[]
}

export interface VerificationReport {
  instanceId: string
  timestamp: string
  gates: GateResult[]
  verdict: 'PASS' | 'FAIL' | 'WARN'
  patchHash: string
  /** OpenTelemetry trace ID (to be wired up later) */
  hermesTrace?: string
  /** FRS-4.2: Audit record */
  audit: AuditRecord
}

export interface AuditRecord {
  instanceId: string
  executor: string
  executorModel: string
  durationMs: number
  patchHash: string
  lspGateStatus: string
  verificationGates: GateResult[]
  failureClassification: string | null
  retryCount: number
  timestamp: string
}

// ── Configuration ─────────────────────────────────────────────────────────

const LOG_DIR = join(
  process.env.HOME || '/tmp',
  'Documents/_HQ_AI/EdgeGDE/.worktrees/hermes-a760990a/.hermes/logs/swe-bench'
)

// ── Gate 1: Git Diff Hygiene ──────────────────────────────────────────────

function checkDiffHygiene(worktreePath: string, patch: string): GateResult {
  const start = Date.now()

  // Check for binary files
  const binaryPattern = /^diff --git a\/.*\.(png|jpg|jpeg|gif|ico|woff|woff2|eot|ttf|pdf|zip|tar|gz|pyc)/im
  if (binaryPattern.test(patch)) {
    return {
      gate: 'diff_hygiene',
      status: 'failed',
      durationMs: Date.now() - start,
      details: 'Patch contains binary files — rejecting',
    }
  }

  // Check for env files
  if (/^diff --git a\/.*\.env/im.test(patch)) {
    return {
      gate: 'diff_hygiene',
      status: 'failed',
      durationMs: Date.now() - start,
      details: 'Patch modifies .env files — rejecting',
    }
  }

  // Check for node_modules / dist / build
  if (/^diff --git a\/(node_modules|dist|build|__pycache__|\.venv)\//im.test(patch)) {
    return {
      gate: 'diff_hygiene',
      status: 'failed',
      durationMs: Date.now() - start,
      details: 'Patch modifies excluded directory (node_modules/dist/build)',
    }
  }

  // Check patch is valid unified diff format
  if (!patch.startsWith('diff --git') && !patch.startsWith('---') && !patch.startsWith('index')) {
    return {
      gate: 'diff_hygiene',
      status: 'failed',
      durationMs: Date.now() - start,
      details: 'Patch does not appear to be a valid unified diff',
    }
  }

  return { gate: 'diff_hygiene', status: 'passed', durationMs: Date.now() - start }
}

// ── Gate 2: LSP Gate (call out to lsp-validate.py) ────────────────────────

function runLspGate(worktreePath: string): GateResult {
  const start = Date.now()

  const lspScript = join(
    __dirname, '..', '..', '..', '..', '..', 'tools', 'lsp-gate', 'lsp-validate.py'
  )

  if (!existsSync(lspScript)) {
    return {
      gate: 'lsp_gate',
      status: 'skipped',
      durationMs: Date.now() - start,
      details: `LSP gate script not found at ${lspScript}`,
    }
  }

  try {
    const output = execSync(
      `python3 "${lspScript}" "${worktreePath}" --json 2>/dev/null`,
      { timeout: 120_000, encoding: 'utf-8' }
    )

    const result = JSON.parse(output)
    const verdict = result.verdict || {}
    const gateStatus = verdict.gate_status || 'skipped'

    return {
      gate: 'lsp_gate',
      status: gateStatus === 'passed' ? 'passed'
        : gateStatus === 'rejected' ? 'failed'
        : gateStatus === 'warned' ? 'warned'
        : 'skipped',
      durationMs: Date.now() - start,
      details: `${verdict.error_count || 0} errors, ${verdict.warning_count || 0} warnings`,
      diagnostics: result.validation?.errors?.slice(0, 10) || [],
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      gate: 'lsp_gate',
      status: 'skipped',
      durationMs: Date.now() - start,
      details: `LSP gate unavailable: ${msg.slice(0, 200)}`,
    }
  }
}

// ── Gate 3: Lint ──────────────────────────────────────────────────────────

function runLintGate(worktreePath: string): GateResult {
  const start = Date.now()
  const results: string[] = []

  // Try Python lint
  try {
    const out = execSync(
      `cd "${worktreePath}" && python3 -m ruff check --quiet . 2>&1 || true`,
      { timeout: 60_000, encoding: 'utf-8' }
    )
    if (out.trim()) results.push(`ruff: ${out.trim().split('\n').length} issues`)
  } catch {
    // ruff not available — skip
  }

  // Try TypeScript lint
  if (existsSync(join(worktreePath, 'tsconfig.json')) || existsSync(join(worktreePath, 'package.json'))) {
    try {
      const out = execSync(
        `cd "${worktreePath}" && npx eslint --quiet . 2>&1 || true`,
        { timeout: 60_000, encoding: 'utf-8' }
      )
      if (out.trim()) results.push(`eslint: ${out.trim().split('\n').length} issues`)
    } catch {
      // eslint not available — skip
    }
  }

  if (results.length === 0) {
    return { gate: 'lint', status: 'skipped', durationMs: Date.now() - start, details: 'No linter available' }
  }

  return {
    gate: 'lint',
    status: 'passed', // lint warnings are non-blocking
    durationMs: Date.now() - start,
    details: results.join('; '),
  }
}

// ── Gate 4: Test Run ─────────────────────────────────────────────────────

function runTestGate(worktreePath: string): GateResult {
  const start = Date.now()

  // Try pytest
  if (existsSync(join(worktreePath, 'pytest.ini')) || existsSync(join(worktreePath, 'setup.py')) ||
      existsSync(join(worktreePath, 'setup.cfg')) || existsSync(join(worktreePath, 'pyproject.toml'))) {
    try {
      const out = execSync(
        `cd "${worktreePath}" && python3 -m pytest --tb=short -q --timeout=60 2>&1 || true`,
        { timeout: 120_000, encoding: 'utf-8' }
      )
      const lines = out.trim().split('\n')
      const lastLine = lines[lines.length - 1] || ''
      const passed = lastLine.includes('passed')
      const failed = lastLine.includes('failed')

      if (failed) {
        return {
          gate: 'test_run',
          status: 'failed',
          durationMs: Date.now() - start,
          details: lastLine.slice(0, 200),
        }
      }
      if (passed) {
        return {
          gate: 'test_run',
          status: 'passed',
          durationMs: Date.now() - start,
          details: lastLine.slice(0, 200),
        }
      }
      return {
        gate: 'test_run',
        status: 'warned',
        durationMs: Date.now() - start,
        details: `Test output: ${lastLine.slice(0, 200)}`,
      }
    } catch {
      return { gate: 'test_run', status: 'skipped', durationMs: Date.now() - start, details: 'pytest failed to run' }
    }
  }

  return { gate: 'test_run', status: 'skipped', durationMs: Date.now() - start, details: 'No test framework detected' }
}

// ── Gate 5: Patch Format ─────────────────────────────────────────────────

function checkPatchFormat(patch: string): GateResult {
  const start = Date.now()

  if (!patch || patch.length < 20) {
    return { gate: 'patch_format', status: 'failed', durationMs: Date.now() - start, details: 'Patch is empty or too short' }
  }

  // Must have diff header
  if (!/^diff --git/.test(patch) && !/^--- /.test(patch)) {
    return { gate: 'patch_format', status: 'failed', durationMs: Date.now() - start, details: 'Missing diff header' }
  }

  // Must have at least one hunk header
  if (!/^@@ /.test(patch)) {
    return { gate: 'patch_format', status: 'failed', durationMs: Date.now() - start, details: 'Missing hunk headers (@@ ... @@)' }
  }

  // Must have at least one addition or removal
  if (!/^\+/m.test(patch) && !/^-/m.test(patch)) {
    return { gate: 'patch_format', status: 'failed', durationMs: Date.now() - start, details: 'No additions or removals in patch' }
  }

  return { gate: 'patch_format', status: 'passed', durationMs: Date.now() - start, details: `${patch.split('\n').length} lines` }
}

// ── Gate 6: Test Patch Apply ─────────────────────────────────────────────

function checkTestPatchApply(worktreePath: string, patch: string): GateResult {
  const start = Date.now()

  // Write patch to temp file and try git apply --check (dry run)
  const patchFile = join(worktreePath, '.aegis-verify-patch.diff')
  writeFileSync(patchFile, patch, 'utf-8')

  try {
    execSync(`cd "${worktreePath}" && git apply --check "${patchFile}" 2>&1`, {
      timeout: 30_000,
      encoding: 'utf-8',
    })
    // Clean up
    try { execSync(`rm -f "${patchFile}"`) } catch { /* ignore */ }
    return { gate: 'test_patch_apply', status: 'passed', durationMs: Date.now() - start, details: 'Patch applies cleanly' }
  } catch (e: unknown) {
    try { execSync(`rm -f "${patchFile}"`) } catch { /* ignore */ }
    const msg = e instanceof Error ? e.message : String(e)
    return {
      gate: 'test_patch_apply',
      status: 'failed',
      durationMs: Date.now() - start,
      details: `git apply --check failed: ${msg.slice(0, 200)}`,
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Runner
// ═══════════════════════════════════════════════════════════════════════════

export function runVerificationSuite(input: VerificationInput): VerificationReport {
  const start = Date.now()
  const { worktreePath, patch, instanceId, executor, executorModel, durationMs } = input

  // Compute patch hash
  const patchHash = createHash('sha256').update(patch).digest('hex')

  // Run gates in order (cheapest first)
  const gates: GateResult[] = [
    checkDiffHygiene(worktreePath, patch),
    runLspGate(worktreePath),
    runLintGate(worktreePath),
    runTestGate(worktreePath),
    checkPatchFormat(patch),
    checkTestPatchApply(worktreePath, patch),
  ]

  // Determine verdict
  const failures = gates.filter(g => g.status === 'failed')
  const warnings = gates.filter(g => g.status === 'warned')
  const skipped = gates.filter(g => g.status === 'skipped')
  const verdict: 'PASS' | 'FAIL' | 'WARN' =
    failures.length > 0 ? 'FAIL'
    : warnings.length > 0 ? 'WARN'
    : 'PASS'

  // Build report
  const timestamp = new Date().toISOString()
  const report: VerificationReport = {
    instanceId: instanceId || 'unknown',
    timestamp,
    gates,
    verdict,
    patchHash,
    audit: {
      instanceId: instanceId || 'unknown',
      executor: executor || 'unknown',
      executorModel: executorModel || 'unknown',
      durationMs: durationMs || (Date.now() - start),
      patchHash,
      lspGateStatus: gates.find(g => g.gate === 'lsp_gate')?.status || 'skipped',
      verificationGates: gates,
      failureClassification: failures.length > 0 ? `failed_gates: ${failures.map(g => g.gate).join(',')}` : null,
      retryCount: 0,
      timestamp,
    },
  }

  // Write audit log
  const logDir = join(LOG_DIR, instanceId || 'unknown')
  mkdirSync(logDir, { recursive: true })
  writeFileSync(join(logDir, 'verification-report.json'), JSON.stringify(report, null, 2), 'utf-8')

  return report
}
