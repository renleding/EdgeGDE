/**
 * EdgeGDE Canvas PWA — route helper.
 *
 * Static assets live under apps/pwa-canvas/public and are copied to
 * apps/edge-runtime/public/pwa-canvas by the pwa-canvas build script.
 */

import type { Context } from 'hono'

type PwaTransientState = {
  selected: string
  recentResults: unknown[]
  policyState: Record<string, unknown>
}

type PwaActionProposal = Record<string, unknown> & {
  id: string
  createdAt: string
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

function artifactKv(c: Context) {
  const rawKV = (c.env as any)?.ARTIFACT_KV
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

export function redirectPwaCanvas(c: Context) {
  return c.redirect('/pwa-canvas/index.html', 302)
}

export async function getPwaTransient(c: Context) {
  const workspaceId = normalizeWorkspaceId(c.req.param('workspaceId') ?? 'default')
  return c.json(await readTransient(c, workspaceId))
}

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

export async function getPwaActionProposals(c: Context) {
  const workspaceId = normalizeWorkspaceId(c.req.param('workspaceId') ?? 'default')
  return c.json({ proposals: await readProposals(c, workspaceId) })
}

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
