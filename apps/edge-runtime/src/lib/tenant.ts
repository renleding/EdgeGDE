/**
 * EdgeGDE Runtime — Tenant Model & Slug Validation
 * Phase 34: Unified tenant model across the entire system.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface TenantConfig {
  tenantId: string
  slug: string
  name: string
  createdAt: string
  plan: 'free' | 'pro'
}

// ═══════════════════════════════════════════════════════════════════════════
// Slug Validation
// ═══════════════════════════════════════════════════════════════════════════

const RESERVED = new Set(['api', 'admin', 'www', 'dev', 'staging', 'edgegde'])

/**
 * Validate and normalize a tenant slug.
 * Throws with a descriptive message on invalid input.
 *
 * Rules:
 * - Lowercase alphanumeric + hyphens only
 * - Must not be a reserved system slug
 */
export function validateSlug(input: string): string {
  if (!input || typeof input !== 'string') {
    throw new Error('Slug must be a non-empty string')
  }

  const slug = input.toLowerCase().trim()

  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(
      `Invalid slug "${input}": only lowercase letters, digits, and hyphens allowed`
    )
  }

  if (slug.length < 2) {
    throw new Error(`Slug "${input}" is too short (minimum 2 characters)`)
  }

  if (slug.length > 63) {
    throw new Error(`Slug "${input}" is too long (maximum 63 characters)`)
  }

  if (RESERVED.has(slug)) {
    throw new Error(`Slug "${slug}" is reserved and cannot be used`)
  }

  return slug
}
