import { z } from 'zod'

const ChatFieldDefSchema = z.object({
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
}).passthrough()

const ChatRuleSchema = z.object({
  if: z.string(),
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

/** ChatConfigSchema. */
export const ChatConfigSchema = z.object({
  objective: z.string().min(1),
  fields: z.array(ChatFieldDefSchema).min(1),
  priorityOrder: z.array(z.string()).min(1),
  rules: z.array(ChatRuleSchema).default([]),
  knowledgeBase: KnowledgeBaseSchema.default({ topics: [] }),
  ui: UiConfigSchema.optional(),
  llmFallback: z.boolean().default(true),
})

export type ChatConfig = z.infer<typeof ChatConfigSchema>

export const FALLBACK_CONFIG: ChatConfig = {
  objective: 'Collect contact information',
  fields: [
    { fieldName: 'fullName', label: 'Full Name', fieldType: 'text', validation: { required: true }, placeholder: 'Your full name' },
    { fieldName: 'email', label: 'Email Address', fieldType: 'email', validation: { required: true }, placeholder: 'your@email.com' },
    { fieldName: 'phone', label: 'Phone Number', fieldType: 'phone', validation: { required: true }, placeholder: '0400000000' },
    { fieldName: 'employmentStatus', label: 'Employment Status', fieldType: 'select', options: ['Employed', 'Self-Employed', 'PAYG', 'Retired'], validation: { required: true } },
    { fieldName: 'annualIncome', label: 'Annual Income', fieldType: 'number', validation: { required: true, min: 0 } },
    { fieldName: 'loanAmount', label: 'Loan Amount', fieldType: 'number', validation: { required: true, min: 1 } },
    { fieldName: 'propertyValue', label: 'Property Value', fieldType: 'number', validation: { required: true, min: 1 } },
    { fieldName: 'propertyType', label: 'Property Type', fieldType: 'select', options: ['Owner-occupied', 'Investment', 'Refinance'], validation: { required: true } },
    { fieldName: 'dependants', label: 'Dependants', fieldType: 'select', options: ['Yes', 'No'], validation: { required: true } },
    { fieldName: 'existingMortgage', label: 'Existing Mortgage', fieldType: 'select', options: ['Yes', 'No'], validation: { required: true } },
  ],
  priorityOrder: ['fullName', 'email', 'phone', 'employmentStatus', 'annualIncome', 'loanAmount', 'propertyValue', 'propertyType', 'dependants', 'existingMortgage'],
  rules: [],
  knowledgeBase: { topics: [] },
  ui: { title: 'EdgeGDE Chat', greeting: "Welcome! Let's get started.", colorAccent: '#58a6ff' },
  llmFallback: true,
}

export async function loadChatConfig(kv: any, tenantId: string): Promise<ChatConfig> {
  try {
    const raw = await kv.get(`tenant:${tenantId}:chat:config`, 'json')
    if (!raw) {
      console.warn('[chat-config] Config missing for', tenantId, '— using fallback')
      return FALLBACK_CONFIG
    }
    const parsed = ChatConfigSchema.parse(raw)
    const rawObj = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (rawObj && rawObj.upgrade_status === 'pending') {
      console.warn('[chat-config] Upgrade pending for', tenantId, '— blocking')
      throw new Error('System update in progress. Please try again shortly.')
    }
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
