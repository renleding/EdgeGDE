/**
 * Knowledge Base Query API — FTS5 full-text search over video transcripts
 * and lender documents.  Phase 1 of the LMS extraction project.
 *
 * Routes:
 *   GET /api/kb/search  — FTS5 full-text search across transcripts + lender docs
 *   GET /api/kb/videos  — List extracted videos with transcript availability
 *   GET /api/kb/video/:id — Single video + transcript detail
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import { envFromContext, type Env } from '../lib/env'

// ── Types ───────────────────────────────────────────────────────────────────

export interface SearchResult {
  id: string
  source: 'transcript' | 'lender'
  title: string
  snippet: string
  rank: number
  url: string
  extracted_at: string
}

export interface SearchResponse {
  results: SearchResult[]
  total: number
  query: string
}

export interface VideoInfo {
  id: string
  title: string
  duration_seconds: number
  has_transcript: boolean
  extracted_at: string
}

export interface VideoListResponse {
  videos: VideoInfo[]
}

export interface SingleVideoResponse {
  video: {
    id: string
    source_url: string
    vimeo_url: string
    title: string
    duration_seconds: number
    extracted_at: string
  } | null
  transcript: {
    id: string
    title: string
    markdown_content: string
    word_count: number
    chunk_count: number
  } | null
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a plain-text snippet from markdown content, truncated at
 * ~150 chars around the first matching term.  If no match is found
 * (the caller already knows the FTS5 result matched), returns the
 * first 200 chars.
 */
function buildSnippet(content: string, query: string): string {
  const lower = content.toLowerCase()
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  let bestIdx = -1

  for (const term of terms) {
    const idx = lower.indexOf(term)
    if (idx >= 0 && (bestIdx < 0 || idx < bestIdx)) {
      bestIdx = idx
    }
  }

  if (bestIdx < 0) {
    return content.slice(0, 200).replace(/\s+\S*$/, '') + '…'
  }

  const start = Math.max(0, bestIdx - 60)
  const end = Math.min(content.length, bestIdx + 100)
  let snippet = content.slice(start, end).replace(/\s+\S*$/, '')
  if (start > 0) snippet = '…' + snippet
  if (end < content.length) snippet += '…'
  return snippet
}

// ── Router ──────────────────────────────────────────────────────────────────

export const kbRouter = new Hono<{ Bindings: Env }>()

/**
 * GET /search?q=<query>&type=all&limit=10
 *
 * Full-text search over transcripts and/or lender docs via FTS5.
 * Returns ranked results with snippets.
 */
kbRouter.get('/search', async (c) => {
  const q = c.req.query('q')
  if (!q || !q.trim()) {
    return c.json({ error: 'KB_QUERY_REQUIRED', message: 'Search query parameter "q" is required' }, 400)
  }
  const type = c.req.query('type') || 'all'
  const limitStr = c.req.query('limit') || '10'
  const limit = Math.min(Math.max(1, parseInt(limitStr, 10) || 10), 50)

  // Sanitize the FTS5 query: escape unquoted hyphens (FTS5 treats them as NOT)
  const sanitized = q.trim().replace(/(?<!")(?<!\w)-/g, ' ').replace(/-+(?!")/g, ' ')

  const env = envFromContext(c)
  const db = env.DB
  const results: SearchResult[] = []

  try {
    if (type === 'all' || type === 'transcript') {
      const rows = await db.prepare(`
        SELECT
          t.id,
          t.title,
          t.markdown_content,
          t.source_url,
          t.extracted_at,
          rank
        FROM transcripts_fts
        JOIN transcripts t ON t.rowid = transcripts_fts.rowid
        WHERE transcripts_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).bind(sanitized, limit).all() as { results: Array<{
        id: string; title: string; markdown_content: string;
        source_url: string; extracted_at: string; rank: number
      }> }

      for (const row of rows.results) {
        results.push({
          id: row.id,
          source: 'transcript',
          title: row.title,
          snippet: buildSnippet(row.markdown_content, sanitized),
          rank: row.rank ?? 0,
          url: row.source_url,
          extracted_at: row.extracted_at,
        })
      }
    }

    if (type === 'all' || type === 'lender') {
      const rows = await db.prepare(`
        SELECT
          d.id,
          d.title,
          d.markdown_content,
          d.ingested_at,
          rank
        FROM lender_docs_fts
        JOIN lender_docs d ON d.rowid = lender_docs_fts.rowid
        WHERE lender_docs_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).bind(sanitized, limit).all() as { results: Array<{
        id: string; title: string; markdown_content: string;
        ingested_at: string; rank: number
      }> }

      for (const row of rows.results) {
        results.push({
          id: row.id,
          source: 'lender',
          title: row.title,
          snippet: buildSnippet(row.markdown_content, sanitized),
          rank: row.rank ?? 0,
          url: '',
          extracted_at: row.ingested_at,
        })
      }
    }

    // Sort combined results by rank (lower = better match)
    results.sort((a, b) => a.rank - b.rank)

    return c.json({ results, total: results.length, query: q } satisfies SearchResponse)

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Detect FTS5 syntax errors
    if (msg.includes('syntax error') || msg.includes('fts5')) {
      return c.json({
        error: 'KB_INVALID_QUERY',
        message: 'Invalid search query syntax. Check your FTS5 query syntax.',
        detail: msg,
      }, 400)
    }
    console.error('KB search error:', msg)
    return c.json({ error: 'KB_DB_ERROR', message: 'Internal query error' }, 500)
  }
})

