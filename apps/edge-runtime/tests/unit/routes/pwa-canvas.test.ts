/**
 * EdgeGDE — PWA Canvas Route Test
 *
 * Tests the canvas publish endpoint defined in src/routes/pwa-canvas.ts.
 *
 * Coverage targets: payload validation, missing-KV failure envelope,
 * mission receipt shape (client contract), publish history cap.
 */
import { describe, it, expect } from 'vitest'
import type { Context } from 'hono'
import { postCanvasPublish } from '../../../src/routes/pwa-canvas'

// ═══════════════════════════════════════════════════════════════════════════
// Mocks
// ═══════════════════════════════════════════════════════════════════════════

interface MockKv {
  store: Map<string, unknown>
  get(key: string): Promise<string | null>
  getJson(key: string): Promise<Record<string, unknown> | unknown[] | null>
  put(key: string, value: unknown): Promise<void>
}

function makeMockKv(): MockKv {
  const store = new Map<string, unknown>()
  return {
    store,
    async get(key) {
      return store.has(key) ? JSON.stringify(store.get(key)) : null
    },
    async getJson(key) {
      return store.has(key) ? (store.get(key) as Record<string, unknown>) : null
    },
    async put(key, value) {
      store.set(key, value)
    },
  }
}

function makeContext(opts: {
  body?: unknown
  throwOnJson?: boolean
  workspaceId?: string
  kv?: MockKv | null
}): Context {
  return {
    req: {
      param: () => opts.workspaceId ?? 'default',
      json: async () => {
        if (opts.throwOnJson) throw new Error('invalid json')
        return opts.body ?? {}
      },
    },
    env: { ARTIFACT_KV: opts.kv === undefined ? makeMockKv() : opts.kv },
    json: (data: unknown, status?: number) => Response.json(data, { status: status ?? 200 }),
  } as unknown as Context
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/pwa/workspaces/:workspaceId/canvas/publish — validation
// ═══════════════════════════════════════════════════════════════════════════

describe('postCanvasPublish — payload validation', () => {
  it('returns 400 when objects is not an array', async () => {
    const res = await postCanvasPublish(makeContext({ body: { objects: 'nope' } }))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('objects array required')
  })

  it('returns 400 for unparseable JSON body', async () => {
    const res = await postCanvasPublish(makeContext({ throwOnJson: true }))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('objects array required')
  })

  it('returns 503 when ARTIFACT_KV binding is unavailable', async () => {
    const res = await postCanvasPublish(makeContext({ body: { objects: [] }, kv: null }))
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('ARTIFACT_KV')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/pwa/workspaces/:workspaceId/canvas/publish — success contract
// ═══════════════════════════════════════════════════════════════════════════

describe('postCanvasPublish — success', () => {
  it('stores a mission receipt and echoes the client-contract fields', async () => {
    const kv = makeMockKv()
    const res = await postCanvasPublish(
      makeContext({
        body: { objects: [{ id: 'n1' }, { id: 'n2' }], version: 3, sessionId: 's1', correlationId: 'c1' },
        kv,
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      missionId: string
      publishedAt: string
      status: string
      objectCount: number
      historyCount: number
    }
    expect(body.missionId).toBeTruthy()
    expect(body.publishedAt).toBeTruthy()
    expect(body.status).toBe('published')
    expect(body.objectCount).toBe(2)
    expect(body.historyCount).toBe(1)

    const latest = kv.store.get('global:pwa:default:canvas-published') as Record<string, unknown>
    expect(latest.missionId).toBe(body.missionId)
    expect(latest.correlationId).toBe('c1')
  })

  it('caps publish history at 20 entries', async () => {
    const kv = makeMockKv()
    const existing = Array.from({ length: 20 }, (_, i) => ({ missionId: `old-${i}` }))
    kv.store.set('global:pwa:default:canvas-publish-history', existing)

    const res = await postCanvasPublish(makeContext({ body: { objects: [{}] }, kv }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { historyCount: number }
    expect(body.historyCount).toBe(20)

    const history = kv.store.get('global:pwa:default:canvas-publish-history') as unknown[]
    expect(history).toHaveLength(20)
    expect((history[0] as { missionId: string }).missionId).not.toContain('old-')
  })

  it('normalizes hostile workspace ids into the KV key namespace', async () => {
    const kv = makeMockKv()
    await postCanvasPublish(
      makeContext({ body: { objects: [] }, kv, workspaceId: '../../evil' }),
    )
    expect(kv.store.has('global:pwa:.._.._evil:canvas-published')).toBe(true)
  })
})
