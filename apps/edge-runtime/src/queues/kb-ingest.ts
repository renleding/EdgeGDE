/**
 * EdgeGDE — Knowledge Base Ingestion Worker
 * R2-first pipeline: fetch → R2 → enqueue → extract → normalize → kb_pending
 * Schema gate in kv.ts enforces type + field correctness on write.
 *
 * @packageDocumentation
 */

import { guardKV } from '../lib/kv'

interface KbIngestMessage {
  tenantId: string
  topic?: string
  url?: string
  filePath?: string
  r2Key?: string       // set after initial fetch+store
  sourceRef?: string
}

interface NormalizedEntry {
  type: 'knowledge' | 'compliance'
  id: string
  value: string
  description: string
  source_ref: string
  updated_at: number
  trigger?: string     // compliance only
}

// ═══════════════════════════════════════════════════════════════════════════
// Stable ID from text using Web Crypto API
// ═══════════════════════════════════════════════════════════════════════════

async function makeStableId(text: string): Promise<string> {
  const encoder = new TextEncoder()
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(text))
  return Array.from(new Uint8Array(hash))
    .slice(0, 8)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// ═══════════════════════════════════════════════════════════════════════════
// Topic classification (deterministic pattern matching)
// ═══════════════════════════════════════════════════════════════════════════

function classifyTopic(text: string): string {
  const lower = text.toLowerCase()
  if (/%/.test(text) && /\b(rate|interest|variable|fixed|p\.a\.|p.a)\b/.test(lower)) return 'rates'
  if (/\b(loan|product|mortgage|home\s?loan|offset|redraw|feature)\b/.test(lower)) return 'products'
  if (/\b(must|require|need|eligible|minimum|condition|policy|document)\b/.test(lower)) return 'policy'
  if (/\b(fee|cost|charge|annual|monthly|establishment)\b/.test(lower)) return 'fees'
  return 'general'
}

// ═══════════════════════════════════════════════════════════════════════════
// Entry cleaning & filtering
// ═══════════════════════════════════════════════════════════════════════════

function filterRawEntries(entries: { value: string }[]): { value: string }[] {
  return entries
    .filter(e => {
      const v = String(e.value)
      return v.length >= 8 && v.length < 120 && /\d|%|\$/.test(v)
    })
    .slice(0, 50)
}

// ═══════════════════════════════════════════════════════════════════════════
// Text extraction from HTML
// ═══════════════════════════════════════════════════════════════════════════

function extractTextFromHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim()
    .substring(0, 10000)
}

// ═══════════════════════════════════════════════════════════════════════════
// Fetch URL → store in R2 → return R2 key + parsed text
// ═══════════════════════════════════════════════════════════════════════════

async function fetchAndStoreToR2(
  env: any, tenantId: string, url: string
): Promise<{ r2Key: string; text: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  let html = ''
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'EdgeGDE-KB-Ingest/1.0' },
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)
    html = await res.text()
  } catch (err: any) {
    clearTimeout(timer)
    throw err
  }

  // Store raw HTML in R2
  const hash = await makeStableId(url)
  const r2Key = `tenant/${tenantId}/kb_sources/${hash}.html`
  await env.VAULT_BUCKET.put(r2Key, html)

  return { r2Key, text: extractTextFromHtml(html) }
}

// ═══════════════════════════════════════════════════════════════════════════
// KB entry extraction from plain text
// ═══════════════════════════════════════════════════════════════════════════

async function extractSentences(text: string): Promise<{ value: string }[]> {
  const sentences = text.match(/[^.!?\n]+[.!?]/g) || []
  const raw: { value: string }[] = []

  for (let i = 0; i < Math.min(sentences.length, 100); i++) {
    const s = sentences[i].trim()
    if (s.length < 10) continue
    if (/^(home|about|contact|sign\s?in|register|copyright|privacy|menu|search)/i.test(s)) continue
    raw.push({ value: s.length > 200 ? s.substring(0, 200) + '...' : s })
  }

  return filterRawEntries(raw)
}

