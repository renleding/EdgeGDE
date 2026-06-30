import { describe, it, expect } from 'vitest'

describe('Session middleware', () => {
  it('module loads without error', async () => {
    const mod = await import('../../../src/middleware/session')
    expect(mod).toHaveProperty('createSessionToken')
    expect(mod).toHaveProperty('setSessionCookie')
    expect(mod).toHaveProperty('clearSessionCookie')
  })
})
