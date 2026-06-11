/**
 * EdgeGDE Canvas — Core Data Types
 * Canvas Platform v1.0.0
 * Phase 0: CanvasDocument, Node, Mutation, AgentCommand
 *
 * @packageDocumentation
 */

// ═══════════════════════════════════════════════════════════════════════════
// Canonical Version
// ═══════════════════════════════════════════════════════════════════════════

/** Canonical Canvas Platform version — bump on any change */
export const CANVAS_VERSION = '1.0.0'

// ═══════════════════════════════════════════════════════════════════════════
// Node Types
// ═══════════════════════════════════════════════════════════════════════════

/** Canonical node types for the Canvas system */
export type NodeType = 'Page' | 'Section' | 'Text' | 'Input' | 'Button' | 'Frame'

/**
 * A single node in the flat CanvasDocument node map.
 * - parentId + children form a doubly-linked tree
 * - props carries semantic data (text content, field config, etc.)
 * - style carries CSS property map (camelCase keys)
 */
export interface Node {
  id: string
  type: NodeType
  parentId: string | null
  children: string[]
  props: Record<string, any>
  style: Record<string, any>
}

// ═══════════════════════════════════════════════════════════════════════════
// CanvasDocument (Single Source of Truth)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The authoritative state of a Canvas.
 * - Flat node map for O(1) lookup
 * - Two-pointer versioning (stagingPointer for editing, livePointer for deployed)
 * - history is append-only; pointers move within it
 */
export interface CanvasDocument {
  id: string
  version: number
  /** Snapshot of nodes at version 0, before any mutations. Used by rebuildDocFromHistory. */
  baseNodes: Record<string, Node>
  nodes: Record<string, Node>
    rootId: string
    history: Mutation[]
  stagingPointer: number
  livePointer: number
  metadata?: {
    name?: string
    tenantId?: string
    source?: string
    createdAt?: number
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Mutations
// ═══════════════════════════════════════════════════════════════════════════

/** All supported mutation types. Every state change goes through one of these. */
export type Mutation =
  | { type: 'add_node'; node: Node; parentId: string }
  | { type: 'update_node'; nodeId: string; props?: Record<string, any>; style?: Record<string, any> }
  | {
      type: 'delete_node'
      nodeId: string
      /** 'remove_all' (default): delete node and all descendants. 'reparent_children': promote children to parent. */
      strategy?: 'remove_all' | 'reparent_children'
    }
  | { type: 'move_node'; nodeId: string; newParentId: string; newIndex?: number }

// ═══════════════════════════════════════════════════════════════════════════
// Agent Protocol
// ═══════════════════════════════════════════════════════════════════════════

/** Structured command from an agent (LLM). Zod-validated on ingress. */
export interface AgentCommand {
  intent: string
  expectedVersion: number
  mutations: Mutation[]
}

// ═══════════════════════════════════════════════════════════════════════════
// WebSocket Protocol
// ═══════════════════════════════════════════════════════════════════════════

/** Messages from client to CanvasSession_DO */
export type ClientMessage =
  | { type: 'mutation'; mutation: Mutation; expectedVersion: number }
  | { type: 'mcp_call'; tool: string; payload: Record<string, any>; expectedVersion: number }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'deploy' }
  | { type: 'request_state' }

/** Messages from CanvasSession_DO to client */
export type ServerMessage =
  | { type: 'state'; doc: CanvasDocument }
  | { type: 'broadcast'; mutation?: Mutation; action?: string; version: number }
  | { type: 'mutation_rejected'; reason: string; currentVersion: number }
  | { type: 'mcp_call_accepted'; version: number }
  | { type: 'mcp_call_failed'; reason: string }
  | { type: 'compiled'; livePointer: number }

// ═══════════════════════════════════════════════════════════════════════════
// Tree Representation (compiled view of flat node map)
// ═══════════════════════════════════════════════════════════════════════════

/** Nested tree node derived from the flat CanvasDocument node map. */
export interface TreeNode {
  id: string
  type: NodeType
  props: Record<string, any>
  style: Record<string, any>
  children: TreeNode[]
}
