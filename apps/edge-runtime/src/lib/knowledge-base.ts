/**
 * EdgeGDE — Knowledge Base Loader
 * Loads KB topics in parallel, one KV read per topic per request.
 * Formats structured entries into human-readable text for LLM injection.
 *
 * Read-only context — never mutates state.
 */

interface KbEntry {
  id: string
  value: string | number
  unit?: string
  description?: string
  sourceRef?: string
}

interface KbTopic {
  entries: KbEntry[]
  updated_at?: number
}

export async function loadKnowledgeBase(
  kv: any,
  tenantId: string,
  topics: string[],
): Promise<Record<string, string>> {
  if (!kv || topics.length === 0) return {}

  const entries = await Promise.all(
    topics.map(async (topic) => {
      try {
        const raw = await kv.get(`tenant:${tenantId}:kb:${topic}`)
        if (!raw) return [topic, ''] as [string, string]

        // Try to parse as structured KB, fall back to raw string
        try {
          const parsed: KbTopic = JSON.parse(raw)
          if (parsed.entries?.length) {
            const formatted = parsed.entries
              .map(e => `- ${e.value}${e.unit ? ` (${e.unit})` : ''}${e.description ? `: ${e.description}` : ''}`)
              .join('\n')
            return [topic, formatted] as [string, string]
          }
        } catch {}
        return [topic, raw] as [string, string]
      } catch {
        return [topic, ''] as [string, string]
      }
    }),
  )

  return Object.fromEntries(entries.filter(([, v]) => v))
}

/**
 * Format KB context for LLM prompt injection.
 */
export function formatKbContext(kb: Record<string, string>): string {
  const entries = Object.entries(kb)
  if (entries.length === 0) return ''

  return (
    'Knowledge Base:\n' +
    entries
      .map(([topic, content]) => `[${topic}]\n${content}`)
      .join('\n\n')
  )
}
