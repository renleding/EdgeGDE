/**
 * EdgeGDE — Lead Scoring Queue Consumer
 * Track 4 Phase 5: Asynchronous scoring triggered via Cloudflare Queue.
 *
 * 70% deterministic (FNS40821 rules) + 30% LLM agentic signal.
 * Runs off the hot path — never blocks API responses.
 *
 * @packageDocumentation
 */

import { broadcast } from '../lib/sse'
import { computeDeterministic } from '../lib/scoring-engine'
import type { DeterministicInput } from '../lib/scoring-engine'

// ═══════════════════════════════════════════════════════════════════════════
// LLM Agentic Signal (30 points)
// ═══════════════════════════════════════════════════════════════════════════

interface LlmResult {
  agenticScore: number
  rationale: string
  redFlag: boolean
}

async function computeLlmSignal(
  payload: Record<string, unknown>,
  apiKey: string,
): Promise<LlmResult> {
  const prompt = `You are an Australian mortgage lead scoring assistant (FNS40821).

Analyze this lead submission and return a JSON object with exactly three fields:

{
  "agentic_score": <0–30 integer>,
  "rationale": "<2-sentence explanation>",
  "red_flag": <true|false>
}

Scoring rules:
- Urgency (timeframe: "asap", "next month", "pre-approved"): +15–30
- High intent (specific property, dollar amounts, pre-approval mentioned): +10–20
- Just browsing / no timeframe: +0–5
- Red flag detection (if true, cap total at 50):
  - Self-employed without BAS history reference
  - Severely low deposit (< 5%)
  - Complex income structures

Lead data:
${JSON.stringify(payload, null, 2)}`

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek/deepseek-v4-flash',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 300,
    }),
  })

  if (!res.ok) {
    return {
      agenticScore: 0,
      rationale: 'LLM unavailable — scored deterministically only.',
      redFlag: false,
    }
  }

  const body: any = await res.json()
  try {
    const parsed = JSON.parse(body.choices?.[0]?.message?.content || '{}')
    return {
      agenticScore: Math.min(Math.max(Math.round(parsed.agentic_score ?? 0), 0), 30),
      rationale: parsed.rationale || '',
      redFlag: !!parsed.red_flag,
    }
  } catch {
    return { agenticScore: 0, rationale: 'LLM response parse failure.', redFlag: false }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Score Band Helper
// ═══════════════════════════════════════════════════════════════════════════

function scoreBand(score: number): 'hot' | 'warm' | 'cold' {
  if (score >= 80) return 'hot'
  if (score >= 50) return 'warm'
  return 'cold'
}

// ═══════════════════════════════════════════════════════════════════════════
// Message Shape
// ═══════════════════════════════════════════════════════════════════════════

export interface LeadMessage {
  submissionId: string
  tenantId: string
  formId: string
  payload: Record<string, unknown>
  contactInfo?: {
    name: string
    email: string
    phone: string
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Queue Consumer Entry Point
// ═══════════════════════════════════════════════════════════════════════════

async function queue(batch: any, env: any, _ctx: ExecutionContext): Promise<void> {
  for (const msg of batch.messages) {
    const body = msg.body as any
    const { submissionId, tenantId, payload } = body

    // ═══ TYPE-BASED ROUTING ═══ — support automation events on the same queue
    if (body.type === 'execute_automation') {
      console.log('[queue] automation event', { ruleId: body.ruleId, tenantId })
      msg.ack()
      continue
    }

    try {
      // ── 1. Deterministic 70% ──────────────────────────────────────────
      const det = computeDeterministic(payload)

      // ── 2. LLM 30% (silently skip if no API key) ──────────────────────
      const llmApiKey = env.LLM_API_KEY as string | undefined
      let llmLatency = 0
      const llmStart = Date.now()
      const llm = llmApiKey
        ? await computeLlmSignal(payload, llmApiKey)
        : { agenticScore: 0, rationale: 'LLM scoring not configured.', redFlag: false }
      llmLatency = Date.now() - llmStart

      // ── Telemetry: aggregate to D1 (replaces per-call TELEMETRY_KV append) ──
      // Uses atomic UPSERT — single write per LLM call vs KV read-modify-write
      try {
        const db2 = env.DB as any
        if (db2 && typeof db2.prepare === 'function') {
          const today = new Date().toISOString().slice(0, 10)
          const isSuccess = llm.rationale !== 'LLM unavailable — scored deterministically only.' && llm.rationale !== 'LLM response parse failure.'
          await db2.prepare(`
            INSERT INTO telemetry_daily (tenant_id, date, llm_calls, llm_success, llm_fail, total_latency_ms, red_flag_count, total_agentic_score, updated_at)
            VALUES (?, ?, 1, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(tenant_id, date) DO UPDATE SET
              llm_calls = llm_calls + 1,
              llm_success = llm_success + excluded.llm_success,
              llm_fail = llm_fail + excluded.llm_fail,
              total_latency_ms = total_latency_ms + excluded.total_latency_ms,
              red_flag_count = red_flag_count + excluded.red_flag_count,
              total_agentic_score = total_agentic_score + excluded.total_agentic_score,
              updated_at = CURRENT_TIMESTAMP
          `).bind(
            tenantId,
            today,
            isSuccess ? 1 : 0,
            isSuccess ? 0 : 1,
            llmLatency,
            llm.redFlag ? 1 : 0,
            llm.agenticScore,
          ).run()
        }
      } catch { /* non-blocking — telemetry loss is acceptable */ }

      // ── 3. Composite score ────────────────────────────────────────────
      let totalScore = det.score + llm.agenticScore

      // Compliance cap: red flag detected
      if (llm.redFlag) {
        totalScore = Math.min(totalScore, 50)
      }

      const band = scoreBand(totalScore)
      const rationale = [
        `Deterministic (FNS40821): ${det.score}/70.`,
        llm.rationale,
      ].join(' ')

      // ── 4. Contact Resolution ─────────────────────────────────────────
      let contactId = ''
      const contactInfo = body.contactInfo
      if (contactInfo && (contactInfo.email || contactInfo.phone)) {
        try {
          const db2 = env.DB as any
          if (db2 && typeof db2.prepare === 'function') {
            const email = contactInfo.email.toLowerCase().trim()
            const phone = contactInfo.phone.replace(/\D/g, '')
            const name = contactInfo.name.trim() || 'Unknown'

            // Try email match first, then phone
            let contact: any = null
            if (email) {
              contact = await db2.prepare(
                `SELECT id, name FROM contacts WHERE tenant_id = ? AND email = ? LIMIT 1`
              ).bind(tenantId, email).first()
            }
            if (!contact && phone) {
              contact = await db2.prepare(
                `SELECT id, name FROM contacts WHERE tenant_id = ? AND phone = ? LIMIT 1`
              ).bind(tenantId, phone).first()
            }

            if (contact) {
              contactId = contact.id as string
              // Update name if richer
              if (name.length > (contact.name as string).length) {
                await db2.prepare(
                  `UPDATE contacts SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
                ).bind(name, contactId).run()
              }
            } else {
              // Create new contact
              contactId = crypto.randomUUID()
              await db2.prepare(
                `INSERT INTO contacts (id, tenant_id, name, email, phone) VALUES (?, ?, ?, ?, ?)`
              ).bind(contactId, tenantId, name, email, phone).run()
            }
          }
        } catch (err) { console.warn('[contact] resolution failed:', err) }
      }

      // ── 5. Persist to D1 ──────────────────────────────────────────────
      const db = env.DB as any
      if (db && typeof db.prepare === 'function') {
        await db
          .prepare(
            `UPDATE form_submissions
             SET lead_score = ?, deterministic_score = ?, score_band = ?, score_rationale = ?,
                 contact_id = ?, current_stage = ?
             WHERE id = ?`,
          )
          .bind(totalScore, det.score, band, rationale, contactId, 'new_lead', submissionId)
          .run()

        // ── 5. Action triggers ──────────────────────────────────────────
        if (totalScore >= 80) {
          // Hot lead — trigger broker alert
          try {
            const kv = env.TENANT_KV as any
            if (kv && typeof kv.put === 'function') {
              await kv.put(
                `tenant:${tenantId}:alert:hot:${submissionId}`,
                JSON.stringify({ score: totalScore, rationale, submissionId }),
                { expirationTtl: 259200 },
              )

              // Maintain index pointer (prepend newest first)
              const indexKey = `tenant:${tenantId}:alerts:hot:index`
              const existingRaw = await kv.get(indexKey)
              const existing: string[] = existingRaw
                ? JSON.parse(existingRaw)
                : []
              // Prepend, dedupe, cap at 100
              const updated = [submissionId, ...existing.filter((id: string) => id !== submissionId)].slice(0, 100)
              await kv.put(indexKey, JSON.stringify(updated))

              // Broadcast to SSE subscribers
              broadcast(tenantId, 'hot_lead', {
                submissionId,
                tenantId,
                score: totalScore,
                rationale,
                ts: Date.now(),
              })
            }
          } catch { /* non-blocking */ }
        }

        if (totalScore < 50) {
          // Cold lead — tag for nurture sequence
          try {
            const kv = env.TENANT_KV as any
            if (kv && typeof kv.put === 'function') {
              await kv.put(
                `tenant:${tenantId}:nurture:${submissionId}`,
                JSON.stringify({ score: totalScore, submissionId }),
                { expirationTtl: 604800 },
              )
            }
          } catch { /* non-blocking */ }
        }
      }

      msg.ack()
    } catch (err) {
      console.error(`[lead-scorer] Failed for ${submissionId}:`, err)
      // Platform manages retries via wrangler.json max_retries: 3
      msg.retry()
    }
  }
}

export default { queue }
