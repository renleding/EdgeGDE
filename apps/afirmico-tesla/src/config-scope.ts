/**
 * FEATURE-12: Vehicle Telemetry Configurator — Resolution Engine
 * 
 * Pure resolution function: global > group > vehicle, sparse inheritance.
 * Deterministic and testable without a database.
 */

export interface ResolvedField {
  field_key: string
  enabled: boolean
  interval_seconds: number
  minimum_delta: number | null
  /** Which scope supplied the winning value. Required by F12-R10. */
  source: 'global' | 'group' | 'vehicle'
  /** The scope_id that won, so the console can link to the row an operator edits. */
  source_scope_id: string
}

export interface ResolvedConfig {
  vin: string
  fields: ResolvedField[]
  /** Fields present in the catalog as collected, absent from every scope. F12-R02: these are an ERROR. */
  unresolved: string[]
}

/**
 * Resolve the effective telemetry configuration for a VIN given:
 *   - global entries (always exist, total base)
 *   - group entries  (owner-curated)
 *   - vehicle entries (one-vehicle scope)
 *
 * Returns the resolved config and a list of any unresolved collected fields.
 *
 * F12-R02: A field absent from every scope is a configuration error,
 *          not a field that silently keeps whatever Tesla last held.
 */
export function resolveConfig(
  globalEntries: Map<string, { interval_seconds: number; minimum_delta?: number | null; enabled?: boolean }>,
  groupEntries: Map<string, { interval_seconds: number; minimum_delta?: number | null; enabled?: boolean }>,
  vehicleEntries: Map<string, { interval_seconds: number; minimum_delta?: number | null; enabled?: boolean }>,
  collectedFields: string[],
  vin: string
): ResolvedConfig {
  const fields: ResolvedField[] = []
  const unresolved: string[] = []

  for (const field_key of collectedFields) {
    let source: 'global' | 'group' | 'vehicle' = 'global'
    let source_scope_id = 'global'
    let entry: { interval_seconds: number; minimum_delta?: number | null; enabled?: boolean } | undefined = undefined

    // 1. Check vehicle scope first (most specific)
    if (vehicleEntries && vehicleEntries.has(field_key)) {
      entry = vehicleEntries.get(field_key)
      source = 'vehicle'
      source_scope_id = 'vehicle'
    }
    // 2. Check group scope
    else if (groupEntries && groupEntries.has(field_key)) {
      entry = groupEntries.get(field_key)
      source = 'group'
      source_scope_id = 'group'
    }
    // 3. Global always exists (total base)
    else {
      entry = globalEntries.get(field_key)
      source = 'global'
      source_scope_id = 'global'
    }

    if (!entry) {
      unresolved.push(field_key)
      continue
    }

    const effectiveEnabled = entry.enabled !== false
    const effectiveMinimumDelta = entry.minimum_delta ?? null

    fields.push({
      field_key,
      enabled: effectiveEnabled,
      interval_seconds: entry.interval_seconds,
      minimum_delta: effectiveMinimumDelta ?? null,
      source,
      source_scope_id,
    })
  }

  return { vin, fields, unresolved }
}