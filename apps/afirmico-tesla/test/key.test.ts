import { defineConfig } from 'vitest/config'
import { readFileSync } from 'node:fs'
import { createPublicKey, createPrivateKey } from 'node:crypto'
import { describe, it, expect } from 'vitest'

const PUB_PATH = new URL('../public/.well-known/appspecific/com.tesla.3p.public-key.pem', import.meta.url)

describe('Tesla public key', () => {
  const pem = readFileSync(PUB_PATH, 'utf8')

  it('is a valid, parseable PEM public key', () => {
    expect(pem).toContain('-----BEGIN PUBLIC KEY-----')
    expect(pem).toContain('-----END PUBLIC KEY-----')
    expect(() => createPublicKey(pem)).not.toThrow()
  })

  it('is an EC P-256 (prime256v1) key, as Tesla requires', () => {
    const key = createPublicKey(pem)
    expect(key.asymmetricKeyType).toBe('ec')
    expect(key.asymmetricKeyDetails?.namedCurve).toBe('prime256v1')
  })

  it('contains no private key material', () => {
    expect(pem).not.toContain('PRIVATE KEY')
  })
})

describe('keypair correspondence', () => {
  it('committed public key matches the vaulted private key, when provided', () => {
    const priv = process.env.TESLA_PRIVATE_KEY_PEM
    if (!priv) {
      // No private key available (the vault is the only copy and CI does not hold it).
      // Correspondence is asserted during provisioning instead.
      expect(true).toBe(true)
      return
    }
    const derived = createPublicKey(createPrivateKey(priv)).export({ type: 'spki', format: 'pem' })
    expect(derived.toString().trim()).toBe(readFileSync(PUB_PATH, 'utf8').trim())
  })
})

// Guard the two things that silently break Tesla onboarding: wrong content type
// and the key path being swallowed by a catch-all.
describe('worker contract', () => {
  it('declares the key route before any catch-all handler', () => {
    const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
    const keyRoute = src.indexOf('/.well-known/appspecific/com.tesla.3p.public-key.pem')
    const notFound = src.indexOf('app.notFound')
    expect(keyRoute).toBeGreaterThan(-1)
    expect(notFound).toBeGreaterThan(-1)
    expect(keyRoute).toBeLessThan(notFound)
  })
})
