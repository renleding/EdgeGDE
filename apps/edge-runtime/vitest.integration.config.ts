/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'

// Local integration tests — run against a locally-started wrangler dev server.
// These are plain HTTP tests (fetch against EDGE_RUNTIME_BASE_URL) and do NOT
// run inside the Workers runtime, so no @cloudflare/vitest-pool-workers pool is
// used. Vitest 4 removed `test.pool`/`test.poolOptions`; a standard node-env
// config is the correct (and simpler) shape for this suite.
//
// Run with: bash scripts/test-local.sh
//   (script exports EDGE_RUNTIME_BASE_URL=http://127.0.0.1:8787 and starts
//    wrangler dev --local if it is not already healthy)
export default defineConfig({
  test: {
    name: 'integration',
    include: [
      'tests/domain-workspace.test.ts',
      'tests/e2e-widget.test.ts',
      'tests/admin-integration.test.ts',
      'tests/compliance-e2e.test.ts',
      'tests/audit-events.test.ts',
      'tests/calculator-engine.test.ts',
    ],
    exclude: ['node_modules', 'dist'],
    testTimeout: 60000,
    hookTimeout: 30000,
  },
})