// ═══════════════════════════════════════════════════════════════════════════
// Normalize to typed entries (critical for kv.ts schema gate)
// ═══════════════════════════════════════════════════════════════════════════

function normalizeEntries(
  raw: { value: string }[],
  topic: string,
  sourceRef: string
): NormalizedEntry[] {
  const now = Date.now()
  const isCompliance = topic === 'compliance'

  return raw.map(e => {
    const base = {
      id: e.value.substring(0, 32).replace(/\s+/g, '_').toLowerCase(),
      value: e.value,
      description: `Extracted from ${sourceRef}`,
      source_ref: sourceRef,
      updated_at: now,
    }

    if (isCompliance) {
      return {
        ...base,
        type: 'compliance' as const,
        trigger: extractTrigger(e.value),
      }
    }

    return {
      ...base,
      type: 'knowledge' as const,
    }
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// Simple trigger extraction for compliance entries
// ═══════════════════════════════════════════════════════════════════════════

function extractTrigger(text: string): string {
  if (text.includes('%') && /\b(deposit|rate|interest)\b/i.test(text)) return 'rate_or_deposit_related'
  if (/\b(must|require|need|eligible|minimum)\b/i.test(text)) return 'eligibility_condition'
  return 'always'
}

// ═══════════════════════════════════════════════════════════════════════════
// Write to KV pending (not kb: — human review required)
// ═══════════════════════════════════════════════════════════════════════════

async function writeKbPending(env: any, tenantId: string, topic: string, entries: NormalizedEntry[], r2Key: string): Promise<void> {
  if (entries.length === 0) return

  const kv = guardKV(env.TENANT_KV)
  const key = `tenant:${tenantId}:kb_pending:${topic}`
  await kv.put(
    key,
    JSON.stringify({
      entries,
      source_ref: r2Key,
      ingested_at: Date.now(),
    }),
    { tenantId }
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Main handler
// ═══════════════════════════════════════════════════════════════════════════

export async function handleKbIngest(message: KbIngestMessage, env: any): Promise<void> {
  const { tenantId, url, filePath, r2Key: existingR2Key } = message
  if (!tenantId) throw new Error('tenantId required')

  let rawText: string
  let sourceRef: string

  if (url) {
    // R2-first: fetch → store in R2 → use R2 text
    const result = await fetchAndStoreToR2(env, tenantId, url)
    sourceRef = result.r2Key
    rawText = result.text
  } else if (filePath) {
    // Read from existing R2 key
    sourceRef = filePath
    const r2 = env?.VAULT_BUCKET
    if (!r2) throw new Error('VAULT_BUCKET binding required')
    const obj = await r2.get(filePath)
    if (!obj) throw new Error(`File not found: ${filePath}`)
    const html = new TextDecoder().decode(await obj.arrayBuffer())
    rawText = extractTextFromHtml(html)
  } else if (existingR2Key) {
    // Already enqueued with R2 key — just read
    sourceRef = existingR2Key
    const r2 = env?.VAULT_BUCKET
    if (!r2) throw new Error('VAULT_BUCKET binding required')
    const obj = await r2.get(existingR2Key)
    if (!obj) throw new Error(`R2 source not found: ${existingR2Key}`)
    const html = new TextDecoder().decode(await obj.arrayBuffer())
    rawText = extractTextFromHtml(html)
  } else {
    throw new Error('url, filePath, or r2Key required')
  }

  if (!rawText || rawText.length < 10) throw new Error('Extracted text too short')

  const topic = message.topic || classifyTopic(rawText)
  const raw = await extractSentences(rawText)
  if (raw.length === 0) throw new Error('No extractable content found')

  // Normalize with type field (required by kv.ts schema gate)
  const entries = normalizeEntries(raw, topic, sourceRef)

  // Write to pending (kv.ts validates schema on put)
  await writeKbPending(env, tenantId, topic, entries, sourceRef)
  console.log(`[kb-ingest] Stored ${entries.length} entries in kb_pending:${topic} from ${sourceRef}`)
}
