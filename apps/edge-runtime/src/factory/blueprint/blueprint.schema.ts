/**
 * EdgeGDE — Blueprint & Pack Zod Schemas
 * Minimum viable types: field configs + pack references.
 * Maps directly to existing chat-config.ts and D1 rules table.
 */

import { z } from 'zod'

// ═══════════════════════════════════════════════════════════════════════════
// Field definition (mirrors ChatFieldDefSchema in chat-config.ts)
// ═══════════════════════════════════════════════════════════════════════════

export const BlueprintFieldSchema = z.object({
  fieldName: z.string().min(1),
  label: z.string().min(1),
  fieldType: z.enum(['text', 'number', 'select', 'email', 'phone']).default('text'),
  options: z.array(z.string()).optional(),
  prompt: z.string().optional(),
  validation: z.object({
    required: z.boolean().default(true),
    min: z.number().optional(),
    max: z.number().optional(),
  }).default({ required: true }),
  placeholder: z.string().optional(),
})

// ═══════════════════════════════════════════════════════════════════════════
// Pack references (what packs to install for this blueprint)
// ═══════════════════════════════════════════════════════════════════════════

export const PackRefSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
})

/** BlueprintPackRefSchema. */
export const BlueprintPackRefSchema = z.object({
  rule_pack: PackRefSchema.optional(),
  compliance_pack: PackRefSchema.optional(),
})

// ═══════════════════════════════════════════════════════════════════════════
// Blueprint — the template for tenant configuration
// ═══════════════════════════════════════════════════════════════════════════

export const BlueprintSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  fields: z.array(BlueprintFieldSchema).min(1),
  priorityOrder: z.array(z.string()).min(1),
  packs: BlueprintPackRefSchema.default({}),
})

export type Blueprint = z.infer<typeof BlueprintSchema>

// ═══════════════════════════════════════════════════════════════════════════
// Pack definition — versioned data bundles stored in KV
// ═══════════════════════════════════════════════════════════════════════════

export const RuleRecordSchema = z.object({
  condition: z.string().min(1),
  output: z.string().min(1),
  priority: z.number().int().positive().default(50),
})

/** ComplianceEntrySchema. */
export const ComplianceEntrySchema = z.object({
  value: z.string().min(1),
  type: z.literal('compliance').default('compliance'),
  trigger: z.string().default('always'),
})

/** RulePackSchema. */
export const RulePackSchema = z.object({
  name: z.string().min(1),
  rules: z.array(RuleRecordSchema),
})

/** CompliancePackSchema. */
export const CompliancePackSchema = z.object({
  name: z.string().min(1),
  entries: z.array(ComplianceEntrySchema),
})

export type RuleRecord = z.infer<typeof RuleRecordSchema>
export type ComplianceEntry = z.infer<typeof ComplianceEntrySchema>
export type RulePack = z.infer<typeof RulePackSchema>
export type CompliancePack = z.infer<typeof CompliancePackSchema>
export type PackRef = z.infer<typeof PackRefSchema>