/**
 * EdgeGDE — Zod Schema Library
 * Phase 28: Schema-first runtime validation for all edge runtime routes.
 * Validates request bodies and query params at the route boundary.
 *
 * @packageDocumentation
 */

import { z } from 'zod'

// ═══════════════════════════════════════════════════════════════════════════
// Route Body Schemas
// ═══════════════════════════════════════════════════════════════════════════

/** POST /api/v1/mcp/deploy */
export const McpDeploySchema = z.object({
  tenant_id: z.string().min(1).max(64),
  layout_payload: z.string().min(1),
  version_note: z.string().optional(),
  environment: z.enum(['staging', 'production']).optional(),
})

/** POST /api/v1/mcp/promote */
export const PromoteSchema = z.object({
  tenant_id: z.string().min(1).max(64),
  version: z.string().optional(),
})

/** POST /api/v1/mcp/rollback */
export const RollbackSchema = z.object({
  tenant_id: z.string().min(1).max(64),
  version: z.string().min(1),
})

// ═══════════════════════════════════════════════════════════════════════════
// Query Param Schemas
// ═══════════════════════════════════════════════════════════════════════════

/** GET /api/telemetry */
export const TelemetryQuerySchema = z.object({
  key: z.string().min(1).max(32),
})

/** GET / (root layout render) */
export const TenantQuerySchema = z.object({
  tenant: z.string().min(1).max(64),
  env: z.enum(['staging', 'production']).default('staging'),
})

/** GET /api/dashboard/kv */
export const DashboardQuerySchema = z.object({
  tenant: z.string().min(1).max(64).optional(),
})

// ═══════════════════════════════════════════════════════════════════════════
// MCP Diff Query Schema
// ═══════════════════════════════════════════════════════════════════════════

/** GET /api/v1/mcp/diff */
export const DiffQuerySchema = z.object({
  tenant_id: z.string().min(1).max(64),
  v1: z.string().min(1),
  v2: z.string().min(1),
})

// ═══════════════════════════════════════════════════════════════════════════
// Form Definition Types & Dynamic Schema Builder (Phase 29)
// ═══════════════════════════════════════════════════════════════════════════

/** Field-level validation rules derived from OpenPencil FormField */
export interface FieldValidation {
  required?: boolean
  min?: number
  max?: number
  step?: number
  minLength?: number
  maxLength?: number
  pattern?: string
}

/** A single form field with its Zod mapping */
export interface FormFieldDef {
  fieldName: string
  label: string
  fieldType: 'text' | 'number' | 'select' | 'range' | 'email' | 'tel' | 'textarea'
  validation: FieldValidation
  options?: string[]
  placeholder?: string
}

/** A complete form definition — one form = one Hono route */
export interface FormDefinition {
  id: string
  label: string
  endpoint: string
  fields: FormFieldDef[]
  submitLabel: string
  resultTargetId: string
}

/**
 * Build a Zod schema dynamically from a FormFieldDef array.
 * SSOT — all form schemas MUST be generated this way, never hand-typed.
 */
export function buildFormSchema(fields: FormFieldDef[]): z.ZodObject<any> {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const field of fields) {
    let zod: z.ZodTypeAny

    if (field.fieldType === 'number' || field.fieldType === 'range') {
      let base: any = z.coerce.number().refine((n) => !isNaN(n), { message: `${field.label} must be a valid number` })
      if (field.validation.min != null) base = base.refine((n: any) => n >= field.validation.min!, { message: `Minimum ${field.label} is ${field.validation.min}` })
      if (field.validation.max != null) base = base.refine((n: any) => n <= field.validation.max!, { message: `Maximum ${field.label} is ${field.validation.max}` })
      zod = base
    } else if (field.fieldType === 'email') {
      zod = z.string().email() as any
    } else {
      let base: any = z.string()
      if (field.validation.minLength != null) base = base.refine((s: any) => (s as string).length >= field.validation.minLength!, { message: `Minimum length is ${field.validation.minLength}` })
      if (field.validation.maxLength != null) base = base.refine((s: any) => (s as string).length <= field.validation.maxLength!, { message: `Maximum length is ${field.validation.maxLength}` })
      if (field.validation.pattern) base = base.refine((s: any) => new RegExp(field.validation.pattern!).test(s as string), { message: `Invalid format for ${field.label}` })
      zod = base
    }

    if (field.validation.required) {
      if (field.fieldType !== 'number' && field.fieldType !== 'range') {
        zod = (zod as any).min(1, `${field.label} is required`)
      }
    } else {
      zod = zod.optional().default(field.fieldType === 'number' || field.fieldType === 'range' ? 0 : '')
    }

    shape[field.fieldName] = zod
  }
  return z.object(shape).strict()
}

export type FormSchema = z.infer<ReturnType<typeof buildFormSchema>>

// ═══════════════════════════════════════════════════════════════════════════
// Validation Error
// ═══════════════════════════════════════════════════════════════════════════

export class ValidationError extends Error {
  constructor(public zodError: z.ZodError) {
    super('Validation failed')
    this.name = 'ValidationError'
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Validation Helper
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validates data against a Zod schema.
 * Throws ValidationError on failure — catch and return 400.
 */
export function validateOrThrow<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    throw new ValidationError(result.error)
  }
  return result.data
}

// ═══════════════════════════════════════════════════════════════════════════
// Error Response Builder
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build a structured 400 error response from a ValidationError.
 */
export function validationErrorResponse(error: ValidationError) {
  return {
    status: 400 as const,
    body: {
      error: 'Validation failed',
      details: error.zodError.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    },
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Inferred TypeScript Types
// ═══════════════════════════════════════════════════════════════════════════

export type McpDeployInput = z.infer<typeof McpDeploySchema>
export type PromoteInput = z.infer<typeof PromoteSchema>
export type RollbackInput = z.infer<typeof RollbackSchema>
export type TelemetryQuery = z.infer<typeof TelemetryQuerySchema>
export type TenantQuery = z.infer<typeof TenantQuerySchema>
export type DashboardQuery = z.infer<typeof DashboardQuerySchema>
export type DiffQuery = z.infer<typeof DiffQuerySchema>
