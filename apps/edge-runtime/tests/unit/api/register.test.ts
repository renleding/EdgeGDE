import { describe, it, expect } from 'vitest'

describe('Register API', () => {
  it('module loads without error', async () => {
    const mod = await import('../../../src/api/register')
    expect(mod).toHaveProperty('registerRouter')
  })
})
