/**
 * EdgeGDE — Document Intelligence Encryption Layer
 *
 * AES-GCM field-level encryption using Web Crypto API (SubtleCrypto).
 * Key management uses a wrapped key chain:
 *   MASTER_WRAP_KEY (Workers Secrets, AES-256) → wraps per-tenant data keys
 *   Per-tenant data keys (AES-256-GCM) → encrypt individual field values
 *
 * Storage format for encrypted fields: base64(iv (12 bytes) + ciphertext + GCM tag)
 *
 * @packageDocumentation
 */

import type { D1Database } from '@cloudflare/workers-types'

// ═══════════════════════════════════════════════════════════════════════════
// Base64 helpers
// ═══════════════════════════════════════════════════════════════════════════

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

// ═══════════════════════════════════════════════════════════════════════════
// Master key management
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Import the MASTER_WRAP_KEY from a base64-encoded secret into an AES-KW CryptoKey.
 * AES-KW is the standard algorithm for wrapping/unwrapping AES keys.
 */
export async function importMasterWrapKey(base64Key: string): Promise<CryptoKey> {
  const keyBytes = base64ToBytes(base64Key)

  if (keyBytes.byteLength !== 32) {
    throw new Error(`MASTER_WRAP_KEY must be 32 bytes (AES-256), got ${keyBytes.byteLength}`)
  }

  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-KW' },
    false, // non-extractable — master key never leaves the runtime
    ['wrapKey', 'unwrapKey'],
  )
}

/**
 * Get the MASTER_WRAP_KEY from env, imported as a CryptoKey.
 * Returns null if the secret is not set.
 */
