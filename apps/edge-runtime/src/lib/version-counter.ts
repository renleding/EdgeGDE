/**
 * EdgeGDE Runtime — D1 Atomic Version Counter
 * Phase 34 v7.0: Source of truth for artifact versioning.
 *
 * Uses INSERT ... ON CONFLICT ... DO UPDATE SET version = version + 1 RETURNING version
 * for atomic, race-condition-free version increments via D1.
 *
 * D1 is MANDATORY. No fallback to KV or in-memory counters.
 * If c.env.DB is unavailable, this throws immediately.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface VersionResult {
  version: number
}

// ═══════════════════════════════════════════════════════════════════════════
// D1 Guard
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Assert that a D1 binding is available. Throws with a clear message.
 */
export function requireD1(db: unknown): asserts db is { prepare: Function } {
  if (!db || typeof (db as Record<string, unknown>).prepare !== 'function') {
    throw new Error(
      "D1 binding 'DB' is required for runtime. " +
      'Ensure wrangler.json has a D1 database binding named "DB" ' +
      'and you are running with `bun run dev` or `bunx wrangler dev`.'
    )
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Atomic Version Increment
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Atomically increment and retrieve the next version for a tenant+artifact pair.
 *
 * Schema: tenant_artifacts(tenant_id, artifact_id, version)
 *
 * SQL:
 *   INSERT INTO tenant_artifacts (tenant_id, artifact_id, version)
 *   VALUES (?, ?, 1)
 *   ON CONFLICT (tenant_id, artifact_id)
 *   DO UPDATE SET version = version + 1
 *   RETURNING version;
 *
 * @param db - D1 database binding (c.env.DB)
 * @param tenantId - scoping tenant
 * @param artifactId - artifact name (e.g. layout ID)
 * @returns The new version number
 */
export async function nextArtifactVersion(
  db: unknown,
  tenantId: string,
  artifactId: string,
): Promise<number> {
  requireD1(db)

  try {
    const result = await db.prepare(
      `INSERT INTO tenant_artifacts (tenant_id, artifact_id, version)
       VALUES (?, ?, 1)
       ON CONFLICT (tenant_id, artifact_id)
       DO UPDATE SET version = version + 1
       RETURNING version`
    )
      .bind(tenantId, artifactId)
      .first()

    if (!result || typeof result.version !== 'number') {
      throw new Error('D1 version query did not return a version number')
    }

    return result.version
  } catch (err: any) {
    throw new Error(`Version increment failed: ${err.message}`)
  }
}
