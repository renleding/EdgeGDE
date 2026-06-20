import type { CanvasDocument } from './canvas-types'

export function normalizeAgentCommandPayload(parsed: any, doc: CanvasDocument): any {
  const mutations = Array.isArray(parsed?.mutations) ? parsed.mutations.map((mutation: any) => {
    const next: any = { ...(mutation || {}) }

    if (next.type === 'add_node') {
      const node: any = { ...(next.node || {}) }
      const parentId = next.parentId || node.parentId || doc.rootId

      if (!node.id && next.nodeId) node.id = next.nodeId
      node.parentId = parentId
      next.node = node
      next.parentId = parentId
    }

    if (next.type === 'update_node' && !next.nodeId && next.node?.id) {
      next.nodeId = next.node.id
    }

    return next
  }) : []

  return {
    intent: typeof parsed?.intent === 'string' && parsed.intent.trim() ? parsed.intent.trim() : 'Canvas edit',
    expectedVersion: Number.isFinite(Number(parsed?.expectedVersion)) ? Number(parsed.expectedVersion) : doc.version,
    mutations,
  }
}
