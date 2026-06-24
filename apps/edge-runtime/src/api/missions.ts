/**
 * EdgeGDE Missions API — Dry-run endpoint
 *
 * FRS-4: POST /api/v1/missions/dry-run
 * Preview what a mission will do without executing any actions.
 *
 * CLI wrapper:
 *   hermes mission --dry-run <manifest.json>
 *
 * @see docs/FRs-001-compensation-replay-reconcile-dryrun.md
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { AgenticMissionManifestSchema } from '../agentic-ux/agentic-ux.schema'
import { dryRunMission } from '../actions/lifecycle'
import { getAction } from '../actions/lifecycle'
import type { MissionDefinition } from '../actions/types'

const missionRouter = new Hono()

/**
 * POST /api/v1/missions/dry-run
 *
 * Accepts an AgenticMissionManifest and returns a DryRunReport.
 * Never mutates state or calls external services.
 *
 * Request body:
 * ```json
 * {
 *   "manifest": { ... },
 *   "missionId": "optional-mission-id"
 * }
 * ```
 *
 * Response:
 * ```json
 * {
 *   "report": {
 *     "valid": true,
 *     "actions": [...],
 *     "warnings": [],
 *     "errors": [],
 *     "estimatedTotalDurationMs": 1200
 *   }
 * }
 * ```
 */
missionRouter.post('/dry-run', async (c) => {
  try {
    const body = await c.req.json()
    const manifest = AgenticMissionManifestSchema.parse(body.manifest)
    const missionId = body.missionId ?? manifest.id

    // Build a temporary mission definition from the manifest
    // In a full implementation, missions would be registered and looked up by ID
    const mission: MissionDefinition = {
      id: missionId,
      name: (manifest as any).intent ?? missionId,
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

/**
 * GET /api/v1/missions/actions
 *
 * List all registered action types.
 */
missionRouter.get('/actions', async (c) => {
  const actions = Array.from(
    new Set(
      [...(await Promise.resolve([]))],
    ),
  )
  // Use the lifecycle module's listActions
  const { listActions } = await import('../actions/lifecycle')
  const registered = listActions().map((a) => ({
    type: a.type,
    hasCompensation: !!a.compensate,
    hasDryRun: !!a.dryRun,
  }))
  return c.json({ actions: registered })
})

export { missionRouter }
