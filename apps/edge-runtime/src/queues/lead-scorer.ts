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

// ═══════════════════════════════════════════════════════════════════════════
// Deterministic Engine (70 points — FNS40821 baseline)
// ═══════════════════════════════════════════════════════════════════════════

interface DeterministicInput {
  propertyValue?: number
  loanAmount?: number
  deposit?: number
  employmentType?: string
}

interface DeterministicResult {
  score: number
  details: string[]
}

function computeDeterministic(input: DeterministicInput): DeterministicResult {
  let score = 30          // base
  const details: string[] = [`Base: 30`]

  // LVR
  const lvr =
    input.loanAmount && input.propertyValue
      ? (input.loanAmount / input.propertyValue) * 100
      : null

  if (lvr !== null) {
    if (lvr < 80) {
      score += 20
      details.push(`LVR ${lvr.toFixed(1)}% < 80%: +20`)
    } else if (lvr <= 90) {
      score += 10
      details.push(`LVR ${lvr.toFixed(1)}% 80–90%: +10`)
    } else {
      details.push(`LVR ${lvr.toFixed(1)}% > 90%: +0 (high risk)`)
    }
  }

  // Employment type
  const emp = (input.employmentType || '').toLowerCase()
  if (emp === 'payg' || emp === 'full-time' || emp === 'part-time') {
    score += 20
    details.push(`Employment ${emp}: +20`)
  } else if (emp === 'self-employed' || emp === 'self employed') {
    details.push(`Employment self-employed: +0 (requires BAS review)`)
  }

  return { score: Math.min(score, 70), details }
}

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
}

// ═══════════════════════════════════════════════════════════════════════════
// Queue Consumer Entry Point
// ═══════════════════════════════════════════════════════════════════════════

async function queue(batch: any, env: any, _ctx: ExecutionContext): Promise<void> {
  for (const msg of batch.messages) {
    const body = msg.body as LeadMessage
    const { submissionId, tenantId, payload } = body

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

      // ── Telemetry: log LLM metrics to TELEMETRY_KV ───────────────────
      try {
        const telemetryKv = env.TELEMETRY_KV as any
        if (telemetryKv && typeof telemetryKv.put === 'function') {
          const today = new Date().toISOString().slice(0, 10)
          const telemetryKey = `tenant:${tenantId}:telemetry:llm:${today}`
          const existingRaw = await telemetryKv.get(telemetryKey)
          const existing: any[] = existingRaw ? JSON.parse(existingRaw) : []
          existing.push({
            submissionId,
            tenantId,
            success: llm.rationale !== 'LLM unavailable — scored deterministically only.' && llm.rationale !== 'LLM response parse failure.',
            latencyMs: llmLatency,
            agenticScore: llm.agenticScore,
            redFlag: llm.redFlag,
            ts: Date.now(),
          })
          // Cap to 500 entries per day
          const pruned = existing.slice(-500)
          await telemetryKv.put(telemetryKey, JSON.stringify(pruned), { expirationTtl: 86400 * 90 })

          // Maintain daily index pointer (last 30 days)
          const indexKey = `tenant:${tenantId}:telemetry:llm:days:index`
          const indexRaw = await telemetryKv.get(indexKey)
          const days: string[] = indexRaw ? JSON.parse(indexRaw) : []
          if (!days.includes(today)) {
            const updated = [today, ...days].slice(0, 30)
            await telemetryKv.put(indexKey, JSON.stringify(updated))
          }
        }
      } catch { /* non-blocking */ }

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

      // ── 4. Persist to D1 ──────────────────────────────────────────────
      const db = env.DB as any
      if (db && typeof db.prepare === 'function') {
        await db
          .prepare(
            `UPDATE form_submissions
             SET lead_score = ?, deterministic_score = ?, score_band = ?, score_rationale = ?
             WHERE id = ?`,
          )
          .bind(totalScore, det.score, band, rationale, submissionId)
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
      // Retry up to 3 times, then send to dead-letter
      msg.retry({ retriesLeft: msg.attempts < 3 ? 3 - msg.attempts : 0 })
    }
  }
}

export default { queue }
