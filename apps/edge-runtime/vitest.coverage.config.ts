import { defineConfig } from 'vitest/config'
import baseConfig from './vitest.config'

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    name: 'coverage',
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/types/**',
        'src/**/index.ts',
      ],
      thresholds: {
        // Ratchet gate (EG-TEST-0009) — measured 2026-08-09 after batch 2:
        // statements 24.8, branches 19.4, functions 29.0, lines 25.6.
        // Set ~2pts below measured to avoid flaky red; each coverage batch PR
        // RAISES these (monotonic ratchet). Below threshold = CI red = blocked.
        statements: 22,
        branches: 17,
        functions: 27,
        lines: 23,
      },
    },
  },
  resolve: baseConfig.resolve,
})
