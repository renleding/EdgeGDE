import { defineProject } from 'vitest/config'

export default defineProject({
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
    pool: '@cloudflare/vitest-pool-workers',
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.local.toml' },
        miniflare: {
          bindings: {
            CANVAS_CHAT_LLM_PROVIDER: 'ollama',
          },
        },
      },
    },
  },
})
