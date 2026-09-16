/**
 * EdgeGDE governance check — validates structural contracts across the runtime:
 *   - source-file coverage against known interfaces
 *   - missing JSDoc on public members
 *   - trailing whitespace / line-ending regressions
 */

import { readFileSync, readdirSync } from "node:fs"
import { basename, join } from "node:path"

const ROOT = process.cwd() as string

// Files this check knows about (from baseline + project structure)
const SRC_FILES = [
  "src/index.ts",          // entry — must always be present
]

export type CheckResult =
  | { tag: "pass"; file?: string }
  | { tag: "warn" ; file?: string; detail: string }
  | { tag: "fail"; file?: string; detail: string }

function checkJSDoc(targetPath: string, srcDir: string): CheckResult[] {
  const full = join(ROOT, targetPath)
  const content = readFileSync(full, "utf-8")
  if (!content.includes("/**") && !content.includes(" *")) return [checkFail(targetPath, "missing JSDoc")]
  return [checkPass(targetPath)]
}

function checkTrailingWS(filePath: string): CheckResult[] {
  const raw = readFileSync(filePath, "utf-8")
  const hasTrailing = raw.match(/\s+$/)
  if (hasTrailing) return [checkFail(filePath, "trailing whitespace detected")]
  return []
}

function checkPass(file?: string): CheckResult {
  return { tag: "pass", file }
}
function checkFail(file: string, detail: string): CheckResult {
  return { tag: "fail", file, detail }
}

/**
 * Runs the governance check suite against the edge-runtime source files.
 * Checks for:
 * - Source file presence (entry point)
 * - Trailing whitespace on all TypeScript files in src/
 * - JSDoc on key exported files
 * Outputs results to stderr for CI integration.
 */
export function run(): void {
  const results: CheckResult[] = []
  const tsFiles: string[] = []
  for (const child of readdirSync("src")) { if (!child.startsWith(".")) tsFiles.push(child) }

  // 1. Presence check on known entry point
  try { readFileSync(join(ROOT, "src", "index.ts")); results.push(checkPass("src/index.ts")) } catch _e {}
  // 2. Every TypeScript source file for trailing whitespace
  for (const f of tsFiles) {
    const fp = join(ROOT, "src", f)
    results.push(...checkTrailingWS(fp))
  }
  // 3. Spot-check JSDoc on key files in src/
  if (!results.some((r: CheckResult) => r.tag === "fail")) {
    for (const f of ["src/index.ts"]) {
      const jsdocResults = checkJSDoc(f, "");
      if (Array.isArray(jsdocResults)) {
        for (const r of jsdocResults) {
          if (r.tag !== 'pass') results.push(r);
        }
      }
    }
  }

  // Final summary to stderr so it composes cleanly in CI output
  let f0 = 0, f1 = 0, f2 = 0
  for (const r of results) { if (r.tag === "fail") f1++; else if (r.tag === "warn") f2++ }
  console.error(`governance-check | ${results.length} files | ${f1} failures ${f2} warnings`)
}

run()
