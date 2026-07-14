/**
 * EdgeGDE Staging — Management Routes
 * v4.9.1: Staging isolation, undo/redo ring buffer, version snapshots, Go Live promotion.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'

export const stagingRouter = new Hono()

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

const HISTORY_KEY = 'tenant:afirmico:staging:history'
const REDO_KEY = 'tenant:afirmico:staging:redo'
const VERSIONS_INDEX_KEY = 'tenant:afirmico:staging:versions:index'
const VERSION_DATA_PREFIX = 'tenant:afirmico:staging:versions:v'
const STAGING_LAYOUT_KEY = 'tenant:afirmico:layout:staging'
const PROD_LAYOUT_KEY = 'tenant:afirmico:layout:latest'
const STAGING_HASH_KEY = 'tenant:afirmico:staging:hash'
const PROD_COMPILED_KEY = 'tenant:afirmico:compiled'
const MAX_HISTORY = 20
const MAX_VERSIONS = 20

interface VersionEntry {
  id: string
  label: string
  timestamp: number
  named: boolean
}

async function getKv(c: any) {
  return c.env?.TENANT_KV
}

// ═══════════════════════════════════════════════════════════════════════════
// Undo — restores previous staging layout from history ring buffer
// ═══════════════════════════════════════════════════════════════════════════

stagingRouter.post('/staging/undo', async (c) => {
  const kv = await getKv(c)
  if (!kv) return c.text('KV not available', 500)

  try {
    let history: any[] = (await kv.get(HISTORY_KEY, 'json')) || []
    if (history.length === 0) return c.text('No history', 404)

    // Get the current staging layout
    const current = await kv.get(STAGING_LAYOUT_KEY, 'json')
    const entry = history.pop()

    // Push current to redo stack
    let redoStack: any[] = (await kv.get(REDO_KEY, 'json')) || []
    if (current) redoStack.push({ layout: current, timestamp: Date.now() })
    if (redoStack.length > MAX_HISTORY) redoStack.shift()

    await kv.put(HISTORY_KEY, JSON.stringify(history))
    await kv.put(REDO_KEY, JSON.stringify(redoStack))
    await kv.put(STAGING_LAYOUT_KEY, JSON.stringify(entry.layout))
    await kv.delete(STAGING_HASH_KEY)

    return c.json({ status: 'undone', layoutId: entry.id || 'unknown' })
  } catch (err: any) {
    return c.text(`Undo error: ${err.message}`, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// Redo — restores previously undone layout
// ═══════════════════════════════════════════════════════════════════════════

stagingRouter.post('/staging/redo', async (c) => {
  const kv = await getKv(c)
  if (!kv) return c.text('KV not available', 500)

  try {
    let redoStack: any[] = (await kv.get(REDO_KEY, 'json')) || []
    if (redoStack.length === 0) return c.text('Nothing to redo', 404)

    const current = await kv.get(STAGING_LAYOUT_KEY, 'json')
    const entry = redoStack.pop()

    // Push current back to history
    let history: any[] = (await kv.get(HISTORY_KEY, 'json')) || []
    if (current) history.push({ layout: current, timestamp: Date.now() })
    if (history.length > MAX_HISTORY) history.shift()

    await kv.put(HISTORY_KEY, JSON.stringify(history))
    await kv.put(REDO_KEY, JSON.stringify(redoStack))
    await kv.put(STAGING_LAYOUT_KEY, JSON.stringify(entry.layout))
    await kv.delete(STAGING_HASH_KEY)

    return c.json({ status: 'redone', layoutId: entry.id || 'unknown' })
  } catch (err: any) {
    return c.text(`Redo error: ${err.message}`, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// Push to history (called by publish endpoint after writing new layout)
// ═══════════════════════════════════════════════════════════════════════════

export async function pushToHistory(kv: any, previousLayout: any): Promise<void> {
  let history: any[] = (await kv.get(HISTORY_KEY, 'json')) || []
  history.push({ layout: previousLayout, timestamp: Date.now() })
  if (history.length > MAX_HISTORY) history.shift()
  await kv.put(HISTORY_KEY, JSON.stringify(history))
  // Clear redo stack on new publish
  await kv.put(REDO_KEY, JSON.stringify([]))
}

// ═══════════════════════════════════════════════════════════════════════════
// Save Version — creates a named snapshot
// ═══════════════════════════════════════════════════════════════════════════

stagingRouter.post('/staging/save-version', async (c) => {
  const kv = await getKv(c)
  if (!kv) return c.text('KV not available', 500)

  try {
    const body = await c.req.parseBody() as Record<string, string>
    const label = body.label?.trim() || ''
    const current = await kv.get(STAGING_LAYOUT_KEY, 'json')
    if (!current) return c.text('No staging layout to save', 404)

    let index: VersionEntry[] = (await kv.get(VERSIONS_INDEX_KEY, 'json')) || []
    const nextNum = index.length > 0 ? Math.max(...index.map(i => parseInt(i.id.replace('v', '')) || 0)) + 1 : 1
    const id = `v${nextNum}`
    const named = label.length > 0

    // Store version data
    await kv.put(`${VERSION_DATA_PREFIX}${id}`, JSON.stringify(current))

    // Append to index
    index.push({ id, label: named ? label : `Version ${nextNum}`, timestamp: Date.now(), named })
    await kv.put(VERSIONS_INDEX_KEY, JSON.stringify(index))

    return c.json({ status: 'saved', id, label: named ? label : `Version ${nextNum}` })
  } catch (err: any) {
    return c.text(`Save version error: ${err.message}`, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// List Versions — returns version index as HTML
// ═══════════════════════════════════════════════════════════════════════════

stagingRouter.get('/staging/versions', async (c) => {
  const kv = await getKv(c)
  if (!kv) return c.text('KV not available', 500)

  try {
    const index: VersionEntry[] = (await kv.get(VERSIONS_INDEX_KEY, 'json')) || []
    const hxAttr = (s: string) => s.replace(/'/g, '&#39;').replace(/"/g, '&quot;')
    const html = index.length === 0
      ? '<div style="color:rgba(255,255,255,0.3);padding:16px;text-align:center;font-size:13px">No saved versions</div>'
      : index.slice().reverse().map(v => `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:rgba(255,255,255,0.04);border-radius:8px;margin-bottom:4px">
          <span style="flex:1;color:#fff;font-size:13px">${v.label}</span>
          <span style="color:rgba(255,255,255,0.3);font-size:11px">${v.named ? '&#9733;' : ''}</span>
          <button hx-post="/api/staging/restore-version"
                  hx-vals='{"id":"${hxAttr(v.id)}"}'
                  hx-target="body"
                  hx-swap="innerHTML"
                  style="padding:4px 10px;border-radius:6px;background:rgba(99,102,241,0.2);border:1px solid rgba(99,102,241,0.3);color:#818CF8;font-size:11px;cursor:pointer">Restore</button>
          <button hx-post="/api/staging/delete-version"
                  hx-vals='{"id":"${hxAttr(v.id)}"}'
                  hx-target="closest div"
                  hx-swap="outerHTML"
                  style="width:24px;height:24px;border-radius:50%;border:1px solid rgba(255,107,107,0.3);background:rgba(255,107,107,0.1);color:#ff6b6b;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center">×</button>
        </div>`).join('')

    c.header('Content-Type', 'text/html; charset=utf-8')
    return c.body(html)
  } catch (err: any) {
    return c.text(`List versions error: ${err.message}`, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// Restore Version — loads a saved version back to staging
// ═══════════════════════════════════════════════════════════════════════════

stagingRouter.post('/staging/restore-version', async (c) => {
  const kv = await getKv(c)
  if (!kv) return c.text('KV not available', 500)

  try {
    const body = await c.req.parseBody() as Record<string, string>
    const id = body.id || ''
    if (!id) return c.text('Version ID required', 400)

    const data = await kv.get(`${VERSION_DATA_PREFIX}${id}`, 'json')
    if (!data) return c.text('Version not found', 404)

    // Push current staging to history before restoring
    const current = await kv.get(STAGING_LAYOUT_KEY, 'json')
    if (current) await pushToHistory(kv, current)

    await kv.put(STAGING_LAYOUT_KEY, JSON.stringify(data))
    await kv.delete(STAGING_HASH_KEY)

    return c.json({ status: 'restored', version: id })
  } catch (err: any) {
    return c.text(`Restore version error: ${err.message}`, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// Delete Version — removes a version from the index
// ═══════════════════════════════════════════════════════════════════════════

stagingRouter.post('/staging/delete-version', async (c) => {
  const kv = await getKv(c)
  if (!kv) return c.text('KV not available', 500)

  try {
    const body = await c.req.parseBody() as Record<string, string>
    const id = body.id || ''
    if (!id) return c.text('Version ID required', 400)

    let index: VersionEntry[] = (await kv.get(VERSIONS_INDEX_KEY, 'json')) || []
    index = index.filter(v => v.id !== id)
    await kv.put(VERSIONS_INDEX_KEY, JSON.stringify(index))
    await kv.delete(`${VERSION_DATA_PREFIX}${id}`)

    return new Response('', { status: 200, headers: { 'Content-Type': 'text/html' } })
  } catch (err: any) {
    return c.text(`Delete version error: ${err.message}`, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// Go Live — promotes staging layout to production
// ═══════════════════════════════════════════════════════════════════════════

stagingRouter.post('/staging/promote', async (c) => {
  const kv = await getKv(c)
  if (!kv) return c.text('KV not available', 500)

  try {
    const staging = await kv.get(STAGING_LAYOUT_KEY, 'json')
    if (!staging) return c.text('No staging layout to promote', 404)

    await kv.put(PROD_LAYOUT_KEY, JSON.stringify(staging))
    await kv.delete(PROD_COMPILED_KEY)

    return c.json({ status: 'promoted', message: 'Staging layout promoted to production' })
  } catch (err: any) {
    return c.text(`Promote error: ${err.message}`, 500)
  }
})
