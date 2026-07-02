/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'

// Widget unit tests — requires happy-dom for DOM environment.
// Run with: bun run test:widget
export default defineConfig({
  test: {
    name: 'widget',
    include: ['tests/widget/**/*.test.ts'],
    environment: 'happy-dom',
    setupFiles: ['tests/widget/setup.ts'],
  },
})
