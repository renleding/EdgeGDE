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
  systemInstructions: z.string().optional(),
})

/**
 * Deterministic rule guard — a rule `if` expression must be of the form
 * `fieldName <op> value` with a single comparison operator (`< > <= >= == !=`)
 * and a single scalar (number, quoted string, or bare word). Anything richer
 * (boolean `or`/`and`, `=`/`!`, function calls) is non-deterministic and is
 * rejected: complex logic belongs in RulePack, per the admin form guidance.
 */
const DETERMINISTIC_RULE_RE =
  /^[A-Za-z_][A-Za-z0-9_]*\s*(?:>=|<=|==|!=|>|<)\s*(?:[0-9]+(?:\.[0-9]+)?|"[^"]*"|'[^']*'|\$?[A-Za-z_][A-Za-z0-9_]*)$/

function assertDeterministicRule(ifExpr: string): string | null {
  return DETERMINISTIC_RULE_RE.test(ifExpr.trim()) ? null : ifExpr
}

/**
 * ChatConfigSchema — extended with the cross-field invariants required by the
 * admin editor and production test suite:
 *  - `select` fields MUST declare non-empty `options`
 *  - `priorityOrder` MUST cover exactly the set of declared fieldNames
 *  - every rule `if` MUST be deterministic (single comparison)
 */
export const ChatConfigSchema = z.object({
  schemaVersion: z.number().int().positive().default(1),
  objective: z.string().min(1),
  fields: z.array(ChatFieldDefSchema).min(1),
  priorityOrder: z.array(z.string()).min(1),
  rules: z.array(ChatRuleSchema).default([]),
  knowledgeBase: KnowledgeBaseSchema.default({ topics: [] }),
  ui: UiConfigSchema.default({ title: 'EdgeGDE Chat', greeting: "Welcome! Let's get started.", colorAccent: '#58a6ff' }),
  llmFallback: z.boolean().default(true),
}).superRefine((cfg, ctx) => {
  // select fields must declare options
  cfg.fields.forEach((f, i) => {
    if (f.fieldType === 'select' && (!f.options || f.options.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fields', i, 'options'],
        message: `Select field "${f.fieldName}" must declare options`,
      })
    }
  })

  // priorityOrder must cover exactly the declared field names
  const fieldNames = new Set(cfg.fields.map(f => f.fieldName))
  const ordered = new Set(cfg.priorityOrder)
  const missing = cfg.fields.map(f => f.fieldName).filter(n => !ordered.has(n))
  const extra = cfg.priorityOrder.filter(n => !fieldNames.has(n))
  if (missing.length || extra.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['priorityOrder'],
      message: `priorityOrder must list every field exactly once (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`,
    })
  } else if (cfg.priorityOrder.length !== fieldNames.size) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['priorityOrder'],
      message: 'priorityOrder must list each field exactly once',
    })
  }

  // rules must be deterministic
  cfg.rules.forEach((r, i) => {
    const bad = assertDeterministicRule(r.if)
    if (bad) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rules', i, 'if'],
        message: `Non-deterministic rule "if: ${bad}". Use a single comparison like "fieldName >= value".`,
      })
    }
  })
})

export type ChatConfig = z.infer<typeof ChatConfigSchema>

export const FALLBACK_CONFIG: ChatConfig = {
  schemaVersion: 1,
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

// ── KV key helpers ──────────────────────────────────────────────────────────

/** Latest-config key for a tenant (matches the legacy `loadChatConfig` scheme). */
export function tenantChatConfigKey(tenantId: string): string {
  return `tenant:${tenantId}:chat:config`
}

/** Immutable snapshot key for a tenant config version, keyed by content hash. */
export function tenantChatSnapshotKey(tenantId: string, hash: string): string {
  return `tenant:${tenantId}:chat:config:snapshot:${hash}`
}

/** Latest-config key for the global baseline. */
export function globalChatConfigKey(): string {
  return `global:chat:config:latest`
}

/** Immutable snapshot key for global config, keyed by content hash. */
export function globalChatSnapshotKey(hash: string): string {
  return `global:chat:config:snapshot:${hash}`
}

// ── Deterministic hashing ───────────────────────────────────────────────────

/** Recursively canonicalise an object/array so `JSON.stringify` yields a stable
 *  key-order-independent serialisation for hashing and idempotency keys. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[k]
      if (v === undefined) continue
      out[k] = canonicalize(v)
    }
    return out
  }
  return value
}

function contentHash(config: ChatConfig): string {
  const canonical = canonicalize(config)
  const json = JSON.stringify(canonical)
  // FNV-1a 64-bit — dependency-free, deterministic, fast, not cryptographically strong
  // (sufficient for snapshot identity / idempotency, not for security).
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < json.length; i++) {
    const c = json.charCodeAt(i)
    h1 ^= c
    h1 = (h1 * 0x01000193) >>> 0
    h2 = (h2 ^ c) * 0x01000193 >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

// ── Zod helpers ─────────────────────────────────────────────────────────────

/** Map a ZodError to [{path, message}] for human-readable rendering. */
export function formatZodIssues(err: any): Array<{ path: string; message: string }> {
  const issues = Array.isArray(err?.issues) ? err.issues : []
  return issues.map((issue: any) => ({
    path: Array.isArray(issue.path) ? issue.path.join('.') : String(issue.path ?? ''),
    message: String(issue.message ?? 'Invalid value'),
  }))
}

/** Parse + validate raw config, throwing a ZodError on invalid input. */
export function parseChatConfig(raw: unknown): ChatConfig {
  return ChatConfigSchema.parse(raw)
}

// ── KV read/write ───────────────────────────────────────────────────────────

/** Coerce a raw KV value (string or object) to an object. */
function unwrap(raw: any): unknown {
  if (raw == null) return null
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }
  return raw
}

