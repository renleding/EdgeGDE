/**
 * EdgeGDE Canvas — CanvasEngine
 * Canvas Platform v1.0.0
 * Phase 0: Pure functions for deterministic CanvasDocument mutations.
 *
 * - applyMutation: atomic state transitions
 * - rebuildDocFromHistory: replay history up to stagingPointer
 * - getTree: flat node map → nested tree for compiler
 *
 * All functions are pure (no IO, no side effects).
 *
 * @packageDocumentation
 */

import type { CanvasDocument, Node, Mutation, TreeNode } from './canvas-types'

// ═══════════════════════════════════════════════════════════════════════════
// Deep Clone Helpers
// ═══════════════════════════════════════════════════════════════════════════

function cloneDoc(doc: CanvasDocument): CanvasDocument {
  return JSON.parse(JSON.stringify(doc))
}

function cloneNode(node: Node): Node {
  return JSON.parse(JSON.stringify(node))
}

function cloneValue<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

// ═══════════════════════════════════════════════════════════════════════════
// Tree traversal helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Recursively collect all descendant IDs of a node (depth-first).
 * Does NOT include the node itself.
 */
function collectDescendants(nodeId: string, nodes: Record<string, Node>): string[] {
  const result: string[] = []
  const node = nodes[nodeId]
  if (!node) return result

  for (const childId of node.children) {
    result.push(childId)
    result.push(...collectDescendants(childId, nodes))
  }

  return result
}

/**
 * Check if `candidateId` is an ancestor of `nodeId` (or the same node).
 * Used to prevent circular parenting in move_node.
 */
function isAncestorOrSelf(
  candidateId: string,
  nodeId: string,
  nodes: Record<string, Node>,
): boolean {
  if (candidateId === nodeId) return true
  let current = nodes[nodeId]
  while (current && current.parentId) {
    if (current.parentId === candidateId) return true
    current = nodes[current.parentId]
  }
  return false
}

/**
 * Remove a child ID from a parent's children array, ensuring no duplicates.
 */
function removeChild(parentId: string, childId: string, nodes: Record<string, Node>): void {
  const parent = nodes[parentId]
  if (!parent) return
  parent.children = parent.children.filter((id: string) => id !== childId)
}

// ═══════════════════════════════════════════════════════════════════════════
// applyMutation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Apply a single mutation to a CanvasDocument.
 * Returns a NEW CanvasDocument (immutable — original is not mutated).
 *
 * @param doc - Current document state
 * @param mutation - The mutation to apply
 * @returns A new CanvasDocument with the mutation applied
 * @throws {Error} If validation fails (node not found, duplicate id, root delete, circular move)
 */
