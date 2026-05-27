/**
 * EdgeGDE EDR — Spec Loader
 * v4.7.0: Loads YAML specification files from the /edr/spec directory
 * and returns parsed contract objects for runtime validation.
 *
 * @packageDocumentation
 */

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface SpecDocument {
  name: string
  version: string
  description: string
  invariants?: string[]
  modules?: Record<string, any>
  pipeline?: Record<string, any>
}

// ═══════════════════════════════════════════════════════════════════════════
// Spec Registry
// ═══════════════════════════════════════════════════════════════════════════

const specRegistry = new Map<string, SpecDocument>()

/** Register a spec document for runtime access */
export function registerSpec(spec: SpecDocument): void {
  specRegistry.set(spec.name, spec)
}

/** Get a registered spec by name */
export function getSpec(name: string): SpecDocument | undefined {
  return specRegistry.get(name)
}

/** List all registered spec names */
export function listSpecs(): string[] {
  return Array.from(specRegistry.keys())
}

/** Get invariants from a spec by name */
export function getInvariants(name: string): string[] {
  return specRegistry.get(name)?.invariants ?? []
}
