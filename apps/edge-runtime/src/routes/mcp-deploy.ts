/**
 * EdgeGDE Runtime — MCP Deployment Endpoints
 * Phase 23.1: Deploy, promote, rollback, and diff endpoints
 * for MCP-based tenant layout management.
 *
 * @packageDocumentation
 */

import { Hono, type Context } from 'hono'
import { envFromContext } from '../lib/env'
import {
  setTenantLayout,
  promoteToProduction,
  rollbackTenantLayout,
} from '../lib/registry'
import { MemoryKvStore } from '../lib/publish'
import { getVersionMeta } from '../lib/versioning'
import type { KvStore } from '../lib/publish'
import type { VersionMeta } from '../lib/versioning'
import {
  McpDeploySchema,
  PromoteSchema,
  RollbackSchema,
  DiffQuerySchema,
  ValidationError,
  validateOrThrow,
  validationErrorResponse,
} from '../lib/schemas'

// KV Resolver — Workers KV binding or shared MemoryKvStore singleton
import { kv } from '../index'

function resolveKv(c: Context): KvStore {
  const bindings = envFromContext(c).ARTIFACT_KV
  if (bindings && typeof bindings.get === 'function') {
    return bindings as KvStore
  }
  return kv
}

// ═══════════════════════════════════════════════════════════════════════════
// Router
// ═══════════════════════════════════════════════════════════════════════════

export const mcpDeployRouter = new Hono()

// ═══════════════════════════════════════════════════════════════════════════
// POST /mcp/deploy — deploy a new layout version
// ═══════════════════════════════════════════════════════════════════════════

mcpDeployRouter.post('/mcp/deploy', async (c) => {
  // ── Auth is handled by adminAuth middleware ──────────────────────────────

  // ── 1. Parse + validate body ────────────────────────────────────────────
  let body: Record<string, unknown>
  try {
    body = await c.req.json()
  } catch {
    return c.json(
      { error: 'Invalid JSON body', details: 'Request body must be valid JSON' },
      400,
    )
  }

  let parsed: import('../lib/schemas').McpDeployInput
  try {
    parsed = validateOrThrow(McpDeploySchema, body)
  } catch (err) {
    if (err instanceof ValidationError) {
      const resp = validationErrorResponse(err)
      return c.json(resp.body, resp.status)
    }
    return c.json({ error: 'Invalid request body' }, 400)
  }

  const tenantId = parsed.tenant_id
  const layoutPayload = parsed.layout_payload
  const versionNote = parsed.version_note
  const environment = parsed.environment

  // ── 4. Execute ──────────────────────────────────────────────────────────
  const kv = resolveKv(c)

  try {
    const result = await setTenantLayout(kv, tenantId, layoutPayload, versionNote, environment ?? 'staging')

    if (result.status === 'conflict') {
      return c.json(
        {
          success: false,
          status: 'conflict',
          message: 'Deploy currently in progress for this tenant. Try again shortly.',
        },
        409,
      )
    }

    return c.json({
      success: true,
      status: result.status,
      version: result.version,
      staging_url: result.url,
    })
  } catch (err: any) {
    return c.json(
      { error: 'Deploy failed', details: err.message },
      500,
    )
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /mcp/promote — promote staging version to production
// ═══════════════════════════════════════════════════════════════════════════

mcpDeployRouter.post('/mcp/promote', async (c) => {
  // ── Auth is handled by adminAuth middleware ──────────────────────────────

  // ── 1. Parse + validate body ────────────────────────────────────────────
  let body: Record<string, unknown>
  try {
    body = await c.req.json()
  } catch {
    return c.json(
      { error: 'Invalid JSON body', details: 'Request body must be valid JSON' },
      400,
    )
  }

  let parsed: import('../lib/schemas').PromoteInput
  try {
    parsed = validateOrThrow(PromoteSchema, body)
  } catch (err) {
    if (err instanceof ValidationError) {
      const resp = validationErrorResponse(err)
      return c.json(resp.body, resp.status)
    }
    return c.json({ error: 'Invalid request body' }, 400)
  }

  const tenantId = parsed.tenant_id
  const version = parsed.version

  // ── 3. Execute ──────────────────────────────────────────────────────────
  const kv = resolveKv(c)

  try {
    const result = await promoteToProduction(kv, tenantId, version)

    if (result.status === 'conflict') {
      return c.json(
        {
          success: false,
          status: 'conflict',
          message: 'Deploy currently in progress for this tenant. Try again shortly.',
        },
        409,
      )
    }

    if (result.status === 'no_version_found') {
      return c.json(
        {
          success: false,
          status: 'no_version_found',
          message: 'No staging version found to promote.',
        },
        404,
      )
    }

    if (result.status === 'version_not_found') {
      return c.json(
        {
          success: false,
          status: 'version_not_found',
          message: `Version "${version}" does not exist.`,
        },
        404,
      )
    }

    return c.json({
      success: true,
      status: result.status,
      active_version: result.active_version,
    })
  } catch (err: any) {
    return c.json(
      { error: 'Promote failed', details: err.message },
      500,
    )
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /mcp/rollback — rollback production to a specific version
// ═══════════════════════════════════════════════════════════════════════════

mcpDeployRouter.post('/mcp/rollback', async (c) => {
  // ── Auth is handled by adminAuth middleware ──────────────────────────────

  // ── 1. Parse + validate body ────────────────────────────────────────────
  let body: Record<string, unknown>
  try {
    body = await c.req.json()
  } catch {
    return c.json(
      { error: 'Invalid JSON body', details: 'Request body must be valid JSON' },
      400,
    )
  }

  let parsed: import('../lib/schemas').RollbackInput
  try {
    parsed = validateOrThrow(RollbackSchema, body)
  } catch (err) {
    if (err instanceof ValidationError) {
      const resp = validationErrorResponse(err)
      return c.json(resp.body, resp.status)
    }
    return c.json({ error: 'Invalid request body' }, 400)
  }

  const tenantId = parsed.tenant_id
  const version = parsed.version

  // ── 3. Execute ──────────────────────────────────────────────────────────
  const kv = resolveKv(c)

  try {
    const result = await rollbackTenantLayout(kv, tenantId, version)

    if (result.status === 'conflict') {
      return c.json(
        {
          success: false,
          status: 'conflict',
          message: 'Deploy currently in progress for this tenant. Try again shortly.',
        },
        409,
      )
    }

    if (result.status === 'version_not_found') {
      return c.json(
        {
          success: false,
          status: 'version_not_found',
          message: `Version "${version}" does not exist.`,
        },
        404,
      )
    }

    return c.json({
      success: true,
      status: result.status,
    })
  } catch (err: any) {
    return c.json(
      { error: 'Rollback failed', details: err.message },
      500,
    )
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// GET /mcp/diff — get diff summary between two versions
// ═══════════════════════════════════════════════════════════════════════════

mcpDeployRouter.get('/mcp/diff', async (c) => {
  // ── Auth is handled by adminAuth middleware ──────────────────────────────

  // ── 1. Parse ────────────────────────────────────────────────────────────
  const rawQuery = {
    tenant_id: c.req.query('tenant_id') || '',
    v1: c.req.query('v1') || '',
    v2: c.req.query('v2') || '',
  }

  let parsed: import('../lib/schemas').DiffQuery
  try {
    parsed = validateOrThrow(DiffQuerySchema, rawQuery)
  } catch (err) {
    if (err instanceof ValidationError) {
      const resp = validationErrorResponse(err)
      return c.json(resp.body, resp.status)
    }
    return c.json({ error: 'Invalid query params' }, 400)
  }

  const tenantId = parsed.tenant_id
  const v1 = parsed.v1
  const v2 = parsed.v2

  // ── 3. Execute ──────────────────────────────────────────────────────────
  const kv = resolveKv(c)

  try {
    const meta1 = await getVersionMeta(kv, tenantId, v1)
    const meta2 = await getVersionMeta(kv, tenantId, v2)

    if (!meta1) {
      return c.json(
        { error: 'Version not found', details: `Metadata for ${v1} not found` },
        404,
      )
    }

    if (!meta2) {
      return c.json(
        { error: 'Version not found', details: `Metadata for ${v2} not found` },
        404,
      )
    }

    // Determine which version is later and return its diff summary
    const isV2Later = meta2.timestamp >= meta1.timestamp
    const laterVersion = isV2Later ? v2 : v1
    const earlierVersion = isV2Later ? v1 : v2
    const laterMeta = isV2Later ? meta2 : meta1

    return c.json({
      v1,
      v2,
      earlier_version: earlierVersion,
      later_version: laterVersion,
      diff_summary: laterMeta.diff_summary_vs_previous
        ? JSON.parse(laterMeta.diff_summary_vs_previous)
        : null,
      timestamp_v1: meta1.timestamp,
      timestamp_v2: meta2.timestamp,
    })
  } catch (err: any) {
    return c.json(
      { error: 'Diff failed', details: err.message },
      500,
    )
  }
})
