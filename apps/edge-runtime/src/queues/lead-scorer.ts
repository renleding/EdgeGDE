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
import { guardDB } from '../lib/db'
import { guardKV } from '../lib/kv'
import type { Env } from '../lib/env'

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

async function queue(batch: MessageBatch, env: Env, _ctx: ExecutionContext): Promise<void> {
// eslint-disable-next-line local/no-raw-storage-access
  const db = guardDB(env.DB)
// eslint-disable-next-line local/no-raw-storage-access
  const kv = guardKV(env.TENANT_KV)

  for (const msg of batch.messages) {
    const body = msg.body as LeadMessage & { type?: string; eventType?: string; sessionId?: string }
    const { submissionId, tenantId, payload } = body
    const ctx = { tenantId }

    // ═══ TYPE-BASED ROUTING ═══
    if (body.type === 'execute_automation') {
      const eventType = body.eventType
      const appId = body.sessionId || ''

      if (eventType === 'financial_baseline_declared' && appId) {
        // Run affordability + risk agents
        console.warn('[swarm] running affordability + risk for app', appId)
        try {
          const row = await db.first<{
            target_loan_amount: number | null
            collected_financials_json: string | null
            kyc_status: string | null
          }>(
            ctx,
            `SELECT target_loan_amount, collected_financials_json,
                    (SELECT verification_status FROM application_documents WHERE application_id = ? LIMIT 1) as kyc_status
             FROM applications WHERE id = ?`,
            [appId, appId],
          )

          if (row?.collected_financials_json) {
            const fin = JSON.parse(row.collected_financials_json) as {
              income?: number
              expenses?: number
            }
            const { computeAffordability } = await import('../lib/agents')
            const { computeRisk } = await import('../lib/agents')

            const aff = computeAffordability({
              income: fin.income || 0, expenses: fin.expenses || 0,
              targetLoanAmount: row.target_loan_amount || 0,
            })

            const risk = computeRisk({
              kycStatus: row.kyc_status || 'pending',
              debtRatio: aff.debtRatio, affordabilityScore: aff.affordabilityScore,
            })

            const doBinding = env.AUDIT_LEDGER
            if (doBinding?.idFromName) {
              const doId = doBinding.idFromName(`tenant:${tenantId}`)
              const stub = doBinding.get(doId)
              stub.fetch('http://do/append', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'affordability_assessed', actor: 'mcp_swarm_engine', tenantId, sessionId: appId, submissionId: appId, data: { application_id: appId, ...aff } }),
              }).catch(() => {})
              stub.fetch('http://do/append', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'risk_profile_generated', actor: 'mcp_swarm_engine', tenantId, sessionId: appId, submissionId: appId, data: { application_id: appId, ...risk } }),
              }).catch(() => {})
            }
          }
        } catch (e) { console.warn('[swarm] agent execution failed:', e) }
      }

      if (eventType === 'document_securely_stored' && appId) {
        // Run readiness agent
        console.warn('[swarm] running readiness for app', appId)
        try {
          const docsResult = await db.all<{ document_type: string; verification_status: string }>(
            ctx,
            `SELECT document_type, verification_status FROM application_documents WHERE application_id = ?`,
            [appId],
          )
          const docs = docsResult?.results || []

          const row = await db.first<{ kyc_status: string | null }>(
            ctx,
            `SELECT (SELECT verification_status FROM application_documents WHERE application_id = ? LIMIT 1) as kyc_status`,
            [appId],
          )

          const { computeReadiness } = await import('../lib/agents')
          const ready = computeReadiness({
            kycStatus: row?.kyc_status || 'pending',
            documentRecords: docs.map((d) => d.document_type),
          })

          const doBinding = env.AUDIT_LEDGER
          if (doBinding?.idFromName) {
            const doId = doBinding.idFromName(`tenant:${tenantId}`)
            const stub = doBinding.get(doId)
            stub.fetch('http://do/append', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'application_readiness_evaluated', actor: 'mcp_swarm_engine', tenantId, sessionId: appId, submissionId: appId, data: { application_id: appId, ...ready } }),
            }).catch(() => {})
          }
        } catch (e) { console.warn('[swarm] readiness execution failed:', e) }
      }

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
      // Uses guardDB insert/update — single write per LLM call vs KV read-modify-write
      try {
// eslint-disable-next-line local/no-raw-storage-access
        if (env.DB) {
          const today = new Date().toISOString().slice(0, 10)
          const isSuccess = llm.rationale !== 'LLM unavailable — scored deterministically only.' && llm.rationale !== 'LLM response parse failure.'

          // Check if telemetry row exists for this tenant+date
          const existing = await db.first<{
            llm_calls: number
            llm_success: number
            llm_fail: number
            total_latency_ms: number
            red_flag_count: number
            total_agentic_score: number
          }>(
            ctx,
            'SELECT llm_calls, llm_success, llm_fail, total_latency_ms, red_flag_count, total_agentic_score FROM telemetry_daily WHERE date = ?',
            [today],
          )

          if (existing) {
            await db.update(ctx, 'telemetry_daily', {
              llm_calls: existing.llm_calls + 1,
              llm_success: existing.llm_success + (isSuccess ? 1 : 0),
              llm_fail: existing.llm_fail + (isSuccess ? 0 : 1),
              total_latency_ms: existing.total_latency_ms + llmLatency,
              red_flag_count: existing.red_flag_count + (llm.redFlag ? 1 : 0),
              total_agentic_score: existing.total_agentic_score + llm.agenticScore,
            }, 'date = ?', [today])
          } else {
            await db.insert(ctx, 'telemetry_daily', {
              date: today,
              llm_calls: 1,
              llm_success: isSuccess ? 1 : 0,
              llm_fail: isSuccess ? 0 : 1,
              total_latency_ms: llmLatency,
              red_flag_count: llm.redFlag ? 1 : 0,
              total_agentic_score: llm.agenticScore,
            })
          }
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
// eslint-disable-next-line local/no-raw-storage-access
          if (env.DB) {
            const email = contactInfo.email.toLowerCase().trim()
            const phone = contactInfo.phone.replace(/\D/g, '')
            const name = contactInfo.name.trim() || 'Unknown'

            // Try email match first, then phone
            let contact: { id: string; name: string } | null = null
            if (email) {
              contact = await db.first(
                ctx,
                `SELECT id, name FROM contacts WHERE email = ? LIMIT 1`,
                [email],
              )
            }
            if (!contact && phone) {
              contact = await db.first(
                ctx,
                `SELECT id, name FROM contacts WHERE phone = ? LIMIT 1`,
                [phone],
              )
            }

            if (contact) {
              contactId = contact.id as string
              // Update name if richer
              if (name.length > (contact.name as string).length) {
                await db.update(ctx, 'contacts', { name }, 'id = ?', [contactId])
              }
            } else {
              // Create new contact
              contactId = crypto.randomUUID()
              await db.insert(ctx, 'contacts', {
                id: contactId,
                name,
                email,
                phone,
              })
            }
          }
        } catch (err) { console.warn('[contact] resolution failed:', err) }
      }

      // ── 5. Persist to D1 ──────────────────────────────────────────────
