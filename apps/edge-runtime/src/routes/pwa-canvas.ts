/**
 * EdgeGDE Canvas PWA — route helper.
 *
 * Static assets live under apps/pwa-canvas/public and are copied to
 * apps/edge-runtime/public/pwa-canvas by the pwa-canvas build script.
 */

import type { Context } from 'hono'
import { envFromContext } from '../lib/env'

type PwaTransientState = {
  selected: string
  recentResults: unknown[]
  policyState: Record<string, unknown>
}

type PwaActionProposal = Record<string, unknown> & {
  id: string
  createdAt: string
}

/**
 * Minimal KV-like surface used by the PWA helpers.
 * ARTIFACT_KV is a Workers KV binding; these helpers need JSON convenience
 * access, so we type only the members the code depends on.
 */
interface PwaKvLike {
  get(key: string): Promise<string | null>
  getJson(key: string): Promise<Record<string, unknown> | null>
  put(key: string, value: unknown): Promise<void>
}

const DEFAULT_TRANSIENT: PwaTransientState = {
  selected: 'default',
  recentResults: [],
  policyState: {},
}

function normalizeWorkspaceId(workspaceId: string): string {
  return workspaceId.replace(/[^A-Za-z0-9_.:-]/g, '_') || 'default'
}

function pwaKey(workspaceId: string, suffix: string): string {
  return `global:pwa:${normalizeWorkspaceId(workspaceId)}:${suffix}`
}

function artifactKv(c: Context): PwaKvLike | null {
  const rawKV = envFromContext(c).ARTIFACT_KV as unknown as PwaKvLike
  if (!rawKV || typeof rawKV.get !== 'function' || typeof rawKV.put !== 'function') return null
  return rawKV
}

async function readTransient(c: Context, workspaceId: string): Promise<PwaTransientState> {
  const kv = artifactKv(c)
  if (!kv) return DEFAULT_TRANSIENT
  const raw = await kv.getJson(pwaKey(workspaceId, 'transient'))
  if (!raw || typeof raw !== 'object') return DEFAULT_TRANSIENT
  return {
    selected: typeof raw.selected === 'string' ? raw.selected : DEFAULT_TRANSIENT.selected,
    recentResults: Array.isArray(raw.recentResults) ? raw.recentResults : DEFAULT_TRANSIENT.recentResults,
    policyState: raw.policyState && typeof raw.policyState === 'object' && !Array.isArray(raw.policyState)
      ? raw.policyState as Record<string, unknown>
      : DEFAULT_TRANSIENT.policyState,
  }
}

async function writeTransient(c: Context, workspaceId: string, state: PwaTransientState) {
  const kv = artifactKv(c)
  if (!kv) return state
  await kv.put(pwaKey(workspaceId, 'transient'), state)
  return state
}

async function readProposals(c: Context, workspaceId: string): Promise<PwaActionProposal[]> {
  const kv = artifactKv(c)
  if (!kv) return []
  const raw = await kv.getJson(pwaKey(workspaceId, 'action-proposals:index'))
  if (!Array.isArray(raw)) return []
  return raw.filter((proposal): proposal is PwaActionProposal => {
    return Boolean(proposal && typeof proposal === 'object' && typeof proposal.id === 'string')
  })
}

async function writeProposals(c: Context, workspaceId: string, proposals: PwaActionProposal[]) {
  const kv = artifactKv(c)
  if (!kv) return proposals
  await kv.put(pwaKey(workspaceId, 'action-proposals:index'), proposals)
  return proposals
}

/** Redirect GET /pwa-canvas to the PWA shell entry point. */
export function redirectPwaCanvas(c: Context) {
  return c.redirect('/pwa-canvas/index.html', 302)
}

/** Read the per-workspace transient UI state (selected canvas node, recent action results, policy state). */
export async function getPwaTransient(c: Context) {
  const workspaceId = normalizeWorkspaceId(c.req.param('workspaceId') ?? 'default')
  return c.json(await readTransient(c, workspaceId))
}

