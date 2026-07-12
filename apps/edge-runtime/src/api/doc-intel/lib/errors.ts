/**
 * EdgeGDE — Document Intelligence Error Codes
 *
 * Centralised error responses for the doc-intel API.
 *
 * @packageDocumentation
 */

import type { ApiError } from './types'

/** Well-known error codes */
export const ErrorCode = {
  MISSING_TENANT: 'MISSING_TENANT',
  INVALID_TENANT: 'INVALID_TENANT',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  INVALID_FILE_TYPE: 'INVALID_FILE_TYPE',
  JOB_NOT_FOUND: 'JOB_NOT_FOUND',
  JOB_ALREADY_CLAIMED: 'JOB_ALREADY_CLAIMED',
  DOCUMENT_NOT_FOUND: 'DOCUMENT_NOT_FOUND',
  PROFILE_NOT_FOUND: 'PROFILE_NOT_FOUND',
  ENCRYPTION_FAILED: 'ENCRYPTION_FAILED',
  KEY_NOT_FOUND: 'KEY_NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
} as const

/** Map error code to HTTP status (as const for literal status types) */
const STATUS_MAP = {
  [ErrorCode.MISSING_TENANT]: 400,
  [ErrorCode.INVALID_TENANT]: 400,
  [ErrorCode.FILE_TOO_LARGE]: 413,
  [ErrorCode.INVALID_FILE_TYPE]: 400,
  [ErrorCode.JOB_NOT_FOUND]: 404,
  [ErrorCode.JOB_ALREADY_CLAIMED]: 409,
  [ErrorCode.DOCUMENT_NOT_FOUND]: 404,
  [ErrorCode.PROFILE_NOT_FOUND]: 404,
  [ErrorCode.ENCRYPTION_FAILED]: 500,
  [ErrorCode.KEY_NOT_FOUND]: 500,
  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.INVALID_INPUT]: 400,
} as const

/** Valid tenant values */
export const VALID_TENANTS = ['personal', 'afirmico'] as const

/** Hono JSON response helper — bypasses strict ContentfulStatusCode type */
function json(body: ApiError, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Valid HTTP status codes returned by error responses */
type ErrorStatus = 400 | 404 | 409 | 413 | 500

/**
 * Create a structured error response as a Hono-compatible Response.
 * Use: return c.json(err.body, err.status)
 * Where err is from errorResponse().
 */
export function errorBody(code: string, detail?: string): { body: ApiError; status: ErrorStatus } {
  return {
    status: (STATUS_MAP as Record<string, ErrorStatus>)[code] ?? 500,
    body: { error: code, code, detail },
  }
}

/**
 * Create a JSON error Response directly.
 * Use: return errorResponse('MISSING_TENANT')
 * Where you don't need to inspect the body first.
 */
export function errorResponse(code: string, detail?: string): Response {
  const { body, status } = errorBody(code, detail)
  return json(body, status)
}

/**
 * Resolve tenant from x-tenant header.
 * Returns the tenant string or an error Response.
 */
export function resolveTenant(c: { req: { header(name: string): string | undefined } }): 'personal' | 'afirmico' | Response {
  const tenantHeader = c.req.header('x-tenant')
  if (!tenantHeader) {
    return errorResponse(ErrorCode.MISSING_TENANT, 'x-tenant header is required')
  }

  const tenant = tenantHeader.toLowerCase()
  if (tenant !== 'personal' && tenant !== 'afirmico') {
    return errorResponse(ErrorCode.INVALID_TENANT, `Invalid tenant "${tenantHeader}". Must be "personal" or "afirmico".`)
  }

  return tenant
}

/**
 * Resolve tenant bindings (DB + R2) for a request.
 */
export function resolveBindings(
  env: Record<string, unknown>,
  tenant: 'personal' | 'afirmico',
): { db: import('@cloudflare/workers-types').D1Database; r2: import('@cloudflare/workers-types').R2Bucket } | Response {
  const dbKey = tenant === 'personal' ? 'D1_PERSONAL' : 'D1_AFIRMICO'
  const r2Key = tenant === 'personal' ? 'R2_PERSONAL' : 'R2_AFIRMICO'

  const db = env[dbKey]
  const r2 = env[r2Key]

  if (!db) return errorResponse(ErrorCode.INTERNAL_ERROR, `${dbKey} D1 binding not configured`)
  if (!r2) return errorResponse(ErrorCode.INTERNAL_ERROR, `${r2Key} R2 bucket not configured`)

  return { db: db as import('@cloudflare/workers-types').D1Database, r2: r2 as import('@cloudflare/workers-types').R2Bucket }
}