/**
 * GET /videos
 *
 * List all extracted videos with transcript availability.
 */
kbRouter.get('/videos', async (c) => {
  const env = envFromContext(c)
  try {
    const rows = await env.DB.prepare(`
      SELECT
        v.id,
        v.title,
        v.duration_seconds,
        v.transcript_id,
        v.extracted_at
      FROM videos v
      ORDER BY v.extracted_at DESC
    `).all() as { results: Array<{
      id: string; title: string; duration_seconds: number;
      transcript_id: string | null; extracted_at: string
    }> }

    const videos: VideoInfo[] = rows.results.map(r => ({
      id: r.id,
      title: r.title,
      duration_seconds: r.duration_seconds,
      has_transcript: r.transcript_id !== null,
      extracted_at: r.extracted_at,
    }))

    return c.json({ videos } satisfies VideoListResponse)

  } catch (err) {
    console.error('KB video list error:', err)
    return c.json({ error: 'KB_DB_ERROR', message: 'Failed to fetch video list' }, 500)
  }
})

/**
 * GET /video/:id
 *
 * Single video detail with linked transcript.
 */
kbRouter.get('/video/:id', async (c) => {
  const id = c.req.param('id')
  const env = envFromContext(c)

  try {
    const videoRow = await env.DB.prepare(`
      SELECT id, source_url, vimeo_url, title, duration_seconds, transcript_id, extracted_at
      FROM videos WHERE id = ?
    `).bind(id).first() as {
      id: string; source_url: string; vimeo_url: string;
      title: string; duration_seconds: number;
      transcript_id: string | null; extracted_at: string
    } | null

    if (!videoRow) {
      return c.json({ error: 'KB_NOT_FOUND', message: `Video "${id}" not found` }, 404)
    }

    let transcript = null
    if (videoRow.transcript_id) {
      transcript = await env.DB.prepare(`
        SELECT id, title, markdown_content, word_count, chunk_count
        FROM transcripts WHERE id = ?
      `).bind(videoRow.transcript_id).first() as {
        id: string; title: string; markdown_content: string;
        word_count: number; chunk_count: number
      } | null
    }

    return c.json({
      video: {
        id: videoRow.id,
        source_url: videoRow.source_url,
        vimeo_url: videoRow.vimeo_url,
        title: videoRow.title,
        duration_seconds: videoRow.duration_seconds,
        extracted_at: videoRow.extracted_at,
      },
      transcript,
    } satisfies SingleVideoResponse)

  } catch (err) {
    console.error('KB video detail error:', err)
    return c.json({ error: 'KB_DB_ERROR', message: 'Failed to fetch video detail' }, 500)
  }
})
