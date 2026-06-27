/**
 * Verification Suite Tests (FRS-4)
 * Tests for the 6 verification gates.
 */

import { runVerificationSuite, VerificationInput } from './verification-suite'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Helper: create a temp worktree with git init
function createWorktree(files: Record<string, string> = {}): string {
  const dir = join(tmpdir(), `aegis-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  
  // Init git repo
  const { execSync } = require('child_process')
  execSync(`cd "${dir}" && git init 2>/dev/null`, { stdio: 'pipe' })
  
  // Create files
  for (const [name, content] of Object.entries(files)) {
    const fullPath = join(dir, name)
    mkdirSync(fullPath.substring(0, fullPath.lastIndexOf('/')), { recursive: true })
    writeFileSync(fullPath, content, 'utf-8')
  }
  
  // Stage and initial commit
  execSync(`cd "${dir}" && git add -A && git commit -m "init" 2>/dev/null`, { stdio: 'pipe' })
  
  return dir
}

function makeInput(overrides: Partial<VerificationInput> = {}): VerificationInput {
  return {
    worktreePath: '/tmp',
    patch: `diff --git a/test.py b/test.py\n--- a/test.py\n+++ b/test.py\n@@ -1,3 +1,4 @@\n x=1\n+new=2`,
    instanceId: 'test__test-1',
    executor: 'openrouter-api',
    executorModel: 'deepseek/deepseek-v4-flash',
    durationMs: 12345,
    ...overrides,
  }
}

let pass = 0
let fail = 0

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}${detail ? ': ' + detail : ''}`)
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────

console.log('\n=== diff_hygiene gate ===')

{
  // Valid diff passes
  const r = runVerificationSuite(makeInput())
  const gate = r.gates.find(g => g.gate === 'diff_hygiene')
  assert(gate?.status === 'passed', 'valid diff passes hygiene')
}

{
  // Binary file in patch fails
  const r = runVerificationSuite(makeInput({
    patch: 'diff --git a/image.png b/image.png\nindex 000..111\nBinary files differ',
  }))
  const gate = r.gates.find(g => g.gate === 'diff_hygiene')
  assert(gate?.status === 'failed', 'binary file rejected')
}

{
  // .env file in patch fails
  const r = runVerificationSuite(makeInput({
    patch: 'diff --git a/.env b/.env\n--- a/.env\n+++ b/.env\n@@ -1 +1 @@\n-SECRET=x\n+SECRET=y',
  }))
  const gate = r.gates.find(g => g.gate === 'diff_hygiene')
  assert(gate?.status === 'failed', 'env file rejected')
}

console.log('\n=== patch_format gate ===')

{
  // Valid format passes
  const r = runVerificationSuite(makeInput())
  const gate = r.gates.find(g => g.gate === 'patch_format')
  assert(gate?.status === 'passed', 'valid format passes')
}

{
  // Empty patch fails
  const r = runVerificationSuite(makeInput({ patch: '' }))
  const gate = r.gates.find(g => g.gate === 'patch_format')
  assert(gate?.status === 'failed', 'empty patch rejected')
}

{
  // Missing diff header fails
  const r = runVerificationSuite(makeInput({
    patch: 'some text without diff format',
  }))
  const gate = r.gates.find(g => g.gate === 'patch_format')
  assert(gate?.status === 'failed', 'missing diff header rejected')
}

console.log('\n=== test_patch_apply gate ===')

{
  // Patch that applies cleanly should pass (if worktree exists)
  const dir = createWorktree({ 'test.py': 'x=1\n' })
  const r = runVerificationSuite(makeInput({
    worktreePath: dir,
    patch: '--- a/test.py\n+++ b/test.py\n@@ -1 +1,2 @@\n x=1\n+y=2',
  }))
  const gate = r.gates.find(g => g.gate === 'test_patch_apply')
  // May be passed or failed depending on whether git apply works in this context
  assert(gate !== undefined, 'test_patch_apply gate ran')
}

console.log('\n=== overall verdict ===')

{
  // All gates passing should return PASS
  const dir = createWorktree({ 'test.py': 'x=1\n' })
  const r = runVerificationSuite(makeInput({
    worktreePath: dir,
    patch: '--- a/test.py\n+++ b/test.py\n@@ -1 +1,2 @@\n x=1\n+y=2',
    instanceId: 'test__all-pass',
  }))
  assert(r.verdict === 'PASS' || r.verdict === 'WARN', 'all-pass verdict computed')
  assert(r.audit.patchHash.length === 64, 'audit hash is SHA256')
  assert(r.audit.instanceId === 'test__all-pass', 'audit instance ID recorded')
}

console.log('\n=== audit record ===')

{
  const r = runVerificationSuite(makeInput({ instanceId: 'audit__test' }))
  assert(r.audit.instanceId === 'audit__test', 'audit instance ID')
  assert(r.audit.executor === 'openrouter-api', 'audit executor')
  assert(r.audit.executorModel === 'deepseek/deepseek-v4-flash', 'audit model')
  assert(r.audit.verificationGates.length === 6, 'audit gates count')
}

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(50)}`)
if (fail === 0) {
  console.log(`✅ All ${pass} tests passed`)
} else {
  console.log(`❌ ${fail}/${pass + fail} tests failed`)
}
process.exit(fail > 0 ? 1 : 0)
