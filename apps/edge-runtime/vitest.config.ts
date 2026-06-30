/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'tests/unit-*.test.ts',
      'tests/**/unit-*.test.ts',
      'tests/unit/**/*.test.ts',
      'tests/agentic-ux/agentic-ux.*.test.ts',
      'tests/scoring-engine.test.ts',
      'tests/phase13-hypermedia.test.ts',
      'tests/domain-swarm.test.ts',
      'tests/calculator-engine.test.ts',
      'tests/uat-calculators.test.ts',
    ],
    exclude: ['node_modules', 'dist'],
  },
  // Resolve @edgegde/schema imports — relative to worktree root
  resolve: {
    alias: {
      '@edgegde/schema': '../../packages/op-schema/src/openpencil.ts',
    },
  },
})
