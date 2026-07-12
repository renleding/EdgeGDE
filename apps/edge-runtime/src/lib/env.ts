/**
 * Typed Cloudflare Workers environment bindings for EdgeGDE.
 *
 * Usage — cast once at the entry point, then use typed access everywhere:
 *   import { type Env, safeEnv } from '../lib/env'
 *   const env = safeEnv(c)   // or safeEnv(rawEnv)
 *
 * This is the SINGLE source of truth for binding types.
 * All `as any` casts on env access in the codebase should route through here.
 */

import type { D1Database, KVNamespace, R2Bucket, DurableObjectNamespace, Queue } from '@cloudflare/workers-types'

export interface Env {
  // KV Namespaces
  TENANT_KV: KVNamespace
  ARTIFACT_KV: KVNamespace
  TELEMETRY_KV: KVNamespace

  // D1 Database (legacy)
  DB: D1Database

  // Document Intelligence D1 Databases (tenant-separated)
  D1_PERSONAL?: D1Database
  D1_AFIRMICO?: D1Database

  // R2 Buckets
  VAULT_BUCKET: R2Bucket

  // Document Intelligence R2 Buckets (tenant-separated)
  R2_PERSONAL?: R2Bucket
  R2_AFIRMICO?: R2Bucket

  // Durable Objects
  RATE_LIMITER: DurableObjectNamespace
  AUDIT_LEDGER: DurableObjectNamespace
  CHAT_SESSION: DurableObjectNamespace
  CANVAS_SESSION: DurableObjectNamespace

  // Queues
  LEAD_SCORING_QUEUE: Queue
  FORECASTING_QUEUE: Queue

  // Secrets
  JWT_SECRET?: string
  RESEND_API_KEY?: string
  HMAC_KEY?: string
  ADMIN_API_TOKEN?: string
  ADMIN_TOKEN?: string  // Legacy name; fallback if ADMIN_API_TOKEN unset
  OPENROUTER_API_KEY?: string
  TURNSTILE_SECRET_KEY?: string
  MASTER_WRAP_KEY?: string  // Document Intelligence key-wrapping master key

  // Text vars
  OTEL_EXPORTER_OTLP_ENDPOINT?: string
  OTEL_SERVICE_NAME?: string
  WORKER_VERSION?: string
}

/**
 * Cast a raw env object to the typed Env interface.
 * This is the ONLY place `as any` should appear for environment access.
 * All consuming code gets full type safety.
 */
export function safeEnv(raw: Record<string, unknown>): Env {
  return raw as unknown as Env
}

/**
 * Convenience: get typed env from a Hono context's `c.env`.
 * Accepts both typed Context and the raw env object directly.
 */
export function envFromContext(c: { env?: unknown }): Env {
  return safeEnv((c.env || {}) as Record<string, unknown>)
}
