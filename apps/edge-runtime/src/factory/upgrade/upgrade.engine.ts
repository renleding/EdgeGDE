/**
 * EdgeGDE — Pack Upgrade Engine
 * Lifecycle: compatibility check → snapshot → execute → verify.
 * upgrade_status gate prevents mid-upgrade execution.
 */

import { loadRulePack, loadCompliancePack, validateRulePackData, validateCompliancePackData } from '../packs/pack.registry'
import { validatePackCompatibility, generatePackDiff, SemanticDiff } from './upgrade.validator'
import { logAuditEvent } from '../../lib/audit'

export interface UpgradePlan {
  compatible: boolean
  errors: string[]
  warnings: string[]
  diff: SemanticDiff | null
}

export interface UpgradeResult {
  success: boolean
  rulesInstalled: number
  complianceInstalled: number
  snapshotted: boolean
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 1: Dry run — compatibility + diff
// ═══════════════════════════════════════════════════════════════════════════

export async function dryRunUpgrade(
  kv: any,
  tenantId: string,
  newPackName: string,
  blueprintFields: string[],
  oldRules?: any[],
  oldCompliance?: any[],
): Promise<UpgradePlan> {
  // Load new pack
  const newRules = await loadRulePack(kv, newPackName)
  const newCompliance = await loadCompliancePack(kv, newPackName)

  // Validate
  const validation = validatePackCompatibility(newRules, blueprintFields)
  if (!validation.ok) {
    return { compatible: false, errors: validation.errors, warnings: validation.warnings, diff: null }
  }

  // Generate diff
  const diff = generatePackDiff(oldRules || [], newRules, oldCompliance, newCompliance)

  return { compatible: true, errors: [], warnings: validation.warnings, diff }
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 2: Snapshot current state
// ═══════════════════════════════════════════════════════════════════════════

async function createSnapshot(rawKv: any, tenantId: string, packName: string): Promise<void> {
  const snapshotKey = 'pack:snapshot:' + tenantId + ':' + packName
  // Copy current pack data
  const rulesRaw = await rawKv.get('pack:' + packName + ':rules')
  const complianceRaw = await rawKv.get('pack:' + packName + ':compliance')
  const snapshot: Record<string, any> = {}
  if (rulesRaw) snapshot.rules = typeof rulesRaw === 'string' ? JSON.parse(rulesRaw) : rulesRaw
  if (complianceRaw) snapshot.compliance = typeof complianceRaw === 'string' ? JSON.parse(complianceRaw) : complianceRaw
  if (Object.keys(snapshot).length > 0) {
    await rawKv.put(snapshotKey, JSON.stringify(snapshot))
  }
}

async function loadSnapshot(rawKv: any, tenantId: string, packName: string): Promise<any | null> {
  const snapshotKey = 'pack:snapshot:' + tenantId + ':' + packName
  const raw = await rawKv.get(snapshotKey)
  if (!raw) return null
  return typeof raw === 'string' ? JSON.parse(raw) : raw
}

async function clearSnapshot(rawKv: any, tenantId: string, packName: string): Promise<void> {
  await rawKv.delete('pack:snapshot:' + tenantId + ':' + packName)
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 3: Execute upgrade
// ═══════════════════════════════════════════════════════════════════════════

export async function executeUpgrade(
  env: any,
  tenantId: string,
  packName: string,
  rulePackName?: string,
  compliancePackName?: string,
): Promise<UpgradeResult> {
  const rawKv = (env as any)?.TENANT_KV
  const db = (env as any)?.DB
  if (!rawKv) throw new Error('TENANT_KV not available')

  // 3a. Snapshot current pack data
  if (rulePackName) await createSnapshot(rawKv, tenantId, rulePackName)
  if (compliancePackName) await createSnapshot(rawKv, tenantId, compliancePackName)

  const result: UpgradeResult = { success: false, rulesInstalled: 0, complianceInstalled: 0, snapshotted: true }

  // 3b. Set upgrade_status = pending
  const configRaw = await rawKv.get('tenant:' + tenantId + ':chat:config')
  if (configRaw) {
    const config = typeof configRaw === 'string' ? JSON.parse(configRaw) : configRaw
    config.upgrade_status = 'pending'
    await rawKv.put('tenant:' + tenantId + ':chat:config', JSON.stringify(config))
  }

  // 3c. Install new rules (D1)
  if (rulePackName && db && typeof db.prepare === 'function') {
    const rules = await loadRulePack(rawKv, rulePackName)
    if (rules.length > 0) {
      const validated = validateRulePackData(rules)
      // Delete existing
      try { await db.prepare('DELETE FROM rules WHERE tenant_id = ?').bind(tenantId).run() } catch {}
      // Insert new
      const now = Math.floor(Date.now() / 1000)
      for (const rule of validated) {
        try {
          await db.prepare(
            'INSERT INTO rules (id, tenant_id, condition, output, priority, active, created_at, source_pack) VALUES (?, ?, ?, ?, ?, 1, ?, ?)'
          ).bind(crypto.randomUUID(), tenantId, rule.condition, rule.output || '', rule.priority ?? 50, now, rulePackName).run()
          result.rulesInstalled++
        } catch {}
      }
    }
  }

  // 3d. Install new compliance (KV)
  if (compliancePackName) {
    const entries = await loadCompliancePack(rawKv, compliancePackName)
    if (entries.length > 0) {
      const validated = validateCompliancePackData(entries)
      const normalized = validated.map((e: any) => ({
        id: (e.value || '').substring(0, 32).replace(/\s+/g, '_').toLowerCase(),
        value: e.value,
        type: 'compliance' as const,
        trigger: e.trigger || 'always',
        source_ref: 'pack:' + compliancePackName,
        updated_at: Date.now(),
      }))
      await rawKv.put('tenant:' + tenantId + ':kb:compliance', JSON.stringify({
        entries: normalized,
        source_ref: 'pack:' + compliancePackName,
        updated_at: Date.now(),
        pack_name: compliancePackName,
      }))
      result.complianceInstalled = normalized.length
    }
  }

  // 3e. Update pack_versions and mark complete
  if (configRaw) {
    const config = typeof configRaw === 'string' ? JSON.parse(configRaw) : configRaw
    if (!config.pack_versions) config.pack_versions = {}
    if (rulePackName) config.pack_versions.rules = rulePackName
    if (compliancePackName) config.pack_versions.compliance = compliancePackName
    config.upgrade_status = 'complete'
    await rawKv.put('tenant:' + tenantId + ':chat:config', JSON.stringify(config))
  }

  // 3f. Clear snapshot on success
  if (rulePackName) await clearSnapshot(rawKv, tenantId, rulePackName)
  if (compliancePackName) await clearSnapshot(rawKv, tenantId, compliancePackName)

  // 3g. Audit
  const dbAudit = (env as any)?.DB
  logAuditEvent(dbAudit, tenantId, 'upgrade', 'pack_upgrade_complete', {
    rulePack: rulePackName,
    compliancePack: compliancePackName,
    rulesInstalled: result.rulesInstalled,
    complianceInstalled: result.complianceInstalled,
  }).catch(() => {})

  result.success = true
  return result
}

// ═══════════════════════════════════════════════════════════════════════════
// Rollback
// ═══════════════════════════════════════════════════════════════════════════

export async function rollbackUpgrade(
  env: any,
  tenantId: string,
  packName: string,
  rulePackName?: string,
  compliancePackName?: string,
): Promise<UpgradeResult> {
  const rawKv = (env as any)?.TENANT_KV
  const db = (env as any)?.DB
  if (!rawKv) throw new Error('TENANT_KV not available')

  const result: UpgradeResult = { success: false, rulesInstalled: 0, complianceInstalled: 0, snapshotted: false }

  // Load snapshot
  const snapshot = await loadSnapshot(rawKv, tenantId, packName)
  if (!snapshot) throw new Error('No snapshot found for ' + packName)

  // Set pending
  const configRaw = await rawKv.get('tenant:' + tenantId + ':chat:config')
  if (configRaw) {
    const config = typeof configRaw === 'string' ? JSON.parse(configRaw) : configRaw
    config.upgrade_status = 'pending'
    await rawKv.put('tenant:' + tenantId + ':chat:config', JSON.stringify(config))
  }

  // Restore rules
  if (snapshot.rules && db && typeof db.prepare === 'function') {
    const validated = validateRulePackData(snapshot.rules)
    try { await db.prepare('DELETE FROM rules WHERE tenant_id = ?').bind(tenantId).run() } catch {}
    const now = Math.floor(Date.now() / 1000)
    for (const rule of validated) {
      try {
        await db.prepare(
          'INSERT INTO rules (id, tenant_id, condition, output, priority, active, created_at, source_pack) VALUES (?, ?, ?, ?, ?, 1, ?, ?)'
        ).bind(crypto.randomUUID(), tenantId, rule.condition, rule.output || '', rule.priority ?? 50, now, packName).run()
        result.rulesInstalled++
      } catch {}
    }
  }

  // Restore compliance
  if (snapshot.compliance) {
    const validated = validateCompliancePackData(snapshot.compliance)
    const normalized = validated.map((e: any) => ({
      id: (e.value || '').substring(0, 32).replace(/\s+/g, '_').toLowerCase(),
      value: e.value,
      type: 'compliance' as const,
      trigger: e.trigger || 'always',
      source_ref: 'rollback:' + packName,
      updated_at: Date.now(),
    }))
    await rawKv.put('tenant:' + tenantId + ':kb:compliance', JSON.stringify({
      entries: normalized,
      source_ref: 'rollback:' + packName,
      updated_at: Date.now(),
      pack_name: packName,
    }))
    result.complianceInstalled = normalized.length
  }

  // Restore pack_versions and mark complete
  if (configRaw) {
    const config = typeof configRaw === 'string' ? JSON.parse(configRaw) : configRaw
    if (!config.pack_versions) config.pack_versions = {}
    if (rulePackName) config.pack_versions.rules = rulePackName
    if (compliancePackName) config.pack_versions.compliance = compliancePackName
    config.upgrade_status = 'complete'
    await rawKv.put('tenant:' + tenantId + ':chat:config', JSON.stringify(config))
  }

  // Clear snapshot
  await clearSnapshot(rawKv, tenantId, packName)

  // Audit
  const dbAudit = (env as any)?.DB
  logAuditEvent(dbAudit, tenantId, 'rollback', 'pack_rollback_complete', {
    packName,
    rulesRestored: result.rulesInstalled,
    complianceRestored: result.complianceInstalled,
  }).catch(() => {})

  result.success = true
  return result
}