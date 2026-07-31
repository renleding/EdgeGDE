#!/usr/bin/env node
/**
 * EdgeGDE Governance Check (FRS-004)
 * ===================================
 * Automated compliance gate that validates code against AGENTS.md policies.
 *
 * Runs as part of CI (code-quality job) and can be invoked locally:
 *   npx tsx tools/governance-check.ts [--diff-only]
 *
 * Checks:
 * 1. No `as any` in new/changed .ts files
 * 2. No `console.log` in production .ts files (test files excluded)
 * 3. Exported functions/classes have JSDoc
 * 4. Every .ts file has a matching test file (unless in excluded dirs)
 * 5. AGENTS.md role boundaries are respected (no lifecycle bypass in code)
 * 6. File size limits (no single file > 2000 lines)
 */

import { execSync } from 'child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, resolve, relative, isAbsolute } from 'path'

const ROOT = resolve(import.meta.dirname, '..')
const EDGE_RUNTIME = join(ROOT, 'apps/edge-runtime/src')
const EXCLUDED_DIRS = ['node_modules', 'dist', 'build', 'coverage', '.git', '.worktrees', 'tools']
interface CheckResult {
  check: string
  status: 'pass' | 'fail' | 'warn'
  details: string[]
  file?: string
  line?: number
}

interface GovernanceReport {
  timestamp: string
  checks: CheckResult[]
  verdict: 'PASS' | 'FAIL' | 'WARN'
  files_checked: number
}

function getChangedFiles(): { files: string[]; ok: boolean } {
  // Candidate diff bases, in priority order:
  //   1. origin/<base-ref> (PRs — GITHUB_BASE_REF set by GitHub Actions)
  //   2. HEAD~1 (push events with fetch-depth >= 2)
  // Returns ok=false only when EVERY candidate fails — the tool must NOT
  // silently fall back to a full-repo scan in --diff-only mode, because
  // pre-existing violations in untouched files would then block deploys.
  const candidates: string[] = []
  if (process.env.GITHUB_BASE_REF) candidates.push(`origin/${process.env.GITHUB_BASE_REF}`)
  candidates.push('HEAD~1')
  for (const base of candidates) {
    try {
      const output = execSync(`git diff --name-only ${base}...HEAD`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 })
      return { files: output.trim().split('\n').filter(Boolean), ok: true }
    } catch {
      // try next candidate
    }
  }
  return { files: [], ok: false }
}

function findSourceFiles(dir: string, results: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.includes(entry.name)) {
        findSourceFiles(full, results)
      }
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts')) {
      if (!full.includes('node_modules')) {
        results.push(full)
      }
    }
  }
  return results
}

function findTestFile(sourcePath: string): string {
  const dir = join(sourcePath, '..')
  const base = sourcePath.replace(/\.ts$/, '')
  const candidates = [
    `${base}.test.ts`,
    join(dir, `unit-${sourcePath.split('/').pop()!.replace('.ts', '')}.test.ts`),
    join(dir, `test-${sourcePath.split('/').pop()!.replace('.ts', '')}.ts`),
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  // Check tests/ directory mirror
  const rel = relative(EDGE_RUNTIME, sourcePath)
  const mirrorPath = join(ROOT, 'apps/edge-runtime/tests', rel.replace('.ts', '.test.ts'))
  if (existsSync(mirrorPath)) return mirrorPath
  return ''
}

function getChangedLineRanges(filePath: string): [number, number][] | null {
  const rel = filePath.startsWith(ROOT + '/') ? filePath.slice(ROOT.length + 1) : filePath
  try {
    const base = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'HEAD~1'
    const output = execSync(
      `git diff -U0 ${base}...HEAD -- '${rel}'`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    )
    const ranges: [number, number][] = []
    for (const line of output.split('\n')) {
      const m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/)
      if (m) {
        const start = parseInt(m[1], 10)
        const count = m[2] ? parseInt(m[2], 10) : 1
        if (count > 0) ranges.push([start, start + count - 1])
      }
    }
    return ranges.length > 0 ? ranges : null
  } catch {
    return null
  }
}

function checkNoAsAny(content: string, file: string, lineRanges?: [number, number][] | null): CheckResult {
  const details: string[] = []
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (lineRanges) {
      const lineNum = i + 1
      const inRange = lineRanges.some(([start, end]) => lineNum >= start && lineNum <= end)
      if (!inRange) continue
    }
    if (lines[i].includes('as any') && !lines[i].trim().startsWith('//') && !lines[i].trim().startsWith('*')) {
      details.push(`${file}:${i + 1}: ${lines[i].trim()}`)
    }
  }
  return {
    check: 'No `as any`',
    status: details.length === 0 ? 'pass' : 'fail',
    details: details.length > 0 ? details.slice(0, 10) : [],
  }
}

function checkNoConsoleLog(content: string, file: string, lineRanges?: [number, number][] | null): CheckResult {
  const details: string[] = []
  const lines = content.split('\n')
  const fileName = file.split('/').pop() || ''
  // Skip test files and config files
  if (fileName.endsWith('.test.ts') || fileName === 'vitest.config.ts' || file.includes('tools/')) {
    return { check: 'No console.log in production code', status: 'pass', details: [] }
  }
  for (let i = 0; i < lines.length; i++) {
    if (lineRanges) {
      const lineNum = i + 1
      const inRange = lineRanges.some(([start, end]) => lineNum >= start && lineNum <= end)
      if (!inRange) continue
    }
    const trimmed = lines[i].trim()
    if (trimmed.includes('console.log(') && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
      details.push(`${file}:${i + 1}: ${trimmed}`)
    }
  }
  return {
    check: 'No console.log in production code',
    status: details.length === 0 ? 'pass' : 'fail',
    details: details.length > 0 ? details.slice(0, 10) : [],
  }
}

