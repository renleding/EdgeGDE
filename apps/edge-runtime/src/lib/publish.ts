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
  put(key: string, value: string): Promise<void>
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
): Promise<{ version: string; url: string }> {
  // 1. Validate artifact with Zod schema
  const parsed = designArtifactSchema.safeParse(artifact)
  if (!parsed.success) {
    throw new Error(
      `Artifact validation failed: ${parsed.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`,
      ).join('; ')}`,
    )
  }

  const validated = parsed.data
  const prefix = keyPrefix(validated.type)
  const lKey = latestKey(validated.type, validated.id)

  // 2. Idempotency check — hash the artifact, compare to stored latest
  const newHash = hashArtifact(validated)
  const existingLatest = await kv.get(lKey)

  if (existingLatest) {
    try {
      const parsedExisting = JSON.parse(existingLatest)
      if (parsedExisting.hash === newHash) {
        // Artifact is identical — return existing version info
        return {
          version: parsedExisting.version,
          url: `/calculator/${validated.id}`,
        }
      }
    } catch {
      // Stored value is corrupt; proceed to publish
    }
  }

  // 3. Determine new version number
  let nextVersionNumber = 1
  const existingKeys = await kv.list(prefix + validated.id + ':v')
  if (existingKeys.keys.length > 0) {
    const versions = existingKeys.keys
      .map((k) => {
        const match = k.name.match(/:v(\d+)$/)
        return match ? parseInt(match[1], 10) : 0
      })
      .filter((n) => n > 0)
    if (versions.length > 0) {
      nextVersionNumber = Math.max(...versions) + 1
    }
  }

  const version = `v${nextVersionNumber}`
  const vKey = versionKey(validated.type, validated.id, version)

  // 4. Persist the full artifact at the versioned key
  await kv.put(vKey, JSON.stringify(validated))

  // 5. Update the latest pointer with hash for idempotency
  await kv.put(lKey, JSON.stringify({
    version,
    hash: newHash,
    type: validated.type,
    id: validated.id,
  }))

  // 6. Return version and URL
  const url = validated.type === 'calculator'
    ? `/calculator/${validated.id}`
    : validated.type === 'page'
      ? `/page/${validated.id}`
      : `/theme/${validated.id}`

  return { version, url }
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
