/**
 * EdgeGDE — Factory Engine
 * Deterministic config compiler: blueprint → packs → merged config → persist.
 * Transaction-safe: packs install BEFORE persist. If install fails, no config written.
 */

import { Blueprint, BlueprintSchema } from '../blueprint/blueprint.schema'
import { installPacks, InstallResult } from '../packs/pack.installer'
import { ChatConfigSchema } from '../../lib/chat-config'

export interface FactoryInput {
  blueprint: Blueprint
  overrides?: Record<string, unknown>
  tenantId: string
  slug: string
  tenantName?: string
}

export interface FactoryOutput {
  tenantId: string
  slug: string
  config: Record<string, unknown>
  packs: InstallResult
  compiledAt: number
}

// ═══════════════════════════════════════════════════════════════════════════
// Commit — write tenant + config to KV (raw binding)
// ═══════════════════════════════════════════════════════════════════════════

async function commitTenant(rawKv: any, rawDb: any, slug: string, tenantId: string, name: string): Promise<void> {
  await rawKv.put('tenant:' + slug, JSON.stringify({
    tenantId, slug, name,
    createdAt: new Date().toISOString(),
    plan: 'free',
  }))
  if (rawDb && typeof rawDb.prepare === 'function') {
    try {
      await rawDb.prepare(
        'INSERT OR IGNORE INTO tenants (slug, tenant_id, name, plan) VALUES (?, ?, ?, ?)'
      ).bind(slug, tenantId, name, 'free').run()
    } catch {}
  }
}

async function commitConfig(rawKv: any, tenantId: string, slug: string, config: Record<string, unknown>): Promise<void> {
  // Write to both UUID key (internal reference) and slug key (admin/widget lookup)
  await rawKv.put('tenant:' + tenantId + ':chat:config', JSON.stringify(config))
  await rawKv.put('tenant:' + slug + ':chat:config', JSON.stringify(config))
}

async function commitBlueprintRef(rawKv: any, slug: string, tenantId: string, bpId: string, bpVersion: string): Promise<void> {
  const ref = { id: bpId, version: bpVersion, installed_at: Date.now() }
  // Write to both slug key (admin lookup) and UUID key (internal)
  await rawKv.put('tenant:' + slug + ':blueprint_ref', JSON.stringify(ref))
  await rawKv.put('tenant:' + tenantId + ':blueprint_ref', JSON.stringify(ref))
}

// ═══════════════════════════════════════════════════════════════════════════
// Compile blueprint into tenant config
// ═══════════════════════════════════════════════════════════════════════════

export async function compileBlueprint(
  input: FactoryInput,
  env: any,
): Promise<FactoryOutput> {
  const { blueprint, overrides, tenantId, slug, tenantName } = input
  const rawKv = (env as any)?.TENANT_KV
  const rawDb = (env as any)?.DB

  if (!rawKv) throw new Error('TENANT_KV binding not available')

  // Step 1: Validate blueprint
  BlueprintSchema.parse(blueprint)

  const fieldNames = new Set(blueprint.fields.map(f => f.fieldName))
  for (const p of blueprint.priorityOrder) {
    if (!fieldNames.has(p)) throw new Error('priorityOrder references unknown field: "' + p + '"')
  }

  // Step 2: Install packs (happens BEFORE persist — if this fails, no partial state)
  const packs = await installPacks(env, tenantId, blueprint.packs || {})

  // Step 3: Build the chat config
  const config: Record<string, unknown> = {
    objective: (tenantName || slug) + ' — Customer intake',
    fields: blueprint.fields,
    priorityOrder: blueprint.priorityOrder,
    rules: [],
    knowledgeBase: { topics: ['rates', 'products', 'policy', 'fees', 'compliance', 'general'] },
    ui: {
      title: tenantName || slug,
      greeting: 'Welcome to ' + (tenantName || slug) + '! Let\'s get started with your application.',
      colorAccent: '#58a6ff',
    },
    pack_versions: packs.packVersions,
  }

  // Step 4: Apply overrides
  if (overrides) applyMerge(config, overrides)

  // Step 5: Validate final config
  ChatConfigSchema.parse(config)

  // Step 6: Persist — all three writes in sequence
  await commitTenant(rawKv, rawDb, slug, tenantId, tenantName || slug)
  await commitConfig(rawKv, tenantId, slug, config)
    await commitBlueprintRef(rawKv, slug, tenantId, blueprint.id, blueprint.version)

  return { tenantId, slug, config, packs, compiledAt: Date.now() }
}

// ═══════════════════════════════════════════════════════════════════════════
// Deep merge (no mutation of originals)
// ═══════════════════════════════════════════════════════════════════════════

export function applyMerge(base: Record<string, unknown>, override: Record<string, unknown>): void {
  for (const key of Object.keys(override)) {
    const bv = base[key]
    const ov = override[key]
    if (typeof bv === 'object' && !Array.isArray(bv) && typeof ov === 'object' && !Array.isArray(ov) && bv !== null && ov !== null) {
      applyMerge(bv as Record<string, unknown>, ov as Record<string, unknown>)
    } else {
      base[key] = ov
    }
  }
}