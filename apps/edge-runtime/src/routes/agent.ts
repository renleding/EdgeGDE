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
import type { LayoutDefinition } from '@edgegde/schema'

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const DEV_TOKEN = 'edgegde-dev-token-2026'

// ═══════════════════════════════════════════════════════════════════════════
// Router
// ═══════════════════════════════════════════════════════════════════════════

export const agentRouter = new Hono()

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/v1/agent/publish
// ═══════════════════════════════════════════════════════════════════════════

agentRouter.post('/agent/publish', async (c) => {
  // ── 1. Authorization check ──────────────────────────────────────────────
  const authHeader = c.req.header('Authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()

  const adminToken = (c.env as any)?.ADMIN_API_TOKEN || DEV_TOKEN

  if (!token || token !== adminToken) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  // ── 2. Parse body ──────────────────────────────────────────────────────
  let raw: any
  try {
    raw = await c.req.json()
  } catch {
    return c.json(
      { error: 'Invalid JSON body', details: 'Request body must be valid JSON' },
      400,
    )
  }

  // ── 3. Validate artifact schema ─────────────────────────────────────────
  const parsed = designArtifactSchema.safeParse(raw)
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

  const artifact: DesignArtifact = parsed.data

  // ── 4. Resolve KV store ─────────────────────────────────────────────────
  let kv: KvStore
  const bindings = (c.env as any)?.ARTIFACT_KV

  if (bindings && typeof bindings.get === 'function') {
    // Real Workers KV binding
    kv = bindings as KvStore
  } else {
    // Fallback to in-memory store (local dev)
    kv = getOrCreateMemoryKv(c)
  }

  // ── 5. Publish artifact (idempotent) ────────────────────────────────────
  let result: { version: string; url: string } = { version: 'v0', url: '' }
  let wasAlreadyLatest = false

  try {
    // Check idempotency before publishing
    const keyPrefix = artifact.type === 'calculator' ? 'calc' : artifact.type
    const lKey = `${keyPrefix}:${artifact.id}:latest`
    const existingLatest = await kv.get(lKey)
    const newHash = simpleHash(artifact)

    if (existingLatest) {
      try {
        const parsedExisting = JSON.parse(existingLatest)
        if (parsedExisting.hash === newHash) {
          wasAlreadyLatest = true
          const urlPath = artifact.type === 'calculator'
            ? `/calculator/${artifact.id}`
            : artifact.type === 'page'
              ? `/page/${artifact.id}`
              : `/theme/${artifact.id}`
          result = {
            version: parsedExisting.version,
            url: urlPath,
          }
        }
      } catch {
        // Fall through to normal publish
      }
    }

    if (!wasAlreadyLatest) {
      result = await publishArtifact(kv, artifact)
    }
  } catch (err: any) {
    return c.json(
      { error: 'Publish failed', details: err.message },
      500,
    )
  }

  // ── 6. Register in-memory (deferred via waitUntil) ──────────────────────
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
        // Background persistence failure is non-fatal
      }
    })(),
  )

  // ── 7. Return success ──────────────────────────────────────────────────
  return c.json({
    success: true,
    version: result.version,
    url: result.url,
  })
})

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