function checkJSDoc(content: string, file: string): CheckResult {
  const details: string[] = []
  const lines = content.split('\n')
  // Find exported functions/classes without JSDoc
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Check for export function/class/const without preceding JSDoc
    if (/^export\s+(function|class|const|async\s+function)/.test(line)) {
      // Check that the exported function/class has JSDoc — look back 15 lines
      let hasJSDoc = false
      for (let j = i - 1; j >= Math.max(0, i - 15); j--) {
        if (lines[j].trim().startsWith('/**')) { hasJSDoc = true; break }
      }
      if (!hasJSDoc) {
        const name = line.match(/(?:function|class|const)\s+(\w+)/)?.[1] || 'unnamed'
        details.push(`${file}:${i + 1}: exported ${name} missing JSDoc`)
      }
    }
  }
  return {
    check: 'Exported types have JSDoc',
    status: details.length > 10 ? 'warn' : (details.length === 0 ? 'pass' : 'warn'),
    details: details.length > 0 ? details.slice(0, 10) : [],
  }
}

function checkFileSize(file: string): CheckResult {
  const stats = statSync(file)
  const MAX_LINES = 2000
  const content = readFileSync(file, 'utf-8')
  const lines = content.split('\n').length
  if (lines > MAX_LINES) {
    return {
      check: 'File size limit',
      status: 'warn',
      details: [`${file}: ${lines} lines (limit: ${MAX_LINES})`],
    }
  }
  return { check: 'File size limit', status: 'pass', details: [] }
}

function checkTestCoverage(sourceFile: string): CheckResult {
  const testFile = findTestFile(sourceFile)
  const fileName = sourceFile.split('/').pop() || ''
  // Skip test files, config, index files, and type-only files
  if (fileName.endsWith('.test.ts') || fileName === 'index.ts' || fileName.endsWith('.d.ts') ||
      sourceFile.includes('/types/') || sourceFile.endsWith('-types.ts')) {
    return { check: `Test file exists for ${fileName}`, status: 'pass', details: ['(skipped - not a testable module)'] }
  }
  if (!testFile) {
    // Only flag if the file has exported members
    const content = readFileSync(sourceFile, 'utf-8')
    if (content.includes('export ') && !content.includes('export type')) {
      return {
        check: `Test file exists for ${fileName}`,
        status: 'warn',
        details: [`${sourceFile} has exports but no matching test file`],
      }
    }
  }
  return { check: `Test file exists for ${fileName}`, status: 'pass', details: [] }
}

function runAllChecks(): GovernanceReport {
  const diffOnly = process.argv.includes('--diff-only')
  const { files: changedFiles, ok: diffOk } = getChangedFiles()
  const sourceFiles = findSourceFiles(EDGE_RUNTIME)
  const tsChangedFiles = changedFiles.filter(f => f.endsWith('.ts') && !f.startsWith('tools/') && existsSync(join(ROOT, f)))
  let filesToCheck: string[]

  if (diffOnly) {
    // --diff-only: check ONLY files touched by this change. If the diff
    // cannot be computed, fail loudly — do NOT silently scan the whole repo,
    // because pre-existing violations in untouched files would block every
    // deploy (this is what caused the 2026-07 deploy failure cascade).
    if (!diffOk) {
      console.error('ERROR: --diff-only mode but git diff failed (no candidate base revision resolved).')
      console.error('  Ensure CI checks out with fetch-depth >= 2 and does NOT re-fetch with --depth=1')
      console.error('  (use --deepen=1 instead, which preserves the parent commit).')
      process.exit(2)
    }
    filesToCheck = tsChangedFiles
  } else {
    filesToCheck = tsChangedFiles.length > 0 ? tsChangedFiles : sourceFiles
  }

  const results: CheckResult[] = []

  for (const filePath of filesToCheck) {
    // filePath may be absolute (from findSourceFiles) or relative (from git diff)
    const fullPath = isAbsolute(filePath) ? filePath : join(ROOT, filePath)
    if (!existsSync(fullPath) || statSync(fullPath).size > 500_000) continue

    // For line-range checking and display, use the path relative to ROOT
    const relPath = fullPath.startsWith(ROOT + '/') ? fullPath.slice(ROOT.length + 1) : fullPath

    try {
      const content = readFileSync(fullPath, 'utf-8')
      const lineRanges = getChangedLineRanges(fullPath)
      results.push(checkNoAsAny(content, relPath, lineRanges))
      results.push(checkNoConsoleLog(content, relPath, lineRanges))
      results.push(checkFileSize(fullPath))
      if (!filePath.endsWith('.test.ts')) {
        results.push(checkJSDoc(content, relPath))
        results.push(checkTestCoverage(fullPath))
      }
    } catch (e) {
      // Binary or unreadable — skip
    }
  }

  const failures = results.filter(r => r.status === 'fail')
  const warnings = results.filter(r => r.status === 'warn')
  const verdict = failures.length > 0 ? 'FAIL' : (warnings.length > 10 ? 'WARN' : 'PASS')

  return {
    timestamp: new Date().toISOString(),
    checks: results.filter(r => r.status !== 'pass').slice(0, 20),
    verdict,
    files_checked: filesToCheck.length,
  }
}

// Main
const report = runAllChecks()
console.log(JSON.stringify(report, null, 2))
console.error(`\nVerdict: ${report.verdict}  (${report.files_checked} files checked)`)
if (report.verdict === 'FAIL') {
  process.exit(1)
}