export async function getMasterWrapKey(
  env: Record<string, unknown>,
): Promise<CryptoKey | null> {
  const raw = env.MASTER_WRAP_KEY as string | undefined
  if (!raw) return null
  try {
    return await importMasterWrapKey(raw)
  } catch (err) {
    console.error('[encryption] Failed to import MASTER_WRAP_KEY:', err)
    return null
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Data key lifecycle: generate, wrap, unwrap
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a new AES-256-GCM data key.
 */
export async function generateDataKey(): Promise<CryptoKey> {
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true, // extractable — needed to export for wrapping
    ['encrypt', 'decrypt'],
  )
  // AES-GCM is symmetric — always returns a single CryptoKey, never CryptoKeyPair
  return key as unknown as CryptoKey
}

/**
 * Wrap a data key under the MASTER_WRAP_KEY using AES-KW.
 * Returns a base64-encoded wrapped key.
 */
export async function wrapDataKey(
  masterKwKey: CryptoKey,
  dataKey: CryptoKey,
): Promise<string> {
  const wrapped = await crypto.subtle.wrapKey('raw', dataKey, masterKwKey, 'AES-KW')
  return bytesToBase64(new Uint8Array(wrapped))
}

/**
 * Unwrap a base64-encoded wrapped key using AES-KW.
 * Returns the unwrapped AES-GCM CryptoKey ready for encrypt/decrypt.
 */
export async function unwrapDataKey(
  masterKwKey: CryptoKey,
  wrappedKeyBase64: string,
): Promise<CryptoKey> {
  const wrappedBytes = base64ToBytes(wrappedKeyBase64)
  return crypto.subtle.unwrapKey(
    'raw',
    wrappedBytes,
    masterKwKey,
    'AES-KW',
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable — data key stays in the runtime
    ['encrypt', 'decrypt'],
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Field-level encrypt / decrypt with AES-GCM
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Encrypt a plaintext field value using AES-GCM with a unique 12-byte IV.
 * Returns: base64(iv + ciphertext + GCM tag)
 */
export async function encryptField(
  dataKey: CryptoKey,
  plaintext: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(plaintext)

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    dataKey,
    encoded,
  )

  // Combine: [12 bytes IV] + [ciphertext (includes 16-byte GCM tag)]
  const combined = new Uint8Array(iv.length + encrypted.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(encrypted), iv.length)

  return bytesToBase64(combined)
}

/**
 * Decrypt an AES-GCM encrypted field value.
 * Input: base64(iv + ciphertext + GCM tag)
 * Returns: plaintext string
 */
export async function decryptField(
  dataKey: CryptoKey,
  encryptedBase64: string,
): Promise<string> {
  const combined = base64ToBytes(encryptedBase64)

  if (combined.byteLength < 13) {
    throw new Error('Invalid encrypted value: too short')
  }

  // First 12 bytes are the IV
  const iv = combined.slice(0, 12)
  // Remaining bytes are ciphertext + GCM tag
  const ciphertext = combined.slice(12)

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    dataKey,
    ciphertext,
  )

  return new TextDecoder().decode(decrypted)
}

// ═══════════════════════════════════════════════════════════════════════════
// Key registry (D1) operations
// ═══════════════════════════════════════════════════════════════════════════

interface KeyRegistryRow {
  key_version: number
  wrapped_key: string
}

/**
 * Fetch the latest non-retired key version for a tenant from the key_registry table.
 */
export async function getCurrentKeyVersion(
  db: D1Database,
  tenant: string,
): Promise<KeyRegistryRow | null> {
  const row = await db.prepare(
    `SELECT key_version, wrapped_key
     FROM key_registry
     WHERE tenant = ? AND retired_at IS NULL
     ORDER BY key_version DESC
     LIMIT 1`,
  ).bind(tenant).first<KeyRegistryRow>()

  return row ?? null
}

/**
 * Create a new wrapped key entry in the key_registry table.
 * Generates a new data key, wraps it with the master key, and stores it.
 * Returns the key version and unwrapped CryptoKey.
 */
export async function createNewKeyVersion(
  db: D1Database,
  tenant: string,
  masterKwKey: CryptoKey,
): Promise<{ keyVersion: number; dataKey: CryptoKey }> {
  // Generate a new data key
  const dataKey = await generateDataKey()

  // Wrap it under MASTER_WRAP_KEY
  const wrappedKey = await wrapDataKey(masterKwKey, dataKey)

  // Insert into key_registry (key_version is auto-increment)
  await db.prepare(
    `INSERT INTO key_registry (tenant, wrapped_key, created_at)
     VALUES (?, ?, unixepoch())`,
  ).bind(tenant, wrappedKey).run()

  // Fetch back to get the auto-incremented key_version
  const inserted = await db.prepare(
    `SELECT key_version FROM key_registry
     WHERE tenant = ? AND wrapped_key = ?
     ORDER BY key_version DESC LIMIT 1`,
  ).bind(tenant, wrappedKey).first<{ key_version: number }>()

  const keyVersion = inserted?.key_version ?? 1

  return { keyVersion, dataKey }
}

/**
 * Get or create a data key for a tenant.
 * Returns the latest wrapped key (unwrapped into a CryptoKey) and its version.
 */
export async function getOrCreateDataKey(
  db: D1Database,
  tenant: string,
  masterKwKey: CryptoKey | null,
): Promise<{ keyVersion: number; dataKey: CryptoKey } | null> {
  if (!masterKwKey) return null

  // Try to get existing key
  const existing = await getCurrentKeyVersion(db, tenant)

  if (existing) {
    try {
      const dataKey = await unwrapDataKey(masterKwKey, existing.wrapped_key)
      return { keyVersion: existing.key_version, dataKey }
    } catch (err) {
      console.error(`[encryption] Failed to unwrap key v${existing.key_version} for tenant "${tenant}":`, err)
      // Fall through to create a new key
    }
  }

  // Create new key
  return createNewKeyVersion(db, tenant, masterKwKey)
}

// ═══════════════════════════════════════════════════════════════════════════
// Batch operations for field processing
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fields that must be encrypted based on their data classification.
 * Only CONFIDENTIAL and RESTRICTED classification fields are encrypted.
 */
function shouldEncryptField(classification: string): boolean {
  return classification === 'CONFIDENTIAL' || classification === 'RESTRICTED'
}

/**
 * Encrypt a batch of field values.
 * Returns a map of field_name → encrypted_value.
 * Only CONFIDENTIAL and RESTRICTED fields are encrypted.
 */
export async function encryptFields(
  fields: Array<{ name: string; value: string; classification: string }>,
  db: D1Database,
  tenant: string,
  env: Record<string, unknown>,
): Promise<{
  encryptedFields: Array<{
    field_name: string
    field_value_encrypted: string
    key_version: number
    classification: string
  }>
  keyVersion: number
}> {
  const masterKwKey = await getMasterWrapKey(env)
  if (!masterKwKey) {
    // If no MASTER_WRAP_KEY configured, store plaintext (dev mode)
    return {
      encryptedFields: fields.map(f => ({
        field_name: f.name,
        field_value_encrypted: f.value,
        key_version: 1,
        classification: f.classification,
      })),
      keyVersion: 1,
    }
  }

  const keyResult = await getOrCreateDataKey(db, tenant, masterKwKey)
  if (!keyResult) {
    throw new Error('ENCRYPTION_FAILED: Could not get or create data key')
  }

  const { dataKey, keyVersion } = keyResult

  const encryptedFields = await Promise.all(
    fields.map(async (field) => {
      if (shouldEncryptField(field.classification)) {
        const encrypted = await encryptField(dataKey, field.value)
        return {
          field_name: field.name,
          field_value_encrypted: encrypted,
          key_version: keyVersion,
          classification: field.classification,
        }
      }
      // PUBLIC and INTERNAL fields stored as plaintext
      return {
        field_name: field.name,
        field_value_encrypted: field.value,
        key_version: keyVersion,
        classification: field.classification,
      }
    }),
  )

  return { encryptedFields, keyVersion }
}

/**
 * Decrypt a batch of encrypted field values.
 * Fields are decrypted in-place on the returned array.
 */
export async function decryptFields(
  encryptedFieldRows: Array<{
    field_name: string
    field_value_encrypted: string
    key_version: number
    data_classification: string
  }>,
  db: D1Database,
  tenant: string,
  env: Record<string, unknown>,
): Promise<
  Array<{
    field_name: string
    field_value: string
    key_version: number
    data_classification: string
  }>
> {
  const masterKwKey = await getMasterWrapKey(env)
  if (!masterKwKey) {
    // No key configured — return stored values as-is (dev mode)
    return encryptedFieldRows.map(r => ({
      field_name: r.field_name,
      field_value: r.field_value_encrypted,
      key_version: r.key_version,
      data_classification: r.data_classification,
    }))
  }

  // Collect unique key versions needed
  const versionSet = new Set<number>()
  for (const row of encryptedFieldRows) {
    if (shouldEncryptField(row.data_classification)) {
      versionSet.add(row.key_version)
    }
  }

  // Fetch all needed wrapped keys
  const keysByVersion = new Map<number, CryptoKey>()
  for (const version of versionSet) {
    const row = await db.prepare(
      `SELECT wrapped_key FROM key_registry
       WHERE tenant = ? AND key_version = ?`,
    ).bind(tenant, version).first<{ wrapped_key: string }>()

    if (!row) {
      console.error(`[encryption] Key version ${version} not found for tenant "${tenant}"`)
      continue
    }

    try {
      const dataKey = await unwrapDataKey(masterKwKey, row.wrapped_key)
      keysByVersion.set(version, dataKey)
    } catch (err) {
      console.error(`[encryption] Failed to unwrap key v${version} for tenant "${tenant}":`, err)
    }
  }

  // Process each field
  const results = await Promise.all(
    encryptedFieldRows.map(async (row) => {
      if (!shouldEncryptField(row.data_classification)) {
        // PUBLIC / INTERNAL — stored as plaintext
        return {
          field_name: row.field_name,
          field_value: row.field_value_encrypted,
          key_version: row.key_version,
          data_classification: row.data_classification,
        }
      }

      const dataKey = keysByVersion.get(row.key_version)
      if (!dataKey) {
        return {
          field_name: row.field_name,
          field_value: `[ENCRYPTED: key v${row.key_version} unavailable]`,
          key_version: row.key_version,
          data_classification: row.data_classification,
        }
      }

      try {
        const plaintext = await decryptField(dataKey, row.field_value_encrypted)
        return {
          field_name: row.field_name,
          field_value: plaintext,
          key_version: row.key_version,
          data_classification: row.data_classification,
        }
      } catch (err) {
        console.error(`[encryption] Failed to decrypt field "${row.field_name}":`, err)
        return {
          field_name: row.field_name,
          field_value: `[DECRYPTION_FAILED]`,
          key_version: row.key_version,
          data_classification: row.data_classification,
        }
      }
    }),
  )

  return results
}
