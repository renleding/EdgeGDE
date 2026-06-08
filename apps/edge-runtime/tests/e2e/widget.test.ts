/**
 * EdgeGDE — Bootstrapper E2E Tests
 * Tests the widget bootstrapper script (widget.v1.0.0.js)
 * and iframe embed runtime (/embed/chat).
 */
import { test, expect } from '@playwright/test'
import { createMockNDJSONStream } from './helpers'

// ═══════════════════════════════════════════════════════════════════════════
// BOOTSTRAPPER TESTS
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Bootstrapper', () => {

  test('creates iframe with correct tenant', async ({ page }) => {
    await page.setContent(`
      <script src="/public/widget.v1.0.0.js" data-tenant="afirmico"></script>
    `)
    await page.waitForSelector('iframe')
    const src = await page.locator('iframe').getAttribute('src')
    expect(src).toContain('tenant=afirmico')
  })

  test('fails cleanly without data-tenant', async ({ page }) => {
    const errors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'warn' || msg.type() === 'error') errors.push(msg.text())
    })
    await page.setContent(`
      <script src="/public/widget.v1.0.0.js"></script>
    `)
    await page.waitForTimeout(500)
    expect(await page.locator('iframe').count()).toBe(0)
    expect(errors.some(e => e.includes('data-tenant'))).toBeTruthy()
  })

  test('applies sandbox attributes', async ({ page }) => {
    await page.setContent(`
      <script src="/public/widget.v1.0.0.js" data-tenant="afirmico"></script>
    `)
    await page.waitForSelector('iframe')
    const sandbox = await page.locator('iframe').getAttribute('sandbox')
    expect(sandbox).toContain('allow-scripts')
    expect(sandbox).toContain('allow-forms')
    expect(sandbox).toContain('allow-same-origin')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// EMBED RUNTIME TESTS
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Embed Runtime', () => {

  test('returns valid HTML with chat container', async ({ page }) => {
    await page.goto('/embed/chat?tenant=afirmico')
    await expect(page.locator('#gde-chat')).toBeVisible()
    await expect(page.locator('#gde-header h1')).toContainText('AFIRMICO')
    await expect(page.locator('#chat-text-input')).toBeVisible()
    await expect(page.locator('#chat-send-btn')).toBeVisible()
  })

  test('renders welcome message', async ({ page }) => {
    await page.goto('/embed/chat?tenant=afirmico')
    await expect(page.locator('.welcome')).toBeVisible()
  })

  test('handles missing tenant gracefully', async ({ page }) => {
    await page.goto('/embed/chat')
    await expect(page.locator('#gde-chat')).toBeVisible()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// CHAT FLOW TESTS
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Chat Flow', () => {

  test('sends message and renders user bubble', async ({ page }) => {
    await page.goto('/embed/chat?tenant=afirmico')
    await page.fill('#chat-text-input', 'hello')
    await page.click('#chat-send-btn')
    await expect(page.locator('.msg-user')).toBeVisible()
  })

  test('shows typing indicator on send', async ({ page }) => {
    await page.goto('/embed/chat?tenant=afirmico')

    // Intercept stream to hold response
    await page.route('**/api/v1/chat/stream', async (route) => {
      await new Promise(r => setTimeout(r, 2000)) // delay
      await route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson',
        body: createMockNDJSONStream(['Hi ', 'there'], 'Hi there'),
      })
    })

    await page.fill('#chat-text-input', 'hello')
    await page.click('#chat-send-btn')
    await expect(page.locator('.typing-indicator')).toBeVisible({ timeout: 5000 })
  })

  test('displays streamed response', async ({ page }) => {
    await page.goto('/embed/chat?tenant=afirmico')

    await page.route('**/api/v1/chat/stream', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson',
        body: createMockNDJSONStream(
          ['Welcome! ', 'Please ', 'provide ', 'your ', 'name.'],
          'Welcome! Please provide your name.'
        ),
      })
    })

    await page.fill('#chat-text-input', 'hello')
    await page.click('#chat-send-btn')
    const botMsg = page.locator('.msg-bot .msg-bubble')
    await expect(botMsg).toContainText('Welcome!', { timeout: 10000 })
  })

  test('shows connection lost on stream failure', async ({ page }) => {
    await page.goto('/embed/chat?tenant=afirmico')

    await page.route('**/api/v1/chat/stream', async (route) => {
      await route.abort()
    })

    await page.fill('#chat-text-input', 'hello')
    await page.click('#chat-send-btn')
    const errMsg = page.locator('text=Connection lost')
    await expect(errMsg).toBeVisible({ timeout: 20000 })
  })

  test('stream timeout forces fallback message', async ({ page }) => {
    await page.goto('/embed/chat?tenant=afirmico')

    await page.route('**/api/v1/chat/stream', async (route) => {
      // Never respond (simulate hang)
      await new Promise(() => {})
    })

    await page.fill('#chat-text-input', 'hello')
    await page.click('#chat-send-btn')
    const errMsg = page.locator('text=Connection lost')
    await expect(errMsg).toBeVisible({ timeout: 20000 })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// DRAG & RESIZE TESTS
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Widget UX', () => {

  test('minimizes and restores', async ({ page }) => {
    await page.goto('/embed/chat?tenant=afirmico')
    await page.click('#gde-minimize-btn')
    await expect(page.locator('#gde-body')).not.toBeVisible()
    await page.click('#gde-minimize-btn')
    await expect(page.locator('#gde-body')).toBeVisible()
  })

  test('closes widget', async ({ page }) => {
    await page.goto('/embed/chat?tenant=afirmico')
    await page.click('#gde-close-btn')
    await expect(page.locator('#gde-chat')).not.toBeVisible()
  })
})
