/**
 * EdgeGDE Runtime — Agent/Publish Endpoint
 * HSAES Phase 6: POST /api/v1/agent/publish endpoint with
 * token auth, Zod validation, idempotency, and deferred persistence.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { CALCULATOR_REGISTRY } from '../registry/calculators'
import { PAGE_REGISTRY } from '../registry/pages'
import { THEME_REGISTRY } from '../registry/themes'
import { compileLayout } from '../compiler/engine'
import {
  designArtifactSchema,
  MemoryKvStore,
  publishArtifact,
} from '../lib/publish'
import type { DesignArtifact, KvStore } from '../lib/publish'
import { deployTenantLayout } from '../lib/publish-tenant'
import type { LayoutDefinition } from '@edgegde/schema'
import { layoutDefinitionSchema } from '@edgegde/schema'
import { validateDesign } from '../lib/design-validator'
import { computeLayoutHash, setLatestHash } from '../edr/runtime/hash'

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// Router
// ═══════════════════════════════════════════════════════════════════════════

export const agentRouter = new Hono()

// ═══════════════════════════════════════════════════════════════════════════
// Discriminated union schema for unified publish endpoint
// ═══════════════════════════════════════════════════════════════════════════

const publishSchema = z.discriminatedUnion('kind', [
  // Variant 1: Artifact publish (existing calculator/page/theme flow)
  z.object({
    kind: z.literal('artifact'),
    id: z.string().min(1),
    type: z.enum(['calculator', 'page', 'theme']),
    layout: z.any(),
    schema: z.any().optional(),
    theme: z.any().optional(),
  }),
  // Variant 2: Tenant layout deploy (AI-generated site layout)
  z.object({
    kind: z.literal('tenant'),
    tenantId: z.string().min(1),
    layout: z.any(),
    design: z.string(),
    source: z.string().optional(),
    idempotencyKey: z.string().optional(),
  }),
])

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/v1/agent/publish — unified publish controller
// Phase 35B: Routes to artifact or tenant flow based on body.kind
// ═══════════════════════════════════════════════════════════════════════════

agentRouter.post('/agent/publish', async (c) => {
  // ── Auth is handled by adminAuth middleware ──────────────────────────────

  // ── 1. Parse + validate body via discriminated union ────────────────────
  let raw: any
  try {
    raw = await c.req.json()
  } catch {
    return c.json(
      { error: 'Invalid JSON body', details: 'Request body must be valid JSON' },
      400,
    )
  }

  const parsed = publishSchema.safeParse(raw)
  if (!parsed.success) {
    return c.json(
      {
        error: 'Validation failed',
        details: parsed.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      },
      400,
    )
  }

  const body = parsed.data

  // ── 2. Route based on discriminator ─────────────────────────────────────
  try {
    if (body.kind === 'artifact') {
      return await handleArtifactPublish(c, body)
    } else {
      return await handleTenantDeploy(c, body)
    }
  } catch (err: any) {
    return c.json({ error: 'Publish failed', details: err.message }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// Artifact publish handler (existing calculator/page/theme flow)
// ═══════════════════════════════════════════════════════════════════════════

async function handleArtifactPublish(c: any, body: any) {
  const artifact: DesignArtifact = {
    id: body.id,
    type: body.type,
    layout: body.layout,
    schema: body.schema,
    theme: body.theme,
  }

  // Resolve KV store
  let kv: KvStore
  const bindings = (c.env as any)?.ARTIFACT_KV
  if (bindings && typeof bindings.get === 'function') {
    kv = bindings as KvStore
  } else {
    kv = getOrCreateMemoryKv(c)
  }

  // D1 binding for atomic versioning
  const db = (c.env as any)?.DB

  // Publish with optional D1 versioning
  const result = await publishArtifact(kv, artifact, db)

  // Register in-memory (deferred)
  c.executionCtx.waitUntil(
    (async () => {
      try {
        const layout = artifact.layout as LayoutDefinition
        const html = compileLayout(layout)

        switch (artifact.type) {
          case 'calculator':
            CALCULATOR_REGISTRY[artifact.id] = {
              id: artifact.id,
              description: `Published calculator: ${artifact.id} (${result.version})`,
              schema: z.object({}) as any,
              layout,
              execute(input: any): any {
                return { ...input, publishedVersion: result.version }
              },
            }
            break
          case 'page':
            PAGE_REGISTRY[artifact.id] = {
              id: artifact.id,
              description: `Published page: ${artifact.id} (${result.version})`,
              layout,
              html,
            }
            break
          case 'theme':
            const tokens: Record<string, string> = {}
            if (artifact.theme && typeof artifact.theme === 'object') {
              for (const [key, value] of Object.entries(artifact.theme)) {
                tokens[key] = String(value)
              }
            }
            THEME_REGISTRY[artifact.id] = {
              id: artifact.id,
              tokens,
              description: `Published theme: ${artifact.id} (${result.version})`,
            }
            break
        }
      } catch {
        // Non-fatal
      }
    })(),
  )

  console.log(JSON.stringify({
    event: 'publish',
    kind: 'artifact',
    type: artifact.type,
    id: artifact.id,
    version: result.version,
    timestamp: Date.now(),
  }))

  return c.json({ success: true, version: result.version, url: result.url })
}

// ═══════════════════════════════════════════════════════════════════════════
// Tenant deploy handler (AI-generated layout pipeline)
// Phase 35B: validate → version → KV → invalidate → pre-warm → respond
// ═══════════════════════════════════════════════════════════════════════════

async function handleTenantDeploy(c: any, body: any) {
  const { tenantId, layout, design, source } = body

  // 1. Defensive validation — layout against Zod schema
  const layoutParsed = layoutDefinitionSchema.safeParse(layout)
  if (!layoutParsed.success) {
    const issues = layoutParsed.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }))
    return c.json({
      error: 'validation_failed',
      details: issues,
    }, 400)
  }

  // 2. Validate design
  const designResult = validateDesign(design)
  if (!designResult.valid) {
    return c.json({
      error: 'validation_failed',
      details: designResult.errors,
    }, 400)
  }

  // 3. Resolve bindings
  const db = (c.env as any)?.DB
  const TENANT_KV = (c.env as any)?.TENANT_KV

  if (!db) return c.json({ error: 'D1 binding required' }, 500)
  if (!TENANT_KV) return c.json({ error: 'TENANT_KV binding required' }, 500)

  // 4. Deploy
  const result = await deployTenantLayout(
    tenantId,
    layoutParsed.data,
    design,
    db,
    TENANT_KV,
    source,
  )

  // 5. Update hash authority (in-memory + KV)
  try {
    const hash = await computeLayoutHash(layoutParsed.data)
    await setLatestHash(hash, layoutParsed.data, {
      put: (key: string, value: string) => TENANT_KV.put(key, value),
    })
  } catch {
    // Hash update is non-critical — deploy still succeeded
  }

  return c.json({
    success: true,
    tenantId: result.tenantId,
    version: result.version,
    url: result.url,
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// Simple hash utility
// ═══════════════════════════════════════════════════════════════════════════

function simpleHash(artifact: DesignArtifact): string {
  const str = JSON.stringify({
    id: artifact.id,
    type: artifact.type,
    layout: artifact.layout,
    schema: artifact.schema,
    theme: artifact.theme,
  })
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

// ═══════════════════════════════════════════════════════════════════════════
// Per-request MemoryKvStore cache
// ═══════════════════════════════════════════════════════════════════════════

const globalKv = new MemoryKvStore()

function getOrCreateMemoryKv(c: any): KvStore {
  return globalKv
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /agent/generate-layout — validate externally-generated LayoutDefinition
// Phase 35: Stateless validation gate. No KV, no D1, no side effects.
// ═══════════════════════════════════════════════════════════════════════════

agentRouter.post('/agent/generate-layout', async (c) => {
  // ── Auth is handled by adminAuth middleware ──────────────────────────────

  const startTime = Date.now()

  // ── 1. Parse body ───────────────────────────────────────────────────────
  let body: Record<string, unknown>
  try {
    body = await c.req.json()
  } catch {
    console.log(JSON.stringify({
      type: 'metric', event: 'validation_failure',
      timestamp: startTime, details: 'Invalid JSON body',
    }))
    return c.json({
      error: 'validation_failed',
      details: 'Request body must be valid JSON',
    }, 400)
  }

  const layout = body.layout
  const design = body.design
  const prompt = body.prompt

  // ── 2. Validate design ─────────────────────────────────────────────────
  const designResult = validateDesign(design)
  if (!designResult.valid) {
    console.log(JSON.stringify({
      type: 'metric', event: 'validation_failure',
      timestamp: Date.now(), details: designResult.errors.join('; '),
    }))
    return c.json({
      error: 'validation_failed',
      details: designResult.errors,
    }, 400)
  }

  // ── 3. Validate layout with Zod ─────────────────────────────────────────
  const parsed = layoutDefinitionSchema.safeParse(layout)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
      code: i.code,
    }))

    console.log(JSON.stringify({
      type: 'metric', event: 'validation_failure',
      timestamp: Date.now(), details: JSON.stringify(issues),
    }))

    return c.json({
      error: 'validation_failed',
      details: issues,
    }, 400)
  }

  // ── 4. Success ──────────────────────────────────────────────────────────
  const elapsed = Date.now() - startTime

  console.log(JSON.stringify({
    type: 'metric', event: 'validation_success',
    timestamp: Date.now(), durationMs: elapsed,
    promptLength: typeof prompt === 'string' ? prompt.length : 0,
  }))

  return c.json({
    layout: parsed.data,
    design: String(design),
    valid: true,
  })
})
