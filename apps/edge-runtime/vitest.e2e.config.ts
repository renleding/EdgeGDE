/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'

// E2E / integration tests that require a deployed worker to be running.
// These are NOT gated in CI — run manually with:
//   bun run test:e2e
//
// Required env vars:
//   WORKER_URL    (default: https://edgegde-calculator.renleding.workers.dev)
//   TOKEN         (default: from .env)
//   TENANT        (default: au_test_mortgage_broker_v2)
export default defineConfig({
  test: {
    name: 'e2e',
    include: [
      'tests/domain-workspace.test.ts',
      'tests/e2e-widget.test.ts',
      'tests/admin-integration.test.ts',
      'tests/compliance-e2e.test.ts',
      'tests/audit-events.test.ts',
      'tests/calculator-engine.test.ts',
    ],
    exclude: ['node_modules', 'dist'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
