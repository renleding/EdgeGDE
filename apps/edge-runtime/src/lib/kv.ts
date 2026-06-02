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

const SYSTEM_PREFIXES = ['schema:', 'deploy:']

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
export function guardKV(rawKV: any) {
  if (!rawKV || typeof rawKV.get !== 'function') {
    throw new Error('KV binding not available')
  }

  function validateRead(key: string, ctx?: TenantCtx): string {
    if (key.startsWith('tenant:') && ctx) {
      const expectedPrefix = `tenant:${ctx.tenantId}:`
      if (!key.startsWith(expectedPrefix)) {
        throw new Error(`Cross-tenant KV access blocked: ${key} does not match ${expectedPrefix}`)
      }
      return key
    }
    if (key.startsWith('global:')) return key
    if (isSystemKey(key)) return key
    throw new Error(`KV key must start with tenant:{id}:, global:, schema:, or deploy:. Got: ${key}`)
  }

  function validateWrite(key: string, ctx: TenantCtx): string {
    const expectedPrefix = `tenant:${ctx.tenantId}:`
    if (!key.startsWith(expectedPrefix)) {
      throw new Error(`KV write blocked: key must start with ${expectedPrefix}. Got: ${key}`)
    }
    return key
  }

  return {
    async get(key: string, ctx?: TenantCtx) {
      return rawKV.get(validateRead(key, ctx))
    },

    async getJson(key: string, ctx?: TenantCtx) {
      return rawKV.get(validateRead(key, ctx), 'json')
    },

    async put(key: string, value: string | object, ctx: TenantCtx, options?: any) {
      const finalKey = validateWrite(key, ctx)
      const val = typeof value === 'string' ? value : JSON.stringify(value)
      const sk = shortKey(finalKey)

      // Hardened schema validation gate
      try {
        const isStructured = /^kb(:|_pending:|_rejected:)/.test(sk) || sk.startsWith('site:')

        if (isStructured) {
          // Structured keys MUST be valid JSON
          let parsed: any
          try {
            parsed = JSON.parse(val)
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
      } catch (err: any) {
        throw new Error(`[Security Violation] KV write blocked for "${sk}": ${err.message}`)
      }

      return rawKV.put(finalKey, val, options)
    },

    async del(key: string, ctx: TenantCtx) {
      return rawKV.del(validateWrite(key, ctx))
    },
  }
}
