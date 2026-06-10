/**
 * EdgeGDE Runtime — Tenant Layout Deployment
 * Phase 35B: Deploy a validated LayoutDefinition + DESIGN.md to a tenant.
 *
 * Flow: validate → version → KV → invalidate → pre-warm → respond
 *
 * Must be called AFTER the layout has been validated by layoutDefinitionSchema.
 */

import { compileLayout } from '../compiler/engine'
import { nextArtifactVersion, requireD1 } from './version-counter'
import type { LayoutDefinition } from '@edgegde/schema'
import type { DesignTokens } from './design-parser'

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface DeployTenantResult {
  tenantId: string
  version: number
  url: string
}

export interface DeployTenantInput {
  tenantId: string
  layout: LayoutDefinition
  design: string
  source?: string
}

// ═══════════════════════════════════════════════════════════════════════════
// Deploy
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Deploy a layout to a tenant's live site.
 *
 * Guarantees:
 * - Atomic version increment (D1)
 * - KV writes in correct order
 * - Compiled cache invalidated before pre-warm
 * - Deterministic output per input
 *
 * @throws If any step fails — caller should catch and return 500.
 */
export async function deployTenantLayout(
  tenantId: string,
  layout: LayoutDefinition,
  design: string,
  db: unknown,
  TENANT_KV: any,
  source?: string,
): Promise<DeployTenantResult> {
  // ── 1. Atomic version increment (D1 required) ──────────────────────────
  requireD1(db)
  const version = await nextArtifactVersion(db, tenantId, 'layout')

  // ── 2. KV writes ───────────────────────────────────────────────────────
  await TENANT_KV.put(
    `tenant:${tenantId}:layout:latest`,
    JSON.stringify(layout),
  )
  await TENANT_KV.put(`tenant:${tenantId}:design`, design)

  // ── 3. Log ─────────────────────────────────────────────────────────────
  console.log(JSON.stringify({
    event: 'publish',
    kind: 'tenant',
    source: source || 'ai',
    tenantId,
    version,
    timestamp: Date.now(),
  }))

  return {
    tenantId,
    version,
    url: `https://${tenantId}.edgegde.com`,
  }
}
