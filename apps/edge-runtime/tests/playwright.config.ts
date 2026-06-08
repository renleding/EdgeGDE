import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:8787',
    headless: true,
  },
  webServer: {
    command: 'cd .. && npx wrangler dev --port 8787',
    port: 8787,
    timeout: 120000,
    reuseExistingServer: true,
  },
})
