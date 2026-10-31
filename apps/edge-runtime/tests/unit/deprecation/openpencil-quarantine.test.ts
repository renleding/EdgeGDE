// @ts-nocheck — this test reads the source tree with node:fs; the edge-runtime
// tsconfig only loads @cloudflare/workers-types, so node built-ins have no types
// here. Same convention as tests/unit-transition-registry.test.ts.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * OpenPencil quarantine guard.
 *
 * OpenPencil was deprecated on 2026-06-21 and replaced by the Canvas document
 * model. The code cannot be deleted yet: `compileLayoutCompat` and
 * `layoutDefinitionSchema` are still on the live publish path and are required
 * to read legacy LayoutDefinition artifacts from KV.
 *
 * So instead of deleting, this test pins the deprecation contract:
 *
 *   1. New code must not import the legacy compat layer. Only an explicit,
 *      reviewed allow-list may, and adding to it fails this test until the
 *      allow-list is updated deliberately.
 *   2. The migration module stays leaf-most: only the compat layer may use it.
 *   3. `calculators.ts` must not reach the compat layer — that exact import
 *      chain caused a Vitest teardown failure in calculator-engine.test.ts and
 *      was the reason the import was removed in the first place.
 *   4. The new Canvas pipeline must not depend on the legacy one.
 *   5. `@edgegde/schema`'s entry point stays `src/openpencil.ts`, because 13
 *      files import it by package name; renaming the file silently would break
 *      every one of them.
 *
 * When the last legacy KV artifact is gone and the publish API has migrated,
 * delete the allowed files and this test together.
 */

// tests/unit/deprecation -> apps/edge-runtime
const RUNTIME_ROOT = join(__dirname, '..', '..', '..')
const SRC = join(RUNTIME_ROOT, 'src')
const OP_SCHEMA_PKG = join(RUNTIME_ROOT, '..', '..', 'packages', 'op-schema', 'package.json')

/**
 * Files permitted to import the legacy compat layer.
 * Each entry is a conscious decision to keep one legacy call site alive.
 */
const COMPAT_IMPORTERS_ALLOWED = [
  'src/lib/compile-layout-compat.ts', // the module itself
  'src/index.ts', // legacy compile entry (~line 1478)
  'src/lib/publish-tenant.ts', // tenant publish of stored artifacts
  'src/registry/pages.ts', // stored page rendering
  'src/routes/agent.ts', // agent publish endpoint
]

/**
 * Files permitted to import the migration module directly.
 *
 * All of these are legacy-artifact bridges: an old LayoutDefinition stored in KV
 * is converted to a CanvasDocument at render/publish time. They use dynamic
 * `await import(...)` so the migrator is not pulled into every Worker bundle.
 * None may be reached by new authoring flows — new work produces a
 * CanvasDocument directly and never constructs a LayoutDefinition.
 */
const MIGRATION_IMPORTERS_ALLOWED = [
  'src/lib/compile-layout-compat.ts', // compat shim over the migrator
  'src/api/builder.ts', // publish: legacy payload.layout → Canvas → HTML
  'src/index.ts', // render: stored legacy layout → Canvas (2 call sites)
]

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'coverage') continue
      walk(full, out)
    } else if (entry.endsWith('.ts')) {
      out.push(full)
    }
  }
  return out
}

/** Import specifiers in a source file (static imports and re-exports only). */
function importsIn(file: string): string[] {
  const src = readFileSync(file, 'utf8')
  const specs: string[] = []
  const re = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) specs.push(m[1])
  return specs
}

interface Importer {
  rel: string
  spec: string
}

function importersOf(moduleName: string): Importer[] {
  const found: Importer[] = []
  for (const file of walk(SRC)) {
    const rel = relative(RUNTIME_ROOT, file)
    if (rel.endsWith(`${moduleName}.ts`) && rel.includes(moduleName)) continue // self
    for (const spec of importsIn(file)) {
      if (spec.replace(/\.ts$/, '').endsWith(moduleName)) {
        found.push({ rel, spec })
        break
      }
    }
  }
  return found
}

describe('OpenPencil deprecation quarantine', () => {
  describe('legacy compat layer (compile-layout-compat)', () => {
    it('is imported only by the reviewed allow-list', () => {
      const importers = importersOf('compile-layout-compat').filter(
        (i) => !i.rel.endsWith('lib/compile-layout-compat.ts'),
      )
      const unexpected = importers.filter(
        (i) => !COMPAT_IMPORTERS_ALLOWED.some((a) => a.split(':')[0] === i.rel),
      )

      expect(
        unexpected.map((i) => i.rel),
        'A new module imports the deprecated OpenPencil compat layer. ' +
          'Use compileFromCanvas instead. If this is deliberate legacy support, ' +
          'add the file to COMPAT_IMPORTERS_ALLOWED in this test.',
      ).toEqual([])
    })

    it('is not reachable from the calculator registry', () => {
      // This exact chain (calculators.ts → compile-layout-compat → migration)
      // broke calculator-engine.test.ts with an EnvironmentTeardownError.
      const file = join(SRC, 'registry', 'calculators.ts')
      const specs = importsIn(file)
      const offenders = specs.filter((s) => s.includes('compile-layout-compat'))

      expect(offenders, 'calculators.ts must not import the legacy compat layer').toEqual([])
    })
  })

  describe('migration module (openpencil-migration)', () => {
    it('stays leaf-most: only the compat layer imports it', () => {
      const importers = importersOf('openpencil-migration').filter(
        (i) => !i.rel.endsWith('canvas/openpencil-migration.ts'),
      )
      const unexpected = importers.filter(
        (i) => !MIGRATION_IMPORTERS_ALLOWED.some((a) => a.split(':')[0] === i.rel),
      )

      expect(
        unexpected.map((i) => i.rel),
        'openpencil-migration.ts is a leaf used by compile-layout-compat.ts only. ' +
          'New work must convert to CanvasDocument instead of calling the migrator.',
      ).toEqual([])
    })
  })

  describe('the Canvas pipeline does not depend on the legacy pipeline', () => {
    it('compile-from-canvas imports nothing legacy', () => {
      const file = join(SRC, 'canvas', 'compile-from-canvas.ts')
      const specs = importsIn(file)
      const offenders = specs.filter(
        (s) => s.includes('compile-layout-compat') || s.includes('openpencil-migration'),
      )

      expect(offenders, 'The Canvas compiler must not fall back to OpenPencil code').toEqual([])
    })
  })

  describe('schema package entry point', () => {
    it('@edgegde/schema still resolves to src/openpencil.ts', () => {
      // 13 files import '@edgegde/schema'. The file name is legacy, but it is
      // the canonical schema module: renaming it is an API change, not cleanup.
      const pkg = JSON.parse(readFileSync(OP_SCHEMA_PKG, 'utf8'))

      expect(pkg.name).toBe('@edgegde/schema')
      expect(
        pkg.main,
        'packages/op-schema/package.json main changed. If the schema module was ' +
          'renamed, every @edgegde/schema importer must be migrated in the same PR.',
      ).toBe('src/openpencil.ts')
    })
  })
})
