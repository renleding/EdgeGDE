/**
 * EdgeGDE gogo — Structured Authorization Gate
 *
 * Formalizes the "gogo" authorization step from a tacit CLI keyword into
 * a first-class manifest field. Every mission execution is gated by an
 * explicit authorization that is recorded in AuditLedger.
 *
 * @see docs/OTEL-ATTRIBUTES.md (app.correlation.id)
 */

import type { GogoAuthorization, GogoScope, MissionDefinition } from './types'
import type { AgenticMissionManifest } from '../agentic-ux/agentic-ux.schema'

// ═══════════════════════════════════════════════════════════════════════════
// Authorization Result
// ═══════════════════════════════════════════════════════════════════════════

export interface GogoResult {
  authorized: boolean
  reason?: string
  gogo?: GogoAuthorization
}

// ═══════════════════════════════════════════════════════════════════════════
// Authorization Check
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check whether a gogo authorization is valid for the given mission.
 * Returns { authorized: true } if the gogo is valid, or a rejection reason.
 *
 * Checks performed:
 * 1. Does the gogo exist?
 * 2. Has it expired?
 * 3. Are the mission's action types within the gogo's scope?
 * 4. Is the drift threshold respected?
 */
export function checkGogo(
  mission: MissionDefinition,
  manifest: AgenticMissionManifest,
): GogoResult {
  const gogo = mission.gogo ?? (manifest as any).gogo as GogoAuthorization | undefined

  // 1. No gogo = no authorization
  if (!gogo) {
    return {
      authorized: false,
      reason: 'No gogo authorization provided. Set mission.gogo or manifest.gogo.',
    }
  }

  // 2. Check expiry
  if (gogo.expiresAt) {
    const expiry = new Date(gogo.expiresAt).getTime()
    if (isNaN(expiry)) {
      return {
        authorized: false,
        reason: `Invalid gogo.expiresAt format: ${gogo.expiresAt}. Use ISO-8601.`,
      }
    }
    if (Date.now() > expiry) {
      return {
        authorized: false,
        reason: `gogo authorization expired at ${gogo.expiresAt}. Re-authorize with a new gogo.`,
      }
    }
  }

  // 3. Check action type scope
  if (gogo.scope?.actions && gogo.scope.actions.length > 0) {
    const allowed = new Set(gogo.scope.actions)
    for (const step of manifest.steps) {
      if (!allowed.has(step.actionType)) {
        return {
          authorized: false,
          reason: `Action '${step.actionType}' is not in the gogo scope. Allowed: [${Array.from(allowed).join(', ')}]`,
        }
      }
    }
  }

  // 4. Check path scope
  if (gogo.scope?.paths && gogo.scope.paths.length > 0) {
    // Path scope checking would be done by the Droid runtime.
    // Here we acknowledge it exists — enforcement is delegated to Droid's
    // path constraints.
  }

  // 5. Check drift threshold
  if (gogo.scope?.maxDrift !== undefined && mission.driftThreshold !== undefined) {
    if (mission.driftThreshold > gogo.scope.maxDrift) {
      return {
        authorized: false,
        reason: `Mission drift threshold (${mission.driftThreshold}) exceeds gogo max drift (${gogo.scope.maxDrift}). Reduce driftThreshold or increase gogo scope.`,
      }
    }
  }

  return { authorized: true, gogo }
}

/**
 * Build a structured gogo authorization object.
 * Used when a user types "gogo" to authorize a mission.
 */
export function createGogo(opts: {
  authorizedBy: string
  scope?: GogoScope
  constraints?: GogoAuthorization['constraints']
  expiresAt?: string
  notes?: string
}): GogoAuthorization {
  return {
    authorizedBy: opts.authorizedBy,
    authorizedAt: new Date().toISOString(),
    scope: opts.scope,
    constraints: opts.constraints,
    expiresAt: opts.expiresAt,
    notes: opts.notes,
  }
}

/**
 * Build scope constraints from a natural language gogo.
 * "gogo deploy" -> scope for deploy actions
 * "gogo shell" -> scope with allowShell
 */
export function scopeFromGogo(gogoText: string): GogoScope | undefined {
  const lower = gogoText.toLowerCase()

  // Check for specific action types
  if (lower.includes('deploy')) {
    return {
      actions: ['site.publish', 'site.rollback'],
      paths: ['wrangler.json', 'wrangler.staging.json'],
    }
  }

  if (lower.includes('test') || lower.includes('run')) {
    return {
      actions: [],
      paths: ['tests/', 'src/'],
      maxDrift: 0.5,
    }
  }

  if (lower.includes('shell') || lower.includes('terminal')) {
    return {
      maxDrift: 1.0,
    }
  }

  // Generic "gogo" — full scope
  return undefined
}
