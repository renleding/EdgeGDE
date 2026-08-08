/**
 * EdgeGDE — Encryption Layer (src/lib/encryption.ts) Test Suite
 *
 * Web Crypto (SubtleCrypto) AES-GCM field encryption + AES-KW key chain.
 * Covers:
 *   - Master wrap key import / env lookup
 *   - Data key generate / wrap / unwrap round-trips
 *   - Field encrypt/decrypt round-trips, unique IVs, error paths
 *   - Key registry (D1) ops: get current version, create new version, get-or-create
 *   - Batch encryptFields / decryptFields incl. classification gating and dev mode
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  importMasterWrapKey,
  getMasterWrapKey,
  generateDataKey,
  wrapDataKey,
  unwrapDataKey,
  encryptField,
  decryptField,
  getCurrentKeyVersion,
  createNewKeyVersion,
  getOrCreateDataKey,
  encryptFields,
  decryptFields,
} from '../../../src/lib/encryption'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bytesToB64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function randomB64(bytes: number): string {
  return bytesToB64(crypto.getRandomValues(new Uint8Array(bytes)))
}

/** D1 mock whose .first() results are consumed from a queue (per prepare→bind→first chain). */
function makeDb(overrides: {
  firstResults?: any[]
  firstImpl?: () => any
  runImpl?: () => void
} = {}) {
  const queue = [...(overrides.firstResults ?? [])]
  const first = vi.fn(async () => {
    if (overrides.firstImpl) return overrides.firstImpl()
    return queue.length ? queue.shift() : null
  })
  const run = vi.fn(async () => { overrides.runImpl?.() })
  const bind = vi.fn((..._args: unknown[]) => ({ first, run }))
  const prepare = vi.fn((..._args: unknown[]) => ({ bind }))
  return { prepare, bind, first, run }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('importMasterWrapKey', () => {
  it('imports a valid 32-byte AES-KW key', async () => {
    const key = await importMasterWrapKey(randomB64(32))
    expect(key).toBeInstanceOf(Object)
    expect((key.algorithm as any).name).toBe('AES-KW')
    expect(key.extractable).toBe(false)
    expect(key.usages).toEqual(['wrapKey', 'unwrapKey'])
  })

  it('throws when the key is not 32 bytes', async () => {
    await expect(importMasterWrapKey(randomB64(16))).rejects.toThrow(
      'MASTER_WRAP_KEY must be 32 bytes (AES-256), got 16',
    )
    await expect(importMasterWrapKey(randomB64(64))).rejects.toThrow(/must be 32 bytes/)
  })

  it('throws on invalid base64 input', async () => {
    await expect(importMasterWrapKey('not-base64!!!')).rejects.toThrow()
  })
})

describe('getMasterWrapKey', () => {
  it('returns null when env has no MASTER_WRAP_KEY', async () => {
    await expect(getMasterWrapKey({})).resolves.toBeNull()
    await expect(getMasterWrapKey({ OTHER: 'x' })).resolves.toBeNull()
  })

  it('returns null and logs when the secret is invalid', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(getMasterWrapKey({ MASTER_WRAP_KEY: 'too-short' })).resolves.toBeNull()
      expect(err).toHaveBeenCalledWith('[encryption] Failed to import MASTER_WRAP_KEY:', expect.any(Error))
    } finally {
      err.mockRestore()
    }
  })

  it('returns an imported key for a valid secret', async () => {
    const key = await getMasterWrapKey({ MASTER_WRAP_KEY: randomB64(32) })
    expect(key).not.toBeNull()
    expect((key!.algorithm as any).name).toBe('AES-KW')
  })
})

describe('generateDataKey', () => {
  it('generates an extractable AES-GCM key with encrypt/decrypt usages', async () => {
    const key = await generateDataKey()
    expect((key.algorithm as any).name).toBe('AES-GCM')
    expect((key.algorithm as any).length).toBe(256)
    expect(key.extractable).toBe(true)
    expect(key.usages.sort()).toEqual(['decrypt', 'encrypt'])
  })

  it('generates unique keys on each call', async () => {
    const a = await generateDataKey()
    const b = await generateDataKey()
    expect(a).not.toBe(b)
  })
})

