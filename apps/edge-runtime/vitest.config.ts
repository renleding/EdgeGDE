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
      'tests/domain-workspace.test.ts',
      'tests/calculator-engine.test.ts',
    ],
    exclude: ['node_modules', 'dist'],
  },
  // Resolve @edgegde/schema imports
  resolve: {
    alias: {
      '@edgegde/schema': '/Users/warren/Documents/_HQ_AI/EdgeGDE/.worktrees/hermes-ef56f142/packages/op-schema/src/openpencil.ts',
    },
  },
})