// eslint-disable-next-line local/no-raw-storage-access
      if (env.DB) {
        await db.update(
          ctx,
          'form_submissions',
          {
            lead_score: totalScore,
            deterministic_score: det.score,
            score_band: band,
            score_rationale: rationale,
            contact_id: contactId,
            current_stage: 'new_lead',
          },
          'id = ?',
          [submissionId],
        )

        // ── 5. Action triggers ──────────────────────────────────────────
        if (totalScore >= 80) {
          // Hot lead — trigger broker alert
          try {
// eslint-disable-next-line local/no-raw-storage-access
            if (env.TENANT_KV) {
              await kv.put(
                `tenant:${tenantId}:alert:hot:${submissionId}`,
                JSON.stringify({ score: totalScore, rationale, submissionId }),
                ctx,
                { expirationTtl: 259200 },
              )

              // Maintain index pointer (prepend newest first)
              const indexKey = `tenant:${tenantId}:alerts:hot:index`
              const existingRaw = await kv.get(indexKey, ctx)
              const existing: string[] = existingRaw
                ? JSON.parse(existingRaw)
                : []
              // Prepend, dedupe, cap at 100
              const updated = [submissionId, ...existing.filter((id: string) => id !== submissionId)].slice(0, 100)
              await kv.put(indexKey, JSON.stringify(updated), ctx)

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
// eslint-disable-next-line local/no-raw-storage-access
            if (env.TENANT_KV) {
              await kv.put(
                `tenant:${tenantId}:nurture:${submissionId}`,
                JSON.stringify({ score: totalScore, submissionId }),
                ctx,
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
