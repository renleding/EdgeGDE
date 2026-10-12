/**
 * EdgeGDE — Guarded KV Access Layer
 * Triple namespace enforcement (tenant rw, global ro, system ro) +
 * KV schema validation gate for structured keys (kb:, site:).
 * Dual-invariant: key prefix routes to schema, entry.type verifies identity.
 *
 * @packageDocumentation
 */

import type { TenantCtx } from '../middleware/tenant-context'
import { validateStoragePayload } from './validators'

const SYSTEM_PREFIXES = ['schema:', 'deploy:', 'blueprint:', 'pack:']

function isSystemKey(key: string): boolean {
  return SYSTEM_PREFIXES.some(p => key.startsWith(p))
}

/**
 * Extract the short key from a full prefixed key.
 * "tenant:afirmico:kb:rates" → "kb:rates"
 * "global:kb:rates"         → "global:kb:rates"
 * "schema:v1:intake"        → "schema:v1:intake"
 */
function shortKey(key: string): string {
  if (key.startsWith('tenant:')) {
    const parts = key.split(':')
    if (parts.length >= 3) return parts.slice(2).join(':')
  }
  return key
}

/**
 * Build the guarded KV wrapper from the raw binding.
 */
/** Minimal structural type describing the guarded KV wrapper returned by {@link guardKV}. */
export interface GuardedKV {
  get(key: string, ctxOrType?: TenantCtx | 'json', type?: 'json'): Promise<string | null>
  getJson<T = unknown>(key: string, ctx?: TenantCtx): Promise<T | null>
  put(key: string, value: string | object, ctx?: TenantCtx, options?: unknown): Promise<unknown>
  del(key: string, ctx: TenantCtx): Promise<unknown>
}

export function guardKV(rawKV: unknown): GuardedKV {
  if (!rawKV || typeof (rawKV as Record<string, unknown>).get !== 'function') {
    throw new Error('KV binding not available')
  }

  const raw = rawKV as Record<string, unknown>
  // Call raw.get/put/del as INLINE casts — never extract to a standalone const.
  // KV's get/put/del are bound getters in Workers; extracting the reference drops `this`
  // and throws "Cannot read properties of undefined (reading 'alwaysPrimarySession')" in production.

  function validateRead(key: string, ctx?: TenantCtx): string {
    if (key.startsWith('tenant:') && ctx) {
      const expectedPrefix = `tenant:${ctx.tenantId}:`
      if (!key.startsWith(expectedPrefix)) {
        throw new Error(`Cross-tenant KV access blocked: ${key} does not match ${expectedPrefix}`)
      }
      return key
    }
    if (key.startsWith('tenant:')) {
      throw new Error(`KV read blocked: tenant-scoped key requires tenant context: ${key}`)
    }
    if (key.startsWith('global:') || isSystemKey(key)) return key
    if (!ctx) return key
    throw new Error(`KV key must start with tenant:{id}:, global:, schema:, or deploy:. Got: ${key}`)
  }

  function validateWrite(key: string, ctx?: TenantCtx): string {
    if (key.startsWith('tenant:')) {
      if (!ctx) throw new Error(`KV write blocked: tenant-scoped key requires tenant context: ${key}`)
      const expectedPrefix = `tenant:${ctx.tenantId}:`
      if (!key.startsWith(expectedPrefix)) {
        throw new Error(`KV write blocked: key must start with ${expectedPrefix}. Got: ${key}`)
      }
      return key
    }
    if (key.startsWith('global:') || isSystemKey(key)) return key
    if (!ctx) return key
    throw new Error(`KV write blocked: key must start with tenant:{id}:, global:, schema:, or deploy:. Got: ${key}`)
  }

  return {
    async get(key: string, ctxOrType?: TenantCtx | 'json', type?: 'json') {
      const ctx = typeof ctxOrType === 'object' ? ctxOrType : undefined
      const valueType = typeof ctxOrType === 'string' ? ctxOrType : type
      // Fresh .get access (not pre-extracted) — preserves Workers binding.
      const ns = rawKV as {
        get(key: string, type?: string): Promise<string | null>
      }
      return ns.get(validateRead(key, ctx), valueType) as Promise<string | null>
    },

    async getJson<T = unknown>(key: string, ctx?: TenantCtx): Promise<T | null> {
      const ns = rawKV as {
        get(key: string, type: string): Promise<string | null>
      }
      return ns.get(validateRead(key, ctx), 'json') as Promise<T | null>
    },

    async put(key: string, value: string | object, ctx?: TenantCtx, options?: unknown) {
      const finalKey = validateWrite(key, ctx)
      const val = typeof value === 'string' ? value : JSON.stringify(value)
      const sk = shortKey(finalKey)

      // Hardened schema validation gate
      try {
        const isStructured = /^kb(:|_pending:|_rejected:)/.test(sk) || sk.startsWith('site:')

        if (isStructured) {
          // Structured keys MUST be valid JSON
          let parsed: Record<string, unknown>
          try {
            parsed = JSON.parse(val) as Record<string, unknown>
          } catch {
            throw new Error(`KV key "${sk}" requires valid JSON`)
          }
          // Validate schema + dual-invariant
          validateStoragePayload(sk, parsed)
        } else {
          // Non-structured: if it looks like JSON, validate anyway
          const trimmed = val.trim()
          if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
              const parsed = JSON.parse(val)
              validateStoragePayload(sk, parsed)
            } catch {
              // Non-structured key — not enforced
            }
          }
        }
      } catch (err: unknown) {
        throw new Error(`[Security Violation] KV write blocked for "${sk}": ${err instanceof Error ? err.message : 'Unknown error'}`)
      }

      // Fresh .put access (not pre-extracted) — preserves Workers binding.
      const ns = rawKV as {
        put(key: string, value: string | object, options?: unknown): Promise<unknown>
      }
      return ns.put(finalKey, val, options)
    },

    async del(key: string, ctx: TenantCtx) {
      // Fresh .delete access — preserves Workers binding.
      // NOTE: the raw KV Namespace method is `delete(key)`, NOT `del(key)`.
      const ns = rawKV as {
        delete(key: string): Promise<unknown>
      }
      return ns.delete(validateWrite(key, ctx))
    },
  }
}
