/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'tests/unit-*.test.ts',
      'tests/**/unit-*.test.ts',
    ],
    exclude: ['node_modules', 'dist'],
    watchExclude: ['node_modules/**', 'dist/**'],
  },
  // Resolve @edgegde/schema imports
  resolve: {
    alias: {
      '@edgegde/schema': '../../packages/op-schema/src',
    },
  },
})
