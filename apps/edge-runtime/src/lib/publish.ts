/**
 * EdgeGDE Runtime — KV-backed Artifact Persistence Layer
 * HSAES Phase 6: KV interface, MemoryKvStore, versioned publishing with idempotency.
 *
 * @packageDocumentation
 */

import {
  layoutDefinitionSchema,
  SCHEMA_VERSION,
} from '@edgegde/schema'
import { z } from 'zod'

// ═══════════════════════════════════════════════════════════════════════════
// KV Interface — matches Workers KV semantics for local dev
// ═══════════════════════════════════════════════════════════════════════════

export interface KvStore {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
  list(prefix: string | { prefix?: string }): Promise<{ keys: { name: string }[] }>
  delete(key: string): Promise<void>
}

// ═══════════════════════════════════════════════════════════════════════════
// MemoryKvStore — in-memory Map-based implementation for local dev
// ═══════════════════════════════════════════════════════════════════════════

export class MemoryKvStore implements KvStore {
  private store = new Map<string, string>()

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value)
  }

  async list(prefix: string | { prefix?: string }): Promise<{ keys: { name: string }[] }> {
    const searchPrefix = typeof prefix === 'string' ? prefix : (prefix.prefix ?? '')
    const keys: { name: string }[] = []
    for (const name of this.store.keys()) {
      if (name.startsWith(searchPrefix)) {
        keys.push({ name })
      }
    }
    return { keys }
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DesignArtifact Schema and Type
// ═══════════════════════════════════════════════════════════════════════════

export const designArtifactTypeSchema = z.enum(['page', 'calculator', 'theme'])

export const designArtifactSchema = z.object({
  id: z.string().min(1),
  type: designArtifactTypeSchema,
  layout: layoutDefinitionSchema,
  schema: z.record(z.string(), z.unknown()).optional(),
  theme: z.record(z.string(), z.unknown()).optional(),
})

export type DesignArtifact = z.infer<typeof designArtifactSchema>

// ═══════════════════════════════════════════════════════════════════════════
// Simple content hashing for idempotency
// ═══════════════════════════════════════════════════════════════════════════

function hashArtifact(artifact: DesignArtifact): string {
  const str = JSON.stringify({
    id: artifact.id,
    type: artifact.type,
    layout: artifact.layout,
    schema: artifact.schema,
    theme: artifact.theme,
  })
  // Simple hash function for idempotency comparison
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0 // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36)
}

// ═══════════════════════════════════════════════════════════════════════════
// Type-specific key prefixes
// ═══════════════════════════════════════════════════════════════════════════

function keyPrefix(type: string): string {
  switch (type) {
    case 'calculator': return 'calc:'
    case 'page':       return 'page:'
    case 'theme':      return 'theme:'
    default:           return 'art:'
  }
}

function latestKey(type: string, id: string): string {
  return `${keyPrefix(type)}${id}:latest`
}

function versionKey(type: string, id: string, version: string): string {
  return `${keyPrefix(type)}${id}:${version}`
}

// ═══════════════════════════════════════════════════════════════════════════
// publishArtifact — idempotent, versioned artifact publishing
// ═══════════════════════════════════════════════════════════════════════════

export async function publishArtifact(
  kv: KvStore,
  artifact: DesignArtifact,
  db?: unknown,  // D1 binding for atomic versioning
): Promise<{ version: string; url: string }> {
  const parsed = artifact
  const prefix = keyPrefix(parsed.type)
  const lKey = latestKey(parsed.type, parsed.id)

  // 1. Idempotency check — hash the artifact, compare to stored latest
  const newHash = hashArtifact(parsed)
  const existingLatest = await kv.get(lKey)

  if (existingLatest) {
    try {
      const parsedExisting = JSON.parse(existingLatest)
      if (parsedExisting.hash === newHash) {
        return {
          version: parsedExisting.version,
          url: `/calculator/${parsed.id}`,
        }
      }
    } catch {
      // Stored value is corrupt; proceed
    }
  }

  // 2. Determine new version number via D1 atomic counter
  let nextVersionNumber = 1

  if (db) {
    const { nextArtifactVersion } = await import('./version-counter')
    try {
      nextVersionNumber = await nextArtifactVersion(db, 'system', parsed.id)
    } catch {
      nextVersionNumber = await scanVersionFromKv(kv, prefix, parsed.id)
    }
  } else {
    nextVersionNumber = await scanVersionFromKv(kv, prefix, parsed.id)
  }

  const version = `v${nextVersionNumber}`
  const vKey = versionKey(parsed.type, parsed.id, version)

  // 3. Persist
  await kv.put(vKey, JSON.stringify(parsed))

  // 4. Update latest pointer
  await kv.put(lKey, JSON.stringify({
    version,
    hash: newHash,
    type: parsed.type,
    id: parsed.id,
  }))

  // 5. Return
  const url = parsed.type === 'calculator'
    ? `/calculator/${parsed.id}`
    : parsed.type === 'page'
      ? `/page/${parsed.id}`
      : `/theme/${parsed.id}`

  return { version, url }
}

/**
 * Version scan — hard fails if called without D1.
 * KV.list() is forbidden. D1 atomic versioning is the only path.
 */
async function scanVersionFromKv(
  _kv: KvStore,
  _prefix: string,
  _id: string,
): Promise<number> {
  throw new Error(
    'Cannot determine version: D1 binding (DB) is required for atomic versioning. ' +
    'KV.list()-based fallback has been removed for safety. ' +
    'Ensure wrangler.json has a D1 database binding named "DB".'
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// readArtifact — retrieve latest version of an artifact from KV
// ═══════════════════════════════════════════════════════════════════════════

export async function readArtifact(
  kv: KvStore,
  type: string,
  id: string,
): Promise<DesignArtifact | null> {
  const lKey = latestKey(type, id)
  const latestInfo = await kv.get(lKey)
  if (!latestInfo) return null

  try {
    const parsedInfo = JSON.parse(latestInfo)
    const version = parsedInfo.version
    if (!version) return null

    const vKey = versionKey(type, id, version)
    const artifactData = await kv.get(vKey)
    if (!artifactData) return null

    return JSON.parse(artifactData) as DesignArtifact
  } catch {
    return null
  }
}
