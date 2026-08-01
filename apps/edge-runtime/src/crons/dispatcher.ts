/**
 * EdgeGDE — Hot Lead Dispatcher
 * Phase 6.5: Cron-triggered dispatch of hot lead alerts to external webhook.
 * Pointer-pure: reads KV index, no KV.list(), marks dispatched (no delete).
 *
 * @packageDocumentation
 */

import { guardDB } from '../lib/db'
import { guardKV } from '../lib/kv'
import { safeEnv } from '../lib/env'

export async function runDispatcher(env: any): Promise<void> {
  const rawKv = env.TENANT_KV
  const rawDb = safeEnv(env).DB
  const guardedDb = guardDB(rawDb)
  const webhookUrl = env.ALERT_WEBHOOK_URL as string | undefined

  if (!webhookUrl) {
    console.warn('[dispatcher] ALERT_WEBHOOK_URL not configured — skipping dispatch')
    return
  }

  try {
    // 1. Discover tenants from KV cache (600s TTL) or D1 fallback
    const cacheKey = 'tenants:active'
    let tenants: string[] = []
    try {
      const cached = await rawKv.get(cacheKey)
      if (cached) {
        tenants = JSON.parse(cached)
        console.log(`[dispatcher] cache hit: ${tenants.length} tenants`)
      }
    } catch { /* cache miss — fall through to D1 */ }

    if (tenants.length === 0) {
      // Cross-tenant query — cannot use guardDB (no single tenant context)
      const tenantsResult: any = await rawDb
        .prepare('SELECT DISTINCT tenant_id FROM form_submissions')
        .all()

      tenants = tenantsResult?.results?.map((r: any) => r.tenant_id) || []

      if (tenants.length > 0) {
        // Write back to cache with 10min TTL
        await rawKv.put(cacheKey, JSON.stringify(tenants), { expirationTtl: 600 })
      }
    }

    if (tenants.length === 0) {
      console.log('[dispatcher] no tenants found')
      return
    }

    console.log(`[dispatcher] scanning ${tenants.length} tenants`)

    for (const tenantId of tenants) {
      const ctx = { tenantId }
      const guardedKv = guardKV(rawKv)
      const indexKey = `tenant:${tenantId}:alerts:hot:index`

      const raw = await guardedKv.get(indexKey, ctx)
      if (!raw) continue

      let ids: string[]
      try {
        ids = JSON.parse(raw)
      } catch {
        continue
      }
      if (!Array.isArray(ids) || ids.length === 0) continue

      for (const submissionId of ids) {
        const key = `tenant:${tenantId}:alert:hot:${submissionId}`

        try {
          const payloadRaw = await guardedKv.get(key, ctx)
          if (!payloadRaw) continue

          const alert = JSON.parse(payloadRaw)

          // Skip if already dispatched
          if (alert.dispatched === true) continue

          // Dispatch webhook
          const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'hot_lead',
              tenantId,
              submissionId,
              score: alert.score,
              band: 'hot',
              rationale: alert.rationale,
              summary: `🔥 Hot Lead — Score ${alert.score}`,
              payload: alert.payload || {},
            }),
          })

          if (res.ok) {
            // Mark as dispatched (do NOT delete)
            const updated = {
              ...alert,
              dispatched: true,
              dispatched_at: Date.now(),
            }
            await guardedKv.put(key, JSON.stringify(updated), ctx)
            console.log(`[dispatcher] dispatched ${submissionId} for ${tenantId}`)
          } else {
            console.warn(`[dispatcher] webhook returned ${res.status} for ${submissionId}`)
          }
        } catch (err) {
          console.warn('[dispatcher] item failed', { tenantId, submissionId, err })
        }
      }
    }
  } catch (err) {
    console.error('[dispatcher] fatal error', err)
  }
}
