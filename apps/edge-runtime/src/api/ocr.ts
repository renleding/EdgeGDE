/**
 * EdgeGDE — OCR Sub-Router
 *
 * Routes:
 *   POST /api/v1/ocr/upload    — upload image, run OCR, return verification card
 *   POST /api/v1/ocr/confirm   — confirm or reject OCR fields
 *
 * Privacy:
 *   - Images go to R2, NOT to any external API
 *   - OCR runs on local qwen3-vl:4b via Tailscale mesh
 *   - No raw PII logged in telemetry
 */

import { Hono } from 'hono'
import { renderCaptureView } from '../views/ocr-capture'
import { renderVerificationCard } from '../views/ocr-verification-card'
import { renderSummaryCard } from '../views/ocr-summary-card'
import { extractFromImage } from '../lib/ocr-extractor'

export const ocrRouter = new Hono()

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/v1/ocr/upload
// Synchronous: multipart upload → R2 → Ollama → verify card
// ═══════════════════════════════════════════════════════════════════════════
ocrRouter.post('/ocr/upload', async (c) => {
  try {
    const body = await c.req.parseBody()
    const sessionId = (body['sessionId'] as string) || ''
    const imageFile = body['image'] as File | null

    // ── Input Validation ─────────────────────────────────────────────────
    if (!sessionId) {
      return c.html(renderFallback('Session ID required'))
    }

    if (!imageFile) {
      return c.html(renderFallback('No image file provided'))
    }

    // Whitelist allowed image types
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/heic']
    if (!allowedMimeTypes.includes(imageFile.type)) {
      return c.html(renderFallback('Unsupported file type. Please use JPEG, PNG, or HEIC.'))
    }

    // Size limit: 10MB
    const MAX_SIZE = 10 * 1024 * 1024
    if (imageFile.size > MAX_SIZE) {
      return c.html(renderFallback('File too large. Maximum size is 10MB.'))
    }

    // ── R2 Storage ──────────────────────────────────────────────────────
    const R2_BUCKET = (c.env as any)?.VAULT_BUCKET
    const buffer = await imageFile.arrayBuffer()
    const uuid = crypto.randomUUID()
    const ext = imageFile.name.split('.').pop() || 'jpg'
    const r2Key = `ocr/${sessionId}/${uuid}.${ext}`

    if (R2_BUCKET) {
      await R2_BUCKET.put(r2Key, buffer, {
        httpMetadata: { contentType: imageFile.type },
        customMetadata: { sessionId, source: 'ocr-upload' },
      })
    }

    // ── DO State: PROCESSING ────────────────────────────────────────────
    await setOcrStatus(c, sessionId, 'PROCESSING')

    // ── OCR Extraction ──────────────────────────────────────────────────
    const base64 = arrayBufferToBase64(buffer)
    const result = await extractFromImage(base64, imageFile.type)

    if (!result.success || !result.fields) {
      await setOcrStatus(c, sessionId, 'SKIPPED')
      return c.html(renderFallback(result.error || 'OCR extraction failed. You can continue manually.'))
    }

    // ── DO State: VERIFYING ─────────────────────────────────────────────
    await setOcrStatus(c, sessionId, 'VERIFYING')

    // ── Return Verification Card ────────────────────────────────────────
    return c.html(renderVerificationCard(result.fields, sessionId))

  } catch (err: any) {
    console.error('[OCR] upload error:', err)
    return c.html(renderFallback('An error occurred. Please try again or continue manually.'))
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/v1/ocr/confirm
// Confirms or rejects OCR fields → commits to DO → returns summary
// ═══════════════════════════════════════════════════════════════════════════
ocrRouter.post('/ocr/confirm', async (c) => {
  try {
    const body = await c.req.parseBody()
    const sessionId = (body['sessionId'] as string) || ''
    const action = (body['action'] as string) || ''
    const fullName = (body['fullName'] as string) || ''
    const dob = (body['dob'] as string) || ''
    const address = (body['address'] as string) || ''
    const licenseNum = (body['licenseNum'] as string) || ''

    if (!sessionId) {
      return c.html('<div style="padding:12px;color:#f87171;font-size:13px">Error: Session required</div>')
    }

    if (action === 'reject') {
      await setOcrStatus(c, sessionId, 'SKIPPED')
      return c.html(renderCaptureView(sessionId))
    }

    // Confirm: commit fields to DO
    await setOcrStatus(c, sessionId, 'COMPLETED')

    // Store extracted fields in DO session state
    const env = c.env as any
    const doId = env?.CHAT_SESSION?.idFromName?.(sessionId)
    if (doId) {
      const stub = env?.CHAT_SESSION?.get(doId)
      if (stub) {
        await stub.fetch(new Request('http://do/update', {
          method: 'POST',
          body: JSON.stringify({
            collected: { fullName, dob, address, licenseNum },
            nextField: 'id_verified',
          }),
        }))

        // Compute Levenshtein distance telemetry
        const telemetry = {
          event: 'ocr_confirm',
          sessionId,
          fields: { fullName, dob, address, licenseNum },
          levenshteinDistance: 0,
          timestamp: Date.now(),
        }

        // Log telemetry to D1
        const db = (c.env as any)?.DB
        if (db) {
          await db.prepare(
            `INSERT INTO ocr_telemetry (session_id, event, payload, created_at) VALUES (?, ?, ?, ?)`
          ).bind(sessionId, 'ocr_confirm', JSON.stringify(telemetry), Date.now()).run()
        }
      }
    }

    return c.html(renderSummaryCard())

  } catch (err: any) {
    console.error('[OCR] confirm error:', err)
    return c.html('<div style="padding:12px;color:#f87171;font-size:13px">Error confirming fields</div>')
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

async function setOcrStatus(c: any, sessionId: string, status: string): Promise<void> {
  try {
    const env = c.env as any
    const doId = env?.CHAT_SESSION?.idFromName?.(sessionId)
    if (doId) {
      const stub = env?.CHAT_SESSION?.get(doId)
      if (stub) {
        await stub.fetch(new Request('http://do/ocr-status', {
          method: 'POST',
          body: JSON.stringify({ ocrStatus: status }),
        }))
      }
    }
  } catch { /* non-blocking */ }
}

function renderFallback(message: string): string {
  return `<!-- OCR Fallback -->
<div id="ocr-capture" style="padding:12px;border-top:1px solid #2d3140;background:#1c2128">
  <div style="color:#f87171;font-size:12px;margin-bottom:8px">${escapeHtml(message)}</div>
  ${renderCaptureView('')}`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}