describe('wrap / unwrap data key round-trip', () => {
  let master: CryptoKey

  beforeEach(async () => {
    master = await importMasterWrapKey(randomB64(32))
  })

  it('wrapDataKey returns a non-empty base64 string', async () => {
    const dataKey = await generateDataKey()
    const wrapped = await wrapDataKey(master, dataKey)
    expect(typeof wrapped).toBe('string')
    expect(wrapped.length).toBeGreaterThan(0)
    expect(() => b64ToBytes(wrapped)).not.toThrow()
  })

  it('unwrapDataKey restores a usable AES-GCM key', async () => {
    const dataKey = await generateDataKey()
    const wrapped = await wrapDataKey(master, dataKey)
    const unwrapped = await unwrapDataKey(master, wrapped)

    expect((unwrapped.algorithm as any).name).toBe('AES-GCM')
    expect(unwrapped.extractable).toBe(false)
    expect(unwrapped.usages.sort()).toEqual(['decrypt', 'encrypt'])

    // Round trip through the unwrapped key
    const cipher = await encryptField(unwrapped, 'secret-value')
    expect(await decryptField(unwrapped, cipher)).toBe('secret-value')
  })

  it('unwrap fails when master key does not match', async () => {
    const dataKey = await generateDataKey()
    const wrapped = await wrapDataKey(master, dataKey)
    const otherMaster = await importMasterWrapKey(randomB64(32))
    await expect(unwrapDataKey(otherMaster, wrapped)).rejects.toThrow()
  })
})

describe('encryptField / decryptField', () => {
  let dataKey: CryptoKey

  beforeEach(async () => {
    dataKey = await generateDataKey()
  })

  it('round-trips plaintext', async () => {
    const cipher = await encryptField(dataKey, 'hello world')
    expect(await decryptField(dataKey, cipher)).toBe('hello world')
  })

  it('round-trips unicode and special characters', async () => {
    const text = 'naïve café — 日本語 🎉 <script>&"'
    const cipher = await encryptField(dataKey, text)
    expect(await decryptField(dataKey, cipher)).toBe(text)
  })

  it('round-trips empty string', async () => {
    const cipher = await encryptField(dataKey, '')
    expect(await decryptField(dataKey, cipher)).toBe('')
  })

  it('produces unique ciphertext for identical plaintext (unique IV)', async () => {
    const a = await encryptField(dataKey, 'same')
    const b = await encryptField(dataKey, 'same')
    expect(a).not.toBe(b)
    expect(await decryptField(dataKey, a)).toBe('same')
    expect(await decryptField(dataKey, b)).toBe('same')
  })

  it('stores format: base64(12-byte IV + ciphertext + 16-byte GCM tag)', async () => {
    const cipher = await encryptField(dataKey, '1234567890')
    const bytes = b64ToBytes(cipher)
    // 12 (IV) + 10 (plaintext) + 16 (tag)
    expect(bytes.length).toBe(38)
  })

  it('throws on input shorter than 13 bytes', async () => {
    await expect(decryptField(dataKey, 'AAAA')).rejects.toThrow('Invalid encrypted value: too short')
    await expect(decryptField(dataKey, bytesToB64(new Uint8Array(12)))).rejects.toThrow(/too short/)
  })

  it('rejects when ciphertext is tampered', async () => {
    const cipher = await encryptField(dataKey, 'integrity-check')
    const bytes = b64ToBytes(cipher)
    bytes[bytes.length - 1] = bytes[bytes.length - 1] ^ 0xff // flip a tag byte
    await expect(decryptField(dataKey, bytesToB64(bytes))).rejects.toThrow()
  })

  it('fails to decrypt with a different key', async () => {
    const cipher = await encryptField(dataKey, 'mine')
    const otherKey = await generateDataKey()
    await expect(decryptField(otherKey, cipher)).rejects.toThrow()
  })
})

