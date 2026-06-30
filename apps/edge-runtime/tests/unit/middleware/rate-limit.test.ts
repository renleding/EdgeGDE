import { describe, it, expect } from 'vitest'

describe('Rate limit middleware', () => {
  it('module loads without error', async () => {
    const mod = await import('../../../src/middleware/rate-limit')
    expect(mod).toHaveProperty('rateLimitRegistration')
  })
})
