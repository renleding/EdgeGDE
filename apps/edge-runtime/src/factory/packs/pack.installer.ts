/**
 * EdgeGDE — Pack Installer
 * Copies pack data from shared KV into tenant storage.
 * Idempotent: deletes existing rules before re-inserting.
 * Tracks pack versions for drift detection.
 */

import { loadRulePack, loadCompliancePack, validateRulePackData, validateCompliancePackData } from './pack.registry'

export interface InstallResult {
  rulesInstalled: number
  complianceInstalled: number
  packVersions: Record<string, string>
}

async function installRulePack(
  db: any, tenantId: string, packName: string, kv: any,
): Promise<number> {
  const rules = await loadRulePack(kv, packName)
  if (!rules.length) return 0

  // Validate pack content
  const validated = validateRulePackData(rules)

  // Idempotency: delete all existing rules for this tenant
  try {
    await db.prepare('DELETE FROM rules WHERE tenant_id = ?').bind(tenantId).run()
  } catch {}

  // Insert new rules
  let count = 0
  const now = Math.floor(Date.now() / 1000)
  for (const rule of validated) {
    try {
      await db.prepare(
        'INSERT INTO rules (id, tenant_id, condition, output, priority, active, created_at, source_pack) VALUES (?, ?, ?, ?, ?, 1, ?, ?)'
      ).bind(crypto.randomUUID(), tenantId, rule.condition, rule.output || '', rule.priority ?? 50, now, packName).run()
      count++
    } catch {}
  }
  return count
}

async function installCompliancePack(
  kv: any, tenantId: string, packName: string,
): Promise<number> {
  const entries = await loadCompliancePack(kv, packName)
  if (!entries.length) return 0

  // Validate pack content
  const validated = validateCompliancePackData(entries)

  // Idempotency: overwrite tenant compliance entries from this pack
  const key = 'tenant:' + tenantId + ':kb:compliance'
  const normalized = validated.map((e: any) => ({
    id: (e.value || '').substring(0, 32).replace(/\s+/g, '_').toLowerCase(),
    value: e.value,
    type: 'compliance' as const,
    trigger: e.trigger || 'always',
    source_ref: 'pack:' + packName + ':' + new Date().toISOString().split('T')[0],
    updated_at: Date.now(),
  }))

  // Overwrite — not merge (idempotent: same pack produces same result)
  await kv.put(key, JSON.stringify({
    entries: normalized,
    source_ref: 'pack:' + packName,
    updated_at: Date.now(),
    pack_name: packName,
  }))
  return normalized.length
}

/**
 * Install packs into tenant storage
 * @param env - The environment bindings
 * @param tenantId - The tenant ID
 * @param packs - The packs to install (rule_pack, compliance_pack)
 * @returns The install result
 */
export async function installPacks(
  env: any,
  tenantId: string,
  packs: { rule_pack?: { name: string; version: string }; compliance_pack?: { name: string; version: string } },
): Promise<InstallResult> {
  const result: InstallResult = { rulesInstalled: 0, complianceInstalled: 0, packVersions: {} }
  const rawKv = env?.TENANT_KV
  const db = env?.DB
  if (!rawKv) return result

  // Transaction safety: install packs BEFORE persisting tenant config
  // If install throws, no tenant config is written

  if (packs.rule_pack && db && typeof db.prepare === 'function') {
    const version = packs.rule_pack.version.replace(/^v/, '')
    const packKey = packs.rule_pack.name + '_v' + version
    result.rulesInstalled = await installRulePack(db, tenantId, packKey, rawKv)
    result.packVersions.rules = packKey
  }

  if (packs.compliance_pack) {
    const version = packs.compliance_pack.version.replace(/^v/, '')
    const packKey = packs.compliance_pack.name + '_v' + version
    result.complianceInstalled = await installCompliancePack(rawKv, tenantId, packKey)
    result.packVersions.compliance = packKey
  }

  return result
}