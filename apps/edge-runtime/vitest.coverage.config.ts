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
        statements: 5,
        branches: 5,
        functions: 5,
        lines: 5,
      },
    },
  },
  resolve: baseConfig.resolve,
})
