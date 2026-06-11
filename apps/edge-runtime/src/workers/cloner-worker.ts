/**
 * EdgeGDE Canvas — Cloner Queue Worker
 * Phase 4: Processes website clone jobs from the queue.
 *
 * Receives: { type: 'clone_website', url: string, canvasId: string }
 * Fetches the URL, parses HTML, builds CanvasDocument, stores in KV/DO.
 *
 * @packageDocumentation
 */

import { cloneWebsite } from '../cloner/website-cloner'

/**
 * Handle a clone_website queue message.
 * Called from the main queue handler.
 */
export async function handleCloneJob(body: any, env: any): Promise<void> {
  if (body?.type !== 'clone_website') return

  const { url, canvasId } = body
  if (!url || !canvasId) {
    console.error('[ClonerWorker] missing url or canvasId')
    return
  }

  try {
    // Fetch the website HTML
    const response = await fetch(url, {
      headers: { 'User-Agent': 'EdgeGDE-Cloner/1.0' },
    })

    if (!response.ok) {
      console.error(`[ClonerWorker] fetch failed: ${response.status} for ${url}`)
      return
    }

    const html = await response.text()

    // Clone into CanvasDocument
    const doc = cloneWebsite(url, html)
    doc.id = canvasId

    // Initialize the DO with the cloned document
    const doId = env.CANVAS_SESSION.idFromName(canvasId)
    const stub = env.CANVAS_SESSION.get(doId)
    await stub.fetch('http://dO/init', {
      method: 'POST',
      body: JSON.stringify({
        id: canvasId,
        rootId: doc.rootId,
        nodes: doc.nodes,
      }),
    })

    console.log(`[ClonerWorker] cloned ${url} into canvas ${canvasId}`)
  } catch (e: any) {
    console.error(`[ClonerWorker] error cloning ${url}:`, e.message)
  }
}