export function applyMutation(doc: CanvasDocument, mutation: Mutation): CanvasDocument {
  const next = cloneDoc(doc)

  switch (mutation.type) {
    case 'add_node': {
      const { node: newNode, parentId } = mutation
      if (next.nodes[newNode.id]) {
        throw new Error(`applyMutation: node "${newNode.id}" already exists`)
      }
      const parent = next.nodes[parentId]
      if (!parent) {
        throw new Error(`applyMutation: parent node "${parentId}" not found`)
      }

      const n = cloneNode(newNode)
      n.parentId = parentId
      next.nodes[n.id] = n
      // Prevent duplicate children entries
      if (!parent.children.includes(n.id)) {
        parent.children.push(n.id)
      }
      break
    }

    case 'update_node': {
      const { nodeId, props, style } = mutation
      const existing = next.nodes[nodeId]
      if (!existing) {
        throw new Error(`applyMutation: node "${nodeId}" not found`)
      }

      if (props) {
        Object.assign(existing.props, cloneValue(props))
      }
      if (style) {
        Object.assign(existing.style, cloneValue(style))
      }
      break
    }

    case 'delete_node': {
      const { nodeId, strategy } = mutation
      const target = next.nodes[nodeId]
      if (!target) {
        throw new Error(`applyMutation: node "${nodeId}" not found`)
      }
      if (nodeId === next.rootId) {
        throw new Error(`applyMutation: cannot delete root node "${nodeId}"`)
      }

      const parentId = target.parentId

      // Remove from parent's children array
      if (parentId && next.nodes[parentId]) {
        removeChild(parentId, nodeId, next.nodes)
      }

      const actualStrategy = strategy || 'remove_all'

      if (actualStrategy === 'reparent_children') {
        // Promote children to the deleted node's parent
        if (target.children.length > 0 && parentId && next.nodes[parentId]) {
          for (const childId of target.children) {
            if (next.nodes[childId]) {
              next.nodes[childId].parentId = parentId
              if (!next.nodes[parentId].children.includes(childId)) {
                next.nodes[parentId].children.push(childId)
              }
            }
          }
        }
        delete next.nodes[nodeId]
      } else {
        // remove_all: recursively delete all descendants, then delete the node
        const descendants = collectDescendants(nodeId, next.nodes)
        for (const descId of descendants) {
          delete next.nodes[descId]
        }
        delete next.nodes[nodeId]
      }
      break
    }

    case 'move_node': {
      const { nodeId, newParentId, newIndex } = mutation
      const moving = next.nodes[nodeId]
      if (!moving) {
        throw new Error(`applyMutation: node "${nodeId}" not found`)
      }
      if (!next.nodes[newParentId]) {
        throw new Error(`applyMutation: target parent "${newParentId}" not found`)
      }

      // ═══ Root guard: rootId cannot change parent ═══
      if (nodeId === next.rootId) {
        throw new Error(`applyMutation: cannot move root node "${nodeId}"`)
      }

      // ═══ Circular parenting guard ═══
      if (isAncestorOrSelf(nodeId, newParentId, next.nodes)) {
        throw new Error(
          `applyMutation: circular move — "${newParentId}" is inside the subtree of "${nodeId}"`,
        )
      }

      // Remove from old parent
      const oldParentId = moving.parentId
      if (oldParentId && next.nodes[oldParentId]) {
        removeChild(oldParentId, nodeId, next.nodes)
      }

      // Add to new parent
      moving.parentId = newParentId
      if (newIndex !== undefined) {
        next.nodes[newParentId].children.splice(newIndex, 0, nodeId)
      } else {
        next.nodes[newParentId].children.push(nodeId)
      }
      break
    }

    // ═════════════════════════════════════════════════════════════════════
    // FRS v3 Feature A: Agent lifecycle state transition
    // ═════════════════════════════════════════════════════════════════════
    case 'transition_agent_state': {
      const { nodeId, newState } = mutation
      const existing = next.nodes[nodeId]
      if (!existing) {
        throw new Error(`applyMutation: agent node "${nodeId}" not found`)
      }
      const prevState = existing.props.agentState as string | undefined
      existing.props.agentState = newState
      if (!existing.props.agentHistory) {
        existing.props.agentHistory = []
      }
      existing.props.agentHistory.push({
        state: newState,
        ts: Date.now(),
        mutationId: `m_${next.version}`,
        fromState: prevState || 'Idle',
      })
      break
    }

    // ═════════════════════════════════════════════════════════════════════
    // FRS v3 Feature C: Proposal governance
    // ═════════════════════════════════════════════════════════════════════
    case 'create_proposal': {
      const { node: proposalNode, proposalData } = mutation
      if (next.nodes[proposalNode.id]) {
        throw new Error(`applyMutation: proposal node "${proposalNode.id}" already exists`)
      }
      const n = cloneNode(proposalNode)
      n.parentId = next.rootId
      n.props = { ...n.props, ...proposalData, status: 'Draft', createdAt: Date.now(), updatedAt: Date.now() }
      next.nodes[n.id] = n
      if (!next.nodes[next.rootId].children.includes(n.id)) {
        next.nodes[next.rootId].children.push(n.id)
      }
      break
    }

    case 'approve_proposal': {
      const { nodeId } = mutation
      const prop = next.nodes[nodeId]
      if (!prop) throw new Error(`applyMutation: proposal "${nodeId}" not found`)
      if (prop.type !== 'ProposalNode') throw new Error(`applyMutation: "${nodeId}" is not a ProposalNode`)
      prop.props.status = 'Approved'
      prop.props.updatedAt = Date.now()
      break
    }

    case 'reject_proposal': {
      const { nodeId } = mutation
      const prop = next.nodes[nodeId]
      if (!prop) throw new Error(`applyMutation: proposal "${nodeId}" not found`)
      if (prop.type !== 'ProposalNode') throw new Error(`applyMutation: "${nodeId}" is not a ProposalNode`)
      prop.props.status = 'Rejected'
      prop.props.updatedAt = Date.now()
      break
    }

    // ═════════════════════════════════════════════════════════════════════
    // FRS v3 Feature B: State rollback
    // ═════════════════════════════════════════════════════════════════════
    case 'rollback_to_point': {
      const { targetPointer } = mutation
      if (targetPointer < -1 || targetPointer >= next.history.length) {
        throw new Error(`applyMutation: rollback target ${targetPointer} out of range [0, ${next.history.length - 1}]`)
      }
      // Set stagingPointer to target — rebuildDocFromHistory will replay up to this point
      next.stagingPointer = targetPointer
      // Record the rollback in history so it's auditable
      // (Actual state rebuild happens in rebuildDocFromHistory)
      break
    }

    // ═════════════════════════════════════════════════════════════════════
    // FRS v3 Feature D: Workspace linking
    // ═════════════════════════════════════════════════════════════════════
    case 'link_workspaces': {
      const { link } = mutation
      if (!next.workspaceLinks) next.workspaceLinks = []
      if (next.workspaceLinks.find(l => l.id === link.id)) {
        throw new Error(`applyMutation: workspace link "${link.id}" already exists`)
      }
      next.workspaceLinks.push(cloneValue(link))
      break
    }

    default:
      throw new Error(`applyMutation: unknown mutation type "${(mutation as Record<string, unknown>).type}"`)
  }

  next.version++
  next.history.push(cloneValue(mutation))
  next.stagingPointer = next.history.length - 1
  return next
}

