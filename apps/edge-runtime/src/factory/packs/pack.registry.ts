/**
 * EdgeGDE — Pack Registry
 * Lists available rule packs and compliance packs from KV.
 * Packs are stored as JSON blobs (not code — no dynamic imports).
 */

import { guardKV } from '../../lib/kv'

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

export const CompliancePackEntrySchema = z.object({
  value: z.string().min(1),
  trigger: z.string().default('always'),
})

export function validateRulePackData(data: any[]): any[] {
  return data.map((entry: any) => RulePackEntrySchema.parse(entry))
}

export function validateCompliancePackData(data: any[]): any[] {
  return data.map((entry: any) => CompliancePackEntrySchema.parse(entry))
}

// ═══════════════════════════════════════════════════════════════════════════
// List available packs
// ═══════════════════════════════════════════════════════════════════════════

export async function listRulePacks(kv: any, ctx?: any): Promise<PackMeta[]> {
  try {
    const raw = await (ctx ? kv.get('pack:index:rules', ctx) : kv.get('pack:index:rules'))
    if (!raw) return []
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch { return [] }
}

export async function listCompliancePacks(kv: any, ctx?: any): Promise<PackMeta[]> {
  try {
    const raw = await (ctx ? kv.get('pack:index:compliance', ctx) : kv.get('pack:index:compliance'))
    if (!raw) return []
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch { return [] }
}

export async function listAllPacks(kv: any): Promise<PackMeta[]> {
  const rules = await listRulePacks(kv)
  const compliance = await listCompliancePacks(kv)
  return [...rules, ...compliance]
}

// ═══════════════════════════════════════════════════════════════════════════
// Load pack data (the actual rules or compliance entries)
// ═══════════════════════════════════════════════════════════════════════════

export async function loadRulePack(kv: any, name: string, ctx?: any): Promise<any[]> {
  try {
    const raw = await (ctx ? kv.get(`pack:${name}:rules`, ctx) : kv.get(`pack:${name}:rules`))
    if (!raw) return []
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(parsed) ? parsed : (parsed.rules || [])
  } catch { return [] }
}

export async function loadCompliancePack(kv: any, name: string, ctx?: any): Promise<any[]> {
  try {
    const raw = await (ctx ? kv.get(`pack:${name}:compliance`, ctx) : kv.get(`pack:${name}:compliance`))
    if (!raw) return []
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(parsed) ? parsed : (parsed.entries || [])
  } catch { return [] }
}