describe('getCurrentKeyVersion', () => {
  it('returns the first() row when present', async () => {
    const db = makeDb({ firstResults: [{ key_version: 3, wrapped_key: 'w1' }] })
    const row = await getCurrentKeyVersion(db as any, 'tenant-1')
    expect(row).toEqual({ key_version: 3, wrapped_key: 'w1' })
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('FROM key_registry'))
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('retired_at IS NULL'))
    expect(db.bind).toHaveBeenCalledWith('tenant-1')
  })

  it('returns null when no row exists', async () => {
    const db = makeDb()
    await expect(getCurrentKeyVersion(db as any, 'tenant-1')).resolves.toBeNull()
  })
})

describe('createNewKeyVersion', () => {
  let master: CryptoKey

  beforeEach(async () => {
    master = await importMasterWrapKey(randomB64(32))
  })

  it('inserts a wrapped key and returns the fetched key version', async () => {
    const db = makeDb({ firstResults: [{ key_version: 5 }] })
    const { keyVersion, dataKey } = await createNewKeyVersion(db as any, 'tenant-1', master)

    expect(keyVersion).toBe(5)
    expect((dataKey.algorithm as any).name).toBe('AES-GCM')
    // INSERT ran, then the fetch-back SELECT ran
    expect(db.prepare).toHaveBeenCalledTimes(2)
    expect(db.prepare.mock.calls[0][0]).toContain('INSERT INTO key_registry')
    // Wrapped key stored is a base64 string
    expect(db.bind.mock.calls[0][1]).toEqual(expect.stringMatching(/^[A-Za-z0-9+/=]+$/))
    expect(db.run).toHaveBeenCalledTimes(1)
  })

  it('defaults keyVersion to 1 when fetch-back returns nothing', async () => {
    const db = makeDb({ firstResults: [null] })
    const { keyVersion, dataKey } = await createNewKeyVersion(db as any, 'tenant-1', master)
    expect(keyVersion).toBe(1)
    expect(dataKey).toBeDefined()
  })

  it('the returned data key round-trips after unwrapping from the registry value', async () => {
    let storedWrapped = ''
    const db = makeDb({
      firstResults: [{ key_version: 2 }],
      runImpl: () => {},
    })
    // Capture what was inserted by reading the bind args of the INSERT
    const { keyVersion, dataKey } = await createNewKeyVersion(db as any, 'tenant-1', master)
    storedWrapped = db.bind.mock.calls[0][1] as string

    const unwrapped = await unwrapDataKey(master, storedWrapped)
    const cipher = await encryptField(dataKey, 'registry-test')
    expect(await decryptField(unwrapped, cipher)).toBe('registry-test')
    expect(keyVersion).toBe(2)
  })
})

describe('getOrCreateDataKey', () => {
  let master: CryptoKey

  beforeEach(async () => {
    master = await importMasterWrapKey(randomB64(32))
  })

  it('returns null when no master key is available', async () => {
    const db = makeDb()
    await expect(getOrCreateDataKey(db as any, 't', null)).resolves.toBeNull()
    expect(db.prepare).not.toHaveBeenCalled()
  })

  it('unwraps and returns the existing key version', async () => {
    const dataKey = await generateDataKey()
    const wrapped = await wrapDataKey(master, dataKey)
    const db = makeDb({ firstResults: [{ key_version: 7, wrapped_key: wrapped }] })

    const result = await getOrCreateDataKey(db as any, 'tenant-1', master)
    expect(result).not.toBeNull()
    expect(result!.keyVersion).toBe(7)
    // Unwrapped key decrypts data encrypted by the original
    const cipher = await encryptField(dataKey, 'x')
    expect(await decryptField(result!.dataKey, cipher)).toBe('x')
    // No INSERT happened (only the SELECT)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('creates a new key when unwrap of the existing key fails', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      // existing row has garbage wrapped_key ('AAAA' = 3 bytes → AES-KW unwrap fails)
      const db = makeDb({ firstResults: [{ key_version: 4, wrapped_key: 'AAAA' }, { key_version: 9 }] })
      const result = await getOrCreateDataKey(db as any, 'tenant-1', master)
      expect(result!.keyVersion).toBe(9)
      expect(err.mock.calls[0][0]).toEqual(expect.stringContaining('Failed to unwrap key v4'))
      // Fall-through created a new version: INSERT ran
      expect(db.run).toHaveBeenCalledTimes(1)
    } finally {
      err.mockRestore()
    }
  })

  it('creates a new key when no existing version exists', async () => {
    const db = makeDb({ firstResults: [null, { key_version: 1 }] })
    const result = await getOrCreateDataKey(db as any, 'tenant-1', master)
    expect(result!.keyVersion).toBe(1)
    expect(db.run).toHaveBeenCalledTimes(1)
  })
})

