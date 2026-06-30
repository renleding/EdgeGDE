import { describe, it, expect } from 'vitest'

describe('Verify API', () => {
  it('module loads without error', async () => {
    const mod = await import('../../../src/api/verify')
    expect(mod).toHaveProperty('verifyRouter')
  })
})
