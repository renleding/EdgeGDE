/**
 * EdgeGDE — Chat Config Loader
 * Loads tenant chat config from TENANT_KV. Validates against Zod schema.
 * Single read per request — stable snapshot.
 *
 * @packageDocumentation
 */

import { z } from 'zod'

// ═══════════════════════════════════════════════════════════════════════════
// Zod schema
// ═══════════════════════════════════════════════════════════════════════════

const ChatFieldDefSchema = z.object({
  fieldName: z.string().min(1),
  label: z.string().min(1),
  fieldType: z.enum(['text', 'number', 'select', 'email', 'phone']).default('text'),
  options: z.array(z.string()).optional(),
  validation: z.object({
    required: z.boolean().default(true),
    min: z.number().optional(),
    max: z.number().optional(),
  }).default({ required: true }),
  placeholder: z.string().optional(),
})

const ChatRuleSchema = z.object({
  if: z.string(),  // e.g. "annualIncome < 30000"
  set: z.object({
    field: z.string(),
    value: z.union([z.string(), z.number(), z.boolean()]),
  }),
})

const UiConfigSchema = z.object({
  title: z.string().default('EdgeGDE Chat'),
  greeting: z.string().default("Welcome! Let's get started."),
  colorAccent: z.string().default('#58a6ff'),
})

const KnowledgeBaseSchema = z.object({
  topics: z.array(z.string()).default([]),
})

export const ChatConfigSchema = z.object({
  objective: z.string().min(1),
  fields: z.array(ChatFieldDefSchema).min(1),
  priorityOrder: z.array(z.string()).min(1),
  rules: z.array(ChatRuleSchema).default([]),
  knowledgeBase: KnowledgeBaseSchema.default({ topics: [] }),
  ui: UiConfigSchema.optional(),
})

export type ChatConfig = z.infer<typeof ChatConfigSchema>

// ═══════════════════════════════════════════════════════════════════════════
// Fallback config (used when KV key is missing or invalid)
// ═══════════════════════════════════════════════════════════════════════════

export const FALLBACK_CONFIG: ChatConfig = {
  objective: 'Collect contact information',
  fields: [
    { fieldName: 'fullName', label: 'Full Name', fieldType: 'text', validation: { required: true }, placeholder: 'Your full name' },
    { fieldName: 'email', label: 'Email Address', fieldType: 'email', validation: { required: true }, placeholder: 'your@email.com' },
  ],
  priorityOrder: ['fullName', 'email'],
  rules: [],
  knowledgeBase: { topics: [] },
  ui: { title: 'EdgeGDE Chat', greeting: "Welcome! Let's get started.", colorAccent: '#58a6ff' },
}

// ═══════════════════════════════════════════════════════════════════════════
// Loader
// ═══════════════════════════════════════════════════════════════════════════

export async function loadChatConfig(kv: any, tenantId: string): Promise<ChatConfig> {
  try {
    const raw = await kv.get(`tenant:${tenantId}:chat:config`, 'json')
    if (!raw) {
      console.warn('[chat-config] Config missing for', tenantId, '— using fallback')
      return FALLBACK_CONFIG
    }
    const parsed = ChatConfigSchema.parse(raw)

    // Hard gate: if upgrade is mid-flight, block execution
    const rawObj = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (rawObj && rawObj.upgrade_status === 'pending') {
      console.warn('[chat-config] Upgrade pending for', tenantId, '— blocking')
      throw new Error('System update in progress. Please try again shortly.')
    }

    // Validate priorityOrder matches fields
    const fieldNames = new Set(parsed.fields.map(f => f.fieldName))
    for (const p of parsed.priorityOrder) {
      if (!fieldNames.has(p)) {
        console.warn('[chat-config] priorityOrder includes unknown field:', p, '— using fallback')
        return FALLBACK_CONFIG
      }
    }

    return parsed
  } catch (err) {
    console.warn('[chat-config] Load/validation failed for', tenantId, '— using fallback', err)
    return FALLBACK_CONFIG
  }
}