describe('encryptFields', () => {
  const fields = [
    { name: 'first_name', value: 'Alice', classification: 'PUBLIC' },
    { name: 'email', value: 'alice@example.com', classification: 'INTERNAL' },
    { name: 'ssn', value: '123-45-6789', classification: 'CONFIDENTIAL' },
    { name: 'medical', value: 'notes', classification: 'RESTRICTED' },
  ]

  it('stores plaintext for all fields when MASTER_WRAP_KEY is unset (dev mode)', async () => {
    const db = makeDb()
    const out = await encryptFields(fields, db as any, 'tenant-1', {})
    expect(out.keyVersion).toBe(1)
    expect(out.encryptedFields).toEqual([
      { field_name: 'first_name', field_value_encrypted: 'Alice', key_version: 1, classification: 'PUBLIC' },
      { field_name: 'email', field_value_encrypted: 'alice@example.com', key_version: 1, classification: 'INTERNAL' },
      { field_name: 'ssn', field_value_encrypted: '123-45-6789', key_version: 1, classification: 'CONFIDENTIAL' },
      { field_name: 'medical', field_value_encrypted: 'notes', key_version: 1, classification: 'RESTRICTED' },
    ])
    // No registry interaction in dev mode
    expect(db.prepare).not.toHaveBeenCalled()
  })

  it('encrypts CONFIDENTIAL/RESTRICTED and passes PUBLIC/INTERNAL through', async () => {
    const master = await importMasterWrapKey(randomB64(32))
    const env = { MASTER_WRAP_KEY: randomB64(32) }
    const db = makeDb({ firstResults: [null, { key_version: 2 }] }) // no existing → create → v2

    const out = await encryptFields(fields, db as any, 'tenant-1', env)
    expect(out.keyVersion).toBe(2)
    const byName = Object.fromEntries(out.encryptedFields.map(f => [f.field_name, f]))

    expect(byName.first_name.field_value_encrypted).toBe('Alice')
    expect(byName.email.field_value_encrypted).toBe('alice@example.com')
    expect(byName.ssn.field_value_encrypted).not.toBe('123-45-6789')
    expect(byName.medical.field_value_encrypted).not.toBe('notes')
    expect(byName.ssn.field_value_encrypted).toMatch(/^[A-Za-z0-9+/=]+$/)
    expect(byName.ssn.key_version).toBe(2)
    expect(byName.ssn.classification).toBe('CONFIDENTIAL')
    expect(master).toBeDefined()
  })

  // NOTE: the `if (!keyResult) throw ENCRYPTION_FAILED` branch in encryptFields is
  // defensive dead code — getOrCreateDataKey only returns null when the master key
  // is null, which encryptFields already guards against before calling it. It is
  // unreachable through the public API and therefore not directly testable.
})

describe('decryptFields', () => {
  /** Build a (masterB64, imported master, env) triple sharing the same key material. */
  async function makeMasterEnv() {
    const masterB64 = randomB64(32)
    const master = await importMasterWrapKey(masterB64)
    return { masterB64, master, env: { MASTER_WRAP_KEY: masterB64 } }
  }

  it('returns stored values as-is when MASTER_WRAP_KEY is unset (dev mode)', async () => {
    const db = makeDb()
    const rows = [
      { field_name: 'ssn', field_value_encrypted: 'enc-blob', key_version: 1, data_classification: 'CONFIDENTIAL' },
      { field_name: 'email', field_value_encrypted: 'a@b.c', key_version: 1, data_classification: 'PUBLIC' },
    ]
    const out = await decryptFields(rows, db as any, 'tenant-1', {})
    expect(out).toEqual([
      { field_name: 'ssn', field_value: 'enc-blob', key_version: 1, data_classification: 'CONFIDENTIAL' },
      { field_name: 'email', field_value: 'a@b.c', key_version: 1, data_classification: 'PUBLIC' },
    ])
    expect(db.prepare).not.toHaveBeenCalled()
  })

  it('round-trips encrypted fields and passes plaintext classifications through', async () => {
    const { master, env } = await makeMasterEnv()
    const dataKey = await generateDataKey()
    const wrapped = await wrapDataKey(master, dataKey)
    const encryptedSsn = await encryptField(dataKey, '123-45-6789')

    const rows = [
      { field_name: 'ssn', field_value_encrypted: encryptedSsn, key_version: 3, data_classification: 'CONFIDENTIAL' },
      { field_name: 'email', field_value_encrypted: 'alice@example.com', key_version: 3, data_classification: 'PUBLIC' },
      { field_name: 'internal_note', field_value_encrypted: 'plain', key_version: 3, data_classification: 'INTERNAL' },
    ]
    const db = makeDb({ firstResults: [{ wrapped_key: wrapped }] })

    const out = await decryptFields(rows, db as any, 'tenant-1', env)
    expect(out).toEqual([
      { field_name: 'ssn', field_value: '123-45-6789', key_version: 3, data_classification: 'CONFIDENTIAL' },
      { field_name: 'email', field_value: 'alice@example.com', key_version: 3, data_classification: 'PUBLIC' },
      { field_name: 'internal_note', field_value: 'plain', key_version: 3, data_classification: 'INTERNAL' },
    ])
    // Only one wrapped-key SELECT (CONFIDENTIAL row only)
    expect(db.prepare).toHaveBeenCalledTimes(1)
    expect(db.bind).toHaveBeenCalledWith('tenant-1', 3)
  })

  it('marks fields as unavailable when the key version is missing from the registry', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const rows = [
        { field_name: 'ssn', field_value_encrypted: 'abc', key_version: 42, data_classification: 'CONFIDENTIAL' },
      ]
      const db = makeDb({ firstResults: [null] })
      const out = await decryptFields(rows, db as any, 'tenant-1', { MASTER_WRAP_KEY: randomB64(32) })
      expect(out[0].field_value).toBe('[ENCRYPTED: key v42 unavailable]')
      expect(err.mock.calls[0][0]).toEqual(expect.stringContaining('Key version 42 not found'))
    } finally {
      err.mockRestore()
    }
  })

  it('marks fields as unavailable when the wrapped key cannot be unwrapped', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const rows = [
        { field_name: 'ssn', field_value_encrypted: 'abc', key_version: 5, data_classification: 'CONFIDENTIAL' },
      ]
      const db = makeDb({ firstResults: [{ wrapped_key: 'AAAA' }] }) // garbage → unwrap fails
      const out = await decryptFields(rows, db as any, 'tenant-1', { MASTER_WRAP_KEY: randomB64(32) })
      expect(out[0].field_value).toBe('[ENCRYPTED: key v5 unavailable]')
      expect(err.mock.calls[0][0]).toEqual(expect.stringContaining('Failed to unwrap key v5'))
    } finally {
      err.mockRestore()
    }
  })

  it('marks fields as DECRYPTION_FAILED when the ciphertext does not match the key', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { master, env } = await makeMasterEnv()
      // Registry holds key v1, but the field was encrypted with a DIFFERENT key
      const registryKey = await generateDataKey()
      const wrapped = await wrapDataKey(master, registryKey)
      const rogueKey = await generateDataKey()
      const cipher = await encryptField(rogueKey, 'secret')

      const rows = [
        { field_name: 'ssn', field_value_encrypted: cipher, key_version: 1, data_classification: 'CONFIDENTIAL' },
      ]
      const db = makeDb({ firstResults: [{ wrapped_key: wrapped }] })
      const out = await decryptFields(rows, db as any, 'tenant-1', env)
      expect(out[0].field_value).toBe('[DECRYPTION_FAILED]')
      expect(err.mock.calls[0][0]).toEqual(expect.stringContaining('Failed to decrypt field "ssn"'))
    } finally {
      err.mockRestore()
    }
  })
})
