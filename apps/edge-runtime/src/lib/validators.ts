/**
 * EdgeGDE — Authoritative KV Schema Validation
 * Dual-invariant enforcement: key prefix + entry.type.
 * Shared single source of truth used by kv.ts, admin API, and queue workers.
 *
 * @packageDocumentation
 */

export type EntryType = 'knowledge' | 'compliance'

export function validateKnowledgeEntry(entry: any): void {
  if (entry.type !== 'knowledge') {
    throw new Error("Entry must have type: 'knowledge'")
  }
  if (!entry.id || !entry.value || !entry.description || !entry.source_ref || !entry.updated_at) {
    throw new Error('Invalid knowledge entry structure — missing required fields')
  }
}

export function validateComplianceEntry(entry: any): void {
  if (entry.type !== 'compliance') {
    throw new Error("Entry must have type: 'compliance'")
  }
  if (!entry.id || !entry.value || !entry.description || !entry.trigger || !entry.source_ref || !entry.updated_at) {
    throw new Error('Invalid compliance entry — missing required fields')
  }
}

export function validateKnowledgePayload(data: any, topic: string): void {
  if (!data || !Array.isArray(data.entries)) {
    throw new Error('Payload must contain entries array')
  }
  for (const entry of data.entries) {
    if (topic === 'compliance') {
      validateComplianceEntry(entry)
    } else {
      validateKnowledgeEntry(entry)
    }
  }
}

export function validateSiteManifest(data: any): void {
  if (!data.kb_blocks || !Array.isArray(data.kb_blocks)) {
    throw new Error('Invalid site manifest: kb_blocks required')
  }
  if (!data.fields_priority || !Array.isArray(data.fields_priority)) {
    throw new Error('Invalid site manifest: fields_priority required')
  }
}

/**
 * Check if a key is a structured knowledge key (requires schema validation).
 */
function isStructuredKey(key: string): boolean {
  return /^kb(:|_pending:|_rejected:)/.test(key) || key.startsWith('site:')
}

/**
 * Single entry point — validates payload for a given KV storage key.
 * Key is expected in short form (e.g. "kb:rates", "site:manifest").
 * Non-structured keys pass through without validation.
 */
export function validateStoragePayload(key: string, parsed: any): void {
  if (!isStructuredKey(key)) {
    return // allow primitive / transient keys
  }

  if (key.startsWith('site:')) {
    validateSiteManifest(parsed)
    return
  }

  // kb:, kb_pending:, kb_rejected: — extract topic after the prefix
  // kb:rates → rates
  // kb_pending:rates → pending:rates? No, kb_pending:rates → rates
  // Actually: kb:rates → parts: ['kb', 'rates'] → topic = 'rates'
  // kb_pending:rates → parts: ['kb_pending', 'rates'] → topic = 'rates'
  const parts = key.split(':')
  const topic = parts[1]
  validateKnowledgePayload(parsed, topic)
}
