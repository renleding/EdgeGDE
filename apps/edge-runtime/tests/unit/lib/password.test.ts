import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from '../../../src/lib/password'

describe('Password utilities', () => {
  it('hashPassword and verifyPassword round-trip', async () => {
    const password = 'test-password-123'
    const hash = await hashPassword(password)
    expect(hash).toBeTruthy()
    expect(hash).not.toBe(password)

    const match = await verifyPassword(password, hash)
    expect(match).toBe(true)
  })

  it('verifyPassword rejects wrong password', async () => {
    const hash = await hashPassword('correct-password')
    const match = await verifyPassword('wrong-password', hash)
    expect(match).toBe(false)
  })
})
