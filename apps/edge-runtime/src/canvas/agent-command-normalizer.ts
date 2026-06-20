import type { RawAgentCommand, ValidatedAgentCommand } from './agent-command-schema'
import type { CanvasDocument } from './canvas-types'

export function normalizeAgentCommandPayload(parsed: RawAgentCommand | unknown, doc: CanvasDocument): ValidatedAgentCommand {
  const command = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  const rawMutations = Array.isArray(command.mutations) ? command.mutations : []

  const mutations = rawMutations.map((mutation: unknown) => {
    const next: Record<string, unknown> = {
      ...(mutation && typeof mutation === 'object' ? mutation as Record<string, unknown> : {}),
    }

    if (next.type === 'add_node') {
      const node: Record<string, unknown> = {
        ...(next.node && typeof next.node === 'object' ? next.node as Record<string, unknown> : {}),
      }
      const parentId = typeof next.parentId === 'string' && next.parentId
        ? next.parentId
        : typeof node.parentId === 'string' && node.parentId
          ? node.parentId
          : doc.rootId

      if (typeof node.id !== 'string' && typeof next.nodeId === 'string') node.id = next.nodeId
      node.parentId = parentId
      next.node = node
      next.parentId = parentId
    }

    const node: Record<string, unknown> = {
      ...(next.node && typeof next.node === 'object' ? next.node as Record<string, unknown> : {}),
    }
    if (next.type === 'update_node' && typeof next.nodeId !== 'string' && typeof node.id === 'string') {
      next.nodeId = node.id
    }

    return next as ValidatedAgentCommand['mutations'][number]
  })

  return {
    intent: typeof command.intent === 'string' && command.intent.trim() ? command.intent.trim() : 'Canvas edit',
    expectedVersion: typeof command.expectedVersion === 'number' && Number.isFinite(command.expectedVersion)
      ? Math.trunc(command.expectedVersion)
      : doc.version,
    mutations,
  } satisfies ValidatedAgentCommand
}