// ═══════════════════════════════════════════════════════════════════════════
// rebuildDocFromHistory
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Rebuild a CanvasDocument by replaying history[0..stagingPointer].
 * Used for undo/redo — the pointer determines which mutations are active.
 *
 * A pointer of -1 returns the base state (no mutations applied).
 * Base nodes are taken from doc.baseNodes — the snapshot of nodes at version 0.
 *
 * @param doc - Document with history and stagingPointer
 * @returns A new CanvasDocument rebuilt from the base state + replayed history
 */
export function rebuildDocFromHistory(doc: CanvasDocument): CanvasDocument {
  // Start from the base state (nodes at version 0, before any mutations)
  const base: CanvasDocument = {
    id: doc.id,
    version: 0,
    nodes: cloneValue(doc.baseNodes),
    baseNodes: doc.baseNodes,
    rootId: doc.rootId,
    history: doc.history,
    stagingPointer: doc.stagingPointer,
    livePointer: doc.livePointer,
    metadata: doc.metadata ? cloneValue(doc.metadata) : undefined,
  }

  const pointer = doc.stagingPointer
  if (pointer < 0) return base

  const end = Math.min(pointer + 1, doc.history.length)
  let current = base

  for (let i = 0; i < end; i++) {
    current = applyMutation(current, doc.history[i])
  }

  // Preserve the original pointer (applyMutation advances stagingPointer)
  current.stagingPointer = pointer
  return current
}

// ═══════════════════════════════════════════════════════════════════════════
// getTree
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert a flat CanvasDocument node map into a nested tree structure.
 * Returns null if the document is empty or rootId is not found.
 *
 * The tree is used by the compiler to produce HTML.
 */
export function getTree(doc: CanvasDocument): TreeNode | null {
  const rootNode = doc.nodes[doc.rootId]
  if (!rootNode) return null

  return buildTreeNode(rootNode, doc.nodes)
}

/**
 * Recursively build a TreeNode from a Node and the flat node map.
 */
function buildTreeNode(node: Node, nodes: Record<string, Node>): TreeNode {
  const treeNode: TreeNode = {
    id: node.id,
    type: node.type,
    props: cloneValue(node.props),
    style: cloneValue(node.style),
    children: [],
  }

  for (const childId of node.children) {
    const child = nodes[childId]
    if (child) {
      treeNode.children.push(buildTreeNode(child, nodes))
    }
  }

  return treeNode
}
