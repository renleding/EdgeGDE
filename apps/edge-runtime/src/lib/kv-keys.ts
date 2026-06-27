/**
 * EdgeGDE — Canonical KV Key Patterns
 *
 * Single source of truth for all KV key schemas.
 * Every KV read/write in the system MUST go through a function here.
 *
 * Key namespaces:
 *   calc:        Calculator artifacts
 *   page:        Page artifacts
 *   theme:       Theme artifacts
 *   art:         Generic artifact (fallback)
 *   tenant:      Tenant-scoped data (layout, alerts, deadletters)
 *   lock:        Deploy locks
 *   cache:       Cached computation results
 *   compensate:  Compensation markers
 *
 * @packageDocumentation
 */

// ═══════════════════════════════════════════════════════════════════════════
// Artifact Keys (publish.ts)
// ═══════════════════════════════════════════════════════════════════════════

type ArtifactType = 'calculator' | 'page' | 'theme'

/** Get the key prefix for an artifact type. */
export function artifactPrefix(type: ArtifactType | string): string {
  switch (type) {
    case 'calculator': return 'calc:'
    case 'page':       return 'page:'
    case 'theme':      return 'theme:'
    default:           return 'art:'
  }
}

/** Key for the latest published version of an artifact. */
export function artifactLatestKey(type: ArtifactType | string, id: string): string {
  return `${artifactPrefix(type)}${id}:latest`
}

/** Key for a specific version of an artifact. */
export function artifactVersionKey(type: ArtifactType | string, id: string, version: string): string {
  return `${artifactPrefix(type)}${id}:${version}`
}

// ═══════════════════════════════════════════════════════════════════════════
// Tenant Layout Keys
// ═══════════════════════════════════════════════════════════════════════════

/** Latest production layout for a tenant. */
export function tenantLayoutLatestKey(tenantId: string): string {
  return `tenant:${tenantId}:layout:latest`
}

/** Staging layout for a tenant. */
export function tenantLayoutStagingKey(tenantId: string): string {
  return `tenant:${tenantId}:layout:staging`
}

/** Arbitrary suffix layout for a tenant (e.g. versioned deploys). */
export function tenantLayoutKey(tenantId: string, suffix: string): string {
  return `tenant:${tenantId}:layout:${suffix}`
}

/** Compiled/cached HTML layout for a specific tool and env. */
export function tenantCompiledKey(tenantId: string, layoutTool: string, isStaging: boolean): string {
  return `tenant:${tenantId}:compiled:${layoutTool}:${isStaging ? 'staging' : 'prod'}`
}

// ═══════════════════════════════════════════════════════════════════════════
// Hot Lead / Alert Keys
// ═══════════════════════════════════════════════════════════════════════════

/** Index of hot lead submission IDs for a tenant. */
export function hotLeadIndexKey(tenantId: string): string {
  return `tenant:${tenantId}:alerts:hot:index`
}

/** Individual hot lead alert data. */
export function hotLeadKey(tenantId: string, submissionId: string): string {
  return `tenant:${tenantId}:alert:hot:${submissionId}`
}

// ═══════════════════════════════════════════════════════════════════════════
// Dead Letter Keys
// ═══════════════════════════════════════════════════════════════════════════

/** Index of dead-letter submission IDs for a tenant. */
export function deadLetterIndexKey(tenantId: string): string {
  return `tenant:${tenantId}:deadletter:index`
}

/** Individual dead-letter entry. */
export function deadLetterKey(tenantId: string, submissionId: string): string {
  return `tenant:${tenantId}:deadletter:${submissionId}`
}

// ═══════════════════════════════════════════════════════════════════════════
// Canvas Cache Keys
// ═══════════════════════════════════════════════════════════════════════════

/** Cached generated canvas result. */
export function canvasCacheGenKey(hash: string): string {
  return `cache:canvas:gen:${hash}`
}

// ═══════════════════════════════════════════════════════════════════════════
// Deploy Lock Keys
// ═══════════════════════════════════════════════════════════════════════════

/** Deploy lock for a tenant — prevents concurrent deploys. */
export function deployLockKey(tenantId: string): string {
  return `lock:${tenantId}:deploy`
}

// ═══════════════════════════════════════════════════════════════════════════
// Compensation Marker Keys
// ═══════════════════════════════════════════════════════════════════════════

/** Compensation audit marker for a mission. */
export function compensateMarkerKey(missionId: string): string {
  return `compensate:${missionId}`
}
