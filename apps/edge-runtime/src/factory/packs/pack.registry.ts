/**
 * EdgeGDE — Pack Registry
 * Lists available rule packs and compliance packs from KV.
 * Packs are stored as JSON blobs (not code — no dynamic imports).
 */

import { z } from 'zod'

export interface PackMeta {
  name: string
  type: 'rules' | 'compliance'
  entryCount: number
  description?: string
}

// ═══════════════════════════════════════════════════════════════════════════
// Validation schemas for pack content
// ═══════════════════════════════════════════════════════════════════════════

export const RulePackEntrySchema = z.object({
  condition: z.string().min(1),
  output: z.string().min(1),
  priority: z.number().int().positive().default(50),
})

/** CompliancePackEntrySchema. */
export const CompliancePackEntrySchema = z.object({
  value: z.string().min(1),
  trigger: z.string().default('always'),
})

export function validateRulePackData(data: unknown[]): Array<z.infer<typeof RulePackEntrySchema>> {
  return data.map((entry) => RulePackEntrySchema.parse(entry))
}

export function validateCompliancePackData(data: unknown[]): Array<z.infer<typeof CompliancePackEntrySchema>> {
  return data.map((entry) => CompliancePackEntrySchema.parse(entry))
}

// ═══════════════════════════════════════════════════════════════════════════
// List available packs
// ═══════════════════════════════════════════════════════════════════════════

export async function listRulePacks(kv: unknown, ctx?: unknown): Promise<PackMeta[]> {
  const kvLike = kv as { get: (key: string) => Promise<unknown> }
  try {
    const raw = await kvLike.get('pack:index:rules')
    if (!raw) return []
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(parsed) ? (parsed as PackMeta[]) : []
  } catch { return [] }
}

export async function listCompliancePacks(kv: unknown, ctx?: unknown): Promise<PackMeta[]> {
  const kvLike = kv as { get: (key: string) => Promise<unknown> }
  try {
    const raw = await kvLike.get('pack:index:compliance')
    if (!raw) return []
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(parsed) ? (parsed as PackMeta[]) : []
  } catch { return [] }
}

export async function listAllPacks(kv: unknown): Promise<PackMeta[]> {
  const rules = await listRulePacks(kv)
  const compliance = await listCompliancePacks(kv)
  return [...rules, ...compliance]
}

// ═══════════════════════════════════════════════════════════════════════════
// Load pack data (the actual rules or compliance entries)
// ═══════════════════════════════════════════════════════════════════════════

export async function loadRulePack(kv: unknown, name: string, ctx?: unknown): Promise<Array<z.infer<typeof RulePackEntrySchema>>> {
  const kvLike = kv as { get: (key: string) => Promise<unknown> }
  try {
    const raw = await kvLike.get(`pack:${name}:rules`)
    if (!raw) return []
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => RulePackEntrySchema.parse(entry))
    }
    return ((parsed as { rules?: unknown[] }).rules || []).map((entry) => RulePackEntrySchema.parse(entry))
  } catch { return [] }
}

export async function loadCompliancePack(kv: unknown, name: string, ctx?: unknown): Promise<Array<z.infer<typeof CompliancePackEntrySchema>>> {
  const kvLike = kv as { get: (key: string) => Promise<unknown> }
  try {
    const raw = await kvLike.get(`pack:${name}:compliance`)
    if (!raw) return []
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => CompliancePackEntrySchema.parse(entry))
    }
    return ((parsed as { entries?: unknown[] }).entries || []).map((entry) => CompliancePackEntrySchema.parse(entry))
  } catch { return [] }
}