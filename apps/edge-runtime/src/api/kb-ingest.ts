/**
 * Knowledge Base Ingest API — receives extracted video + transcript data
 * from the LMS extraction script and inserts into D1.
 *
 * Admin-auth required. Accepts structured payload from the extraction
 * pipeline on local M1.
 *
 * Route:
 *   POST /api/v1/kb/ingest  — Insert video + transcript
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import { envFromContext, type Env } from '../lib/env'
import { adminAuth } from '../middleware/auth'

interface IngestRequest {
  video_id: string
  transcript_id: string
  video: {
    id: string
    source_url: string
    vimeo_url: string
    title: string
    duration_seconds: number
    r2_key: string | null
    transcript_id: string
  }
  transcript: {
    id: string
    video_id: string
    title: string
    source_url: string
    markdown_content: string
    word_count: number
  }
}

export const kbIngestRouter = new Hono<{ Bindings: Env }>()

/**
 * POST /ingest
 *
 * Receives extracted video + transcript payload and inserts into D1.
 * Requires admin auth token.
 */
kbIngestRouter.post('/ingest', adminAuth, async (c) => {
  const env = envFromContext(c)
  const db = env.DB

  let body: IngestRequest
  try {
    body = await c.req.json<IngestRequest>()
  } catch {
    return c.json({ error: 'KB_INVALID_PAYLOAD', message: 'Invalid JSON body' }, 400)
  }

  // Validate required fields
  if (!body.video_id || !body.transcript_id || !body.video || !body.transcript) {
    return c.json({ error: 'KB_MISSING_FIELDS', message: 'video_id, transcript_id, video, and transcript are all required' }, 400)
  }

  if (!body.transcript.markdown_content) {
    return c.json({ error: 'KB_MISSING_CONTENT', message: 'transcript.markdown_content is required' }, 400)
  }

  try {
    // Insert video record
    await db.prepare(`
      INSERT INTO videos (id, source_url, vimeo_url, title, duration_seconds, r2_key, transcript_id, extracted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    `).bind(
      body.video.id,
      body.video.source_url,
      body.video.vimeo_url,
      body.video.title,
      body.video.duration_seconds,
      body.video.r2_key,
      body.video.transcript_id,
    ).run()

    // Insert transcript (the AFTER INSERT trigger syncs FTS5 automatically)
    await db.prepare(`
      INSERT INTO transcripts (id, video_id, title, source_url, markdown_content, word_count, chunk_count, extracted_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    `).bind(
      body.transcript.id,
      body.transcript.video_id,
      body.transcript.title,
      body.transcript.source_url,
      body.transcript.markdown_content,
      body.transcript.word_count,
    ).run()

    return c.json({
      ok: true,
      video_id: body.video_id,
      transcript_id: body.transcript_id,
      message: 'Video and transcript ingested successfully',
    })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    // Handle unique constraint violations (duplicate insert)
    if (msg.includes('UNIQUE constraint')) {
      return c.json({
        error: 'KB_DUPLICATE',
        message: `Video "${body.video_id}" already exists in the knowledge base`,
        detail: msg,
      }, 409)
    }

    console.error('KB ingest error:', msg)
    return c.json({ error: 'KB_DB_ERROR', message: 'Failed to ingest into knowledge base', detail: msg }, 500)
  }
})

/**
 * POST /ingest/batch
 *
 * Bulk ingest multiple videos and transcripts in a single request.
 * Each item in the array is validated individually.
 * Items that fail (e.g., duplicates) are reported per-item.
 */
kbIngestRouter.post('/ingest/batch', adminAuth, async (c) => {
  const env = envFromContext(c)
  const db = env.DB

  let items: IngestRequest[]
  try {
    items = await c.req.json<IngestRequest[]>()
  } catch {
    return c.json({ error: 'KB_INVALID_PAYLOAD', message: 'Expected an array of ingest payloads' }, 400)
  }

  if (!Array.isArray(items) || items.length === 0) {
    return c.json({ error: 'KB_EMPTY_BATCH', message: 'Batch must be a non-empty array' }, 400)
  }

  if (items.length > 50) {
    return c.json({ error: 'KB_BATCH_TOO_LARGE', message: 'Batch max is 50 items' }, 400)
  }

  const results: Array<{ index: number; video_id: string; status: 'ok' | 'error'; error?: string }> = []

  for (let i = 0; i < items.length; i++) {
    const item = items[i]

    if (!item.video || !item.transcript || !item.transcript.markdown_content) {
      results.push({ index: i, video_id: item.video_id || 'unknown', status: 'error', error: 'Missing required fields' })
      continue
    }

    try {
      await db.prepare(`
        INSERT INTO videos (id, source_url, vimeo_url, title, duration_seconds, r2_key, transcript_id, extracted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      `).bind(
        item.video.id, item.video.source_url, item.video.vimeo_url,
        item.video.title, item.video.duration_seconds, item.video.r2_key,
        item.video.transcript_id,
      ).run()

      await db.prepare(`
        INSERT INTO transcripts (id, video_id, title, source_url, markdown_content, word_count, chunk_count, extracted_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      `).bind(
        item.transcript.id, item.transcript.video_id, item.transcript.title,
        item.transcript.source_url, item.transcript.markdown_content,
        item.transcript.word_count,
      ).run()

      results.push({ index: i, video_id: item.video_id, status: 'ok' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({ index: i, video_id: item.video_id || 'unknown', status: 'error', error: msg })
    }
  }

  const okCount = results.filter(r => r.status === 'ok').length
  const errCount = results.filter(r => r.status === 'error').length

  return c.json({
    ok: errCount === 0,
    total: items.length,
    ingested: okCount,
    failed: errCount,
    results,
  })
})
