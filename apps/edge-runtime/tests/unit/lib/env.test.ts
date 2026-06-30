import { describe, it, expect } from 'vitest'
import { safeEnv, envFromContext } from '../../../src/lib/env'

describe('safeEnv', () => {
  it('returns the same object reference cast as Env', () => {
    const raw: Record<string, unknown> = {
      TENANT_KV: { get: () => {} },
      DB: { prepare: () => {} },
      VAULT_BUCKET: { get: () => {} },
      RATE_LIMITER: { newUniqueId: () => {} },
      AUDIT_LEDGER: { idFromName: () => {} },
      CHAT_SESSION: { idFromName: () => {} },
      CANVAS_SESSION: { idFromName: () => {} },
      LEAD_SCORING_QUEUE: { send: () => {} },
      FORECASTING_QUEUE: { send: () => {} },
    }
    const env = safeEnv(raw)
    // safeEnv is a pure cast — same reference
    expect(env).toBe(raw as unknown as typeof env)
    expect(env.TENANT_KV).toBeDefined()
    expect(env.DB).toBeDefined()
  })

  it('exposes required bindings with full shape', () => {
    const raw: Record<string, unknown> = {
      TENANT_KV: { get: async () => 'x' },
      ARTIFACT_KV: { get: async () => 'y' },
      TELEMETRY_KV: { get: async () => 'z' },
      DB: { prepare: (_sql: string) => {} },
      VAULT_BUCKET: { get: (_key: string) => {} },
      RATE_LIMITER: { newUniqueId: () => ({ toString: () => 'id' }) },
      AUDIT_LEDGER: { idFromName: (_name: string) => {} },
      CHAT_SESSION: { idFromName: (_name: string) => {} },
      CANVAS_SESSION: { idFromName: (_name: string) => {} },
      LEAD_SCORING_QUEUE: { send: (_msg: unknown) => {} },
      FORECASTING_QUEUE: { send: (_msg: unknown) => {} },
      // Optional secrets
      JWT_SECRET: 'my-secret',
      RESEND_API_KEY: 'key-123',
      HMAC_KEY: 'hmac-val',
      ADMIN_API_TOKEN: 'admin-token',
      OPENROUTER_API_KEY: 'sk-or-v1-xxx',
      TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
      // Text vars
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otel.example.com',
      OTEL_SERVICE_NAME: 'edgegde-runtime',
      WORKER_VERSION: '0.9.5-dev',
    }
    const env = safeEnv(raw)
    // Verify required bindings
    expect(env.TENANT_KV).toBeDefined()
    expect(env.ARTIFACT_KV).toBeDefined()
    expect(env.TELEMETRY_KV).toBeDefined()
    expect(env.DB).toBeDefined()
    expect(env.VAULT_BUCKET).toBeDefined()
    expect(env.RATE_LIMITER).toBeDefined()
    expect(env.AUDIT_LEDGER).toBeDefined()
    expect(env.CHAT_SESSION).toBeDefined()
    expect(env.CANVAS_SESSION).toBeDefined()
    expect(env.LEAD_SCORING_QUEUE).toBeDefined()
    expect(env.FORECASTING_QUEUE).toBeDefined()
    // Verify optional fields
    expect(env.JWT_SECRET).toBe('my-secret')
    expect(env.RESEND_API_KEY).toBe('key-123')
    expect(env.HMAC_KEY).toBe('hmac-val')
    expect(env.ADMIN_API_TOKEN).toBe('admin-token')
    expect(env.OPENROUTER_API_KEY).toBe('sk-or-v1-xxx')
    expect(env.TURNSTILE_SECRET_KEY).toBe('1x0000000000000000000000000000000AA')
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe('https://otel.example.com')
    expect(env.OTEL_SERVICE_NAME).toBe('edgegde-runtime')
    expect(env.WORKER_VERSION).toBe('0.9.5-dev')
  })

  it('allows missing optional fields (they remain undefined)', () => {
    const raw: Record<string, unknown> = {
      TENANT_KV: { get: () => {} },
      DB: { prepare: () => {} },
      VAULT_BUCKET: { get: () => {} },
      RATE_LIMITER: { newUniqueId: () => {} },
      AUDIT_LEDGER: { idFromName: () => {} },
      CHAT_SESSION: { idFromName: () => {} },
      CANVAS_SESSION: { idFromName: () => {} },
      LEAD_SCORING_QUEUE: { send: () => {} },
      FORECASTING_QUEUE: { send: () => {} },
    }
    const env = safeEnv(raw)
    expect(env.JWT_SECRET).toBeUndefined()
    expect(env.RESEND_API_KEY).toBeUndefined()
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined()
    expect(env.WORKER_VERSION).toBeUndefined()
  })
})

describe('envFromContext', () => {
  it('extracts env from a context with c.env', () => {
    const raw = { TENANT_KV: { get: () => {} }, DB: { prepare: () => {} } }
    const ctx = { env: raw }
    const env = envFromContext(ctx)
    // envFromContext passes through safeEnv, so it should be a cast of the same raw object
    expect(env.TENANT_KV).toBeDefined()
    expect(env.DB).toBeDefined()
    expect(env.LEAD_SCORING_QUEUE).toBeUndefined()
  })

  it('returns empty Env when c.env is undefined', () => {
    const env = envFromContext({})
    expect(env).toBeDefined()
    // With no env, {} is cast — so any binding access returns undefined
    expect(env.TENANT_KV).toBeUndefined()
    expect(env.DB).toBeUndefined()
  })

  it('handles null c.env gracefully (falls back to {})', () => {
    const env = envFromContext({ env: null as unknown as undefined })
    expect(env).toBeDefined()
    expect(env.TENANT_KV).toBeUndefined()
    expect(env.JWT_SECRET).toBeUndefined()
  })

  it('handles explicitly undefined c.env gracefully', () => {
    const env = envFromContext({ env: undefined })
    expect(env).toBeDefined()
    expect(env.TENANT_KV).toBeUndefined()
  })
})