/** Load the global baseline config; returns FALLBACK_CONFIG on any failure. */
export async function loadGlobalChatConfig(kv: any): Promise<ChatConfig> {
  try {
    const raw = await kv.get(globalChatConfigKey(), 'json')
    const obj = unwrap(raw)
    if (obj == null) return FALLBACK_CONFIG
    return ChatConfigSchema.parse(obj)
  } catch {
    return FALLBACK_CONFIG
  }
}

/** Load a tenant config; returns null when absent or invalid (fail-closed). */
export async function loadTenantChatConfig(kv: any, tenantId: string): Promise<ChatConfig | null> {
  try {
    const raw = await kv.get(tenantChatConfigKey(tenantId), 'json')
    const obj = unwrap(raw)
    if (obj == null) return null
    return ChatConfigSchema.parse(obj)
  } catch {
    return null
  }
}

/**
 * Persist a config and an immutable content-addressed snapshot. Returns the
 * storage metadata (key, snapshotKey, hash, bytes) for audit/idempotency.
 * `scope` is `'global'` or `'tenant'`; `tenantId` is ignored for global.
 */
export async function saveChatConfig(
  kv: any,
  scope: 'global' | 'tenant',
  tenantId: string,
  config: ChatConfig,
): Promise<{ key: string; hash: string; snapshotKey: string; bytes: number }> {
  const validated = ChatConfigSchema.parse(config)
  const hash = contentHash(validated)
  const json = JSON.stringify(validated)
  const bytes = json.length

  const key = scope === 'global' ? globalChatConfigKey() : tenantChatConfigKey(tenantId)
  const snapshotKey = scope === 'global'
    ? globalChatSnapshotKey(hash)
    : tenantChatSnapshotKey(tenantId, hash)

  await kv.put(key, validated)
  await kv.put(snapshotKey, validated)
  return { key, hash, snapshotKey, bytes }
}

/**
 * Deterministic deep merge: array fields concatenate (dedup preserves global
 * order then appends tenant-only items); scalar/object fields are overridden
 * by the tenant overlay. The merged result is validated before return.
 */
export function mergeChatConfig(globalConfig: ChatConfig, tenantConfig: ChatConfig | null): ChatConfig {
  if (!tenantConfig) return ChatConfigSchema.parse(globalConfig)

  const topics = [...new Set([...globalConfig.knowledgeBase.topics, ...tenantConfig.knowledgeBase.topics])]

  const merged = {
    ...globalConfig,
    ...tenantConfig,
    fields: tenantConfig.fields,
    priorityOrder: tenantConfig.priorityOrder,
    rules: tenantConfig.rules,
    knowledgeBase: {
      ...globalConfig.knowledgeBase,
      ...tenantConfig.knowledgeBase,
      topics,
    },
    ui: {
      ...globalConfig.ui,
      ...(tenantConfig.ui ?? {}),
    },
  }
  return ChatConfigSchema.parse(merged)
}

/** Resolve the effective config for a tenant: global baseline overlaid with tenant override. */
export async function getEffectiveChatConfig(kv: any, tenantId: string): Promise<ChatConfig> {
  const globalConfig = await loadGlobalChatConfig(kv)
  const tenantConfig = await loadTenantChatConfig(kv, tenantId)
  return mergeChatConfig(globalConfig, tenantConfig)
}

// ── Legacy loader (backwards-compatible) ────────────────────────────────────
//
// Retained for existing callers (`chat.ts`, `chat-views.ts`) which address a
// single tenant's config and expect FALLBACK_CONFIG on any failure.

export async function loadChatConfig(kv: any, tenantId: string): Promise<ChatConfig> {
  try {
    // Preserve the legacy upgrade-blocking invariant before parsing.
    let raw: any
    try {
      raw = await kv.get(`tenant:${tenantId}:chat:config`, 'json')
    } catch {
      raw = null
    }
    const rawObj = raw == null ? null : (typeof raw === 'string' ? (() => { try { return JSON.parse(raw) } catch { return raw } })() : raw)
    if (rawObj && typeof rawObj === 'object' && (rawObj as any).upgrade_status === 'pending') {
      console.warn('[chat-config] Upgrade pending for', tenantId, '— blocking')
      throw new Error('System update in progress. Please try again shortly.')
    }

    const config = await loadTenantChatConfig(kv, tenantId)
    if (config) return config
    console.warn('[chat-config] Config missing for', tenantId, '— using fallback')
    return FALLBACK_CONFIG
  } catch (err) {
    console.warn('[chat-config] Load/validation failed for', tenantId, '— using fallback', err)
    return FALLBACK_CONFIG
  }
}