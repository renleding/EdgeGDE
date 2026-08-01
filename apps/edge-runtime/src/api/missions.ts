/**
 * EdgeGDE Missions API — Dry-run & Execute
 *
 * FRS-4: POST /api/v1/missions/dry-run — preview without executing
 * FRS-1: POST /api/v1/missions/execute — run a mission through the lifecycle
 *
 * @see docs/FRs-001-compensation-replay-reconcile-dryrun.md
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { AgenticMissionManifestSchema } from '../agentic-ux/agentic-ux.schema'
import { generateManifestFromGoal } from '../agentic-ux/manifest-generator'
import { dryRunMission, runMission } from '../actions/lifecycle'
import { getAction, listActions } from '../actions/lifecycle'
import type { MissionDefinition } from '../actions/types'

const missionRouter = new Hono()

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/v1/missions/dry-run
// ═══════════════════════════════════════════════════════════════════════════

missionRouter.post('/dry-run', async (c) => {
  try {
    const body = await c.req.json()
    const manifest = AgenticMissionManifestSchema.parse(body.manifest)
    const missionId = body.missionId ?? manifest.id

    const mission: MissionDefinition = {
      id: missionId,
      name: manifest.intent ?? missionId,
      desiredState: {},
      actions: manifest.steps
        .map((step) => getAction(step.actionType))
        .filter((a): a is NonNullable<typeof a> => a !== undefined),
    }

    const report = await dryRunMission(mission, manifest)
    return c.json({ report })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json(
        { report: { valid: false, actions: [], warnings: [], errors: err.errors.map((e) => `${e.path.join('.')}: ${e.message}`), estimatedTotalDurationMs: 0 } },
        400,
      )
    }
    return c.json(
      { report: { valid: false, actions: [], warnings: [], errors: [err instanceof Error ? err.message : String(err)], estimatedTotalDurationMs: 0 } },
      500,
    )
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/v1/missions/execute
// ═══════════════════════════════════════════════════════════════════════════
//
// Accepts either:
//   1. A SimpleMissionGoal (goal + actionType + input + IDs)
//   2. A full manifest for direct execution
//
// Generates a manifest from the goal, runs it through the lifecycle,
// and returns the result.

missionRouter.post('/execute', async (c) => {
  try {
    const body = await c.req.json()

    // Determine if this is a goal-based request or a full-manifest request
    let manifest
    if (body.manifest) {
      // Full manifest provided directly
      manifest = AgenticMissionManifestSchema.parse(body.manifest)
    } else if (body.goal && body.actionType && body.input) {
      // Simple goal — generate manifest
      const tenantId = body.tenantId ?? 'default'
      const correlationId = body.correlationId ?? `corr-${Date.now()}`
      manifest = generateManifestFromGoal({
        intent: body.goal,
        actionType: body.actionType,
        input: body.input,
        tenantId,
        correlationId,
        sessionId: body.sessionId,
      })
    } else {
      return c.json(
        { error: 'Provide either a "manifest" object or a "goal" + "actionType" + "input"', success: false },
        400,
      )
    }

    const mission: MissionDefinition = {
      id: manifest.id,
      name: manifest.intent,
      desiredState: {},
      actions: manifest.steps
        .map((step) => getAction(step.actionType))
        .filter((a): a is NonNullable<typeof a> => a !== undefined),
    }

    const result = await runMission({
      mission,
      manifest,
      correlationId: manifest.correlationId,
      tenantId: manifest.tenantId,
      env: c.env as Record<string, unknown>,
    })

    return c.json({ success: result.status === 'success', result })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json(
        { success: false, error: err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ') },
        400,
      )
    }
    return c.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      500,
    )
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/v1/missions/actions
// ═══════════════════════════════════════════════════════════════════════════

missionRouter.get('/actions', async (_c) => {
  const registered = listActions().map((a) => ({
    type: a.type,
    hasCompensation: !!a.compensate,
    hasDryRun: !!a.dryRun,
  }))
  return _c.json({ actions: registered })
})

export { missionRouter }