/** Merge a partial update into the per-workspace transient UI state and persist it. */
export async function postPwaTransient(c: Context) {
  const workspaceId = normalizeWorkspaceId(c.req.param('workspaceId') ?? 'default')
  let body: Partial<PwaTransientState> = {}
  try {
    body = await c.req.json().catch(() => ({}))
  } catch {
    body = {}
  }

  const current = await readTransient(c, workspaceId)
  const next: PwaTransientState = {
    selected: typeof body.selected === 'string' ? body.selected : current.selected,
    recentResults: Array.isArray(body.recentResults) ? body.recentResults : current.recentResults,
    policyState: body.policyState && typeof body.policyState === 'object' && !Array.isArray(body.policyState)
      ? body.policyState as Record<string, unknown>
      : current.policyState,
  }

  return c.json(await writeTransient(c, workspaceId, next))
}

/** List the action proposals currently stored for a workspace. */
export async function getPwaActionProposals(c: Context) {
  const workspaceId = normalizeWorkspaceId(c.req.param('workspaceId') ?? 'default')
  return c.json({ proposals: await readProposals(c, workspaceId) })
}

/** Publish canvas objects for a workspace: validates the payload, stores the mission receipt in ARTIFACT_KV (latest + capped history), and echoes the receipt to the caller. */
export async function postCanvasPublish(c: Context) {
  const workspaceId = normalizeWorkspaceId(c.req.param('workspaceId') ?? 'default')
  let body: Record<string, unknown> = {}
  try {
    body = await c.req.json().catch(() => ({}))
  } catch {
    body = {}
  }

  if (!Array.isArray(body.objects)) {
    return c.json({ error: 'objects array required' }, 400)
  }

  const kv = artifactKv(c)
  if (!kv) {
    return c.json({ error: 'ARTIFACT_KV binding unavailable' }, 503)
  }

  const mission = {
    missionId: crypto.randomUUID(),
    publishedAt: new Date().toISOString(),
    status: 'published',
    workspaceId,
    objectCount: body.objects.length,
    version: typeof body.version === 'number' || typeof body.version === 'string' ? body.version : null,
    sessionId: typeof body.sessionId === 'string' ? body.sessionId : null,
    correlationId: typeof body.correlationId === 'string' ? body.correlationId : null,
  }

  await kv.put(pwaKey(workspaceId, 'canvas-published'), mission)

  const HISTORY_LIMIT = 20
  const rawHistory = await kv.getJson(pwaKey(workspaceId, 'canvas-publish-history'))
  const history = Array.isArray(rawHistory) ? rawHistory : []
  const nextHistory = [mission, ...history].slice(0, HISTORY_LIMIT)
  await kv.put(pwaKey(workspaceId, 'canvas-publish-history'), nextHistory)

  // Client contract (pwa-canvas main.js) reads missionId, publishedAt, status.
  return c.json({
    missionId: mission.missionId,
    publishedAt: mission.publishedAt,
    status: mission.status,
    workspaceId: mission.workspaceId,
    objectCount: mission.objectCount,
    historyCount: nextHistory.length,
  })
}

/** Submit a single action proposal for a workspace; persists into the workspace proposal index. */
export async function postPwaActionProposal(c: Context) {
  const workspaceId = normalizeWorkspaceId(c.req.param('workspaceId') ?? 'default')
  let body: Partial<PwaActionProposal> = {}
  try {
    body = await c.req.json().catch(() => ({}))
  } catch {
    body = {}
  }

  const proposals = await readProposals(c, workspaceId)
  const proposal: PwaActionProposal = {
    id: typeof body.id === 'string' && body.id ? body.id : crypto.randomUUID(),
    createdAt: typeof body.createdAt === 'string' ? body.createdAt : new Date().toISOString(),
    ...body,
  }

  const next = [proposal, ...proposals]
  return c.json({ proposal, count: (await writeProposals(c, workspaceId, next)).length })
}
