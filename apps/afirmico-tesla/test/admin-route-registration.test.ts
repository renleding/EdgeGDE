/**
 * Guard: top-level admin route registrations must not be nested inside handlers.
 *
 * WHY THIS EXISTS
 * ---------------
 * The FEATURE-12 configurator route was registered after the `return` statement
 * inside the `/api/telemetry/latest` handler. It was dead code that never
 * executed, so the route never registered: Hono fell through to `app.notFound`
 * and served the splash page with HTTP 404 — even for authenticated requests.
 * TypeScript did not flag it because the code is syntactically valid (it is an
 * expression statement after a `return`, which is only a lint concern).
 *
 * The cost of finding this was half a day of misdiagnosis (cache theories,
 * service workers, cookie paths), because every unauthenticated probe returned
 * the *login* page — which looks like the route exists. Only an authenticated
 * curl with a valid session cookie exposed the 404.
 *
 * WHAT THIS GUARDS
 * ----------------
 * Every `adminApp.get('/...` / `adminApp.post('/...` registration must start at
 * column 0 (top level of the module). A registration indented inside a handler
 * body never runs at module load time, so the route silently never exists.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

const ADMIN_TS = join(import.meta.dirname, '..', 'src', 'admin.ts')

describe('admin route registration', () => {
  const lines = readFileSync(ADMIN_TS, 'utf8').split('\n')

  it('registers every admin route at top level (column 0)', () => {
    const nested: string[] = []
    lines.forEach((line, i) => {
      const m = line.match(/^( +)adminApp\.(get|post|use|route|all)\(/)
      if (m) nested.push(`line ${i + 1}: ${line.trim().slice(0, 80)}`)
    })
    // If this fails, a route registration is nested inside a handler body and
    // will NEVER be registered — it is dead code. Move it to column 0.
    expect(nested).toEqual([])
  })

  it('the configurator route is registered', () => {
    const found = lines.some((l) =>
      /^adminApp\.get\('\/telemetry\/configurator'/.test(l),
    )
    expect(found).toBe(true)
  })
})