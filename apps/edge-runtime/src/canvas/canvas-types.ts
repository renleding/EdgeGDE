/**
 * EdgeGDE Canvas — Core Data Types
 * Canvas Platform v1.0.0
 * Phase 0: CanvasDocument, Node, Mutation, AgentCommand
 * FRS v3: AgentNode, ProposalNode, WorkspacePane, audit/compliance types
 *
 * @packageDocumentation
 */

// ═══════════════════════════════════════════════════════════════════════════
// Canonical Version
// ═══════════════════════════════════════════════════════════════════════════

/** Canonical Canvas Platform version — bump on any change */
export const CANVAS_VERSION = '3.0.0'

// ═══════════════════════════════════════════════════════════════════════════
// Node Types
// ═══════════════════════════════════════════════════════════════════════════

/** Canonical node types for the Canvas system */
export type NodeType = 'Page' | 'Section' | 'Text' | 'Input' | 'Button' | 'Frame'
  | 'AgentNode' | 'ProposalNode' | 'WorkspacePane'

/** Agent lifecycle states (Feature A) */
export type AgentState = 'Idle' | 'Running' | 'Paused' | 'Failed' | 'Completed'

/** Proposal governance states (Feature C) */
export type ProposalStatus = 'Draft' | 'Review' | 'Approved' | 'Rejected'

/**
 * A single node in the flat CanvasDocument node map.
 * - parentId + children form a doubly-linked tree
 * - props carries semantic data (text content, field config, agent state, etc.)
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
    sourceUrl?: string
    description?: string
    createdAt?: number
    updatedAt?: number
  }
  /** Feature B: Timeline entries derived from history (cached for fast rendering) */
  timeline?: TimelineEntry[]
  /** Feature D: Cross-workspace links */
  workspaceLinks?: WorkspaceLink[]
  /** Feature E: Audit trail entries */
  auditTrail?: AuditEntry[]
}

// ═══════════════════════════════════════════════════════════════════════════
// FRS v3 Feature Types
// ═══════════════════════════════════════════════════════════════════════════

/** Feature A: Agent lifecycle data attached to an AgentNode */
export interface AgentNodeData {
  targetNodeId: string
  state: AgentState
  history: Array<{ state: AgentState; ts: number; mutationId: string }>
}

/** Feature C: Proposal governance data attached to a ProposalNode */
export interface ProposalNodeData {
  title: string
  proposerAgentId: string
  status: ProposalStatus
  targetNodes: string[]
  createdAt: number
  updatedAt: number
}

/** Feature D: Cross-workspace connection */
export interface WorkspaceLink {
  id: string
  sourceWorkspaceId: string
  targetWorkspaceId: string
  sourceAgentId: string
  targetAgentId: string
  handoffType: 'artifact' | 'event' | 'query'
  payloadSchema?: string
  lastHandoffAt?: number
  retryCount: number
}

/** Feature E: Audit trail entry */
export interface AuditEntry {
  id: string
  type: 'approve' | 'reject' | 'rollback' | 'info'
  agentId: string
  targetNodeIds: string[]
  timestamp: number
  detail: string
  mutationId: string
}

/** Timeline entry (Feature B) */
export interface TimelineEntry {
  index: number
  type: string
  mutationId: string
  timestamp: number
  hashPrefix: string
  agentId?: string
}

// ═══════════════════════════════════════════════════════════════════════════
// Mutations
// ═══════════════════════════════════════════════════════════════════════════

/** All supported mutation types. Every state change goes through one of these. */
export type Mutation =
  // FRS v1/v2 mutations
  | { type: 'add_node'; node: Node; parentId: string }
  | { type: 'update_node'; nodeId: string; props?: Record<string, any>; style?: Record<string, any> }
  | {
      type: 'delete_node'
      nodeId: string
      /** 'remove_all' (default): delete node and all descendants. 'reparent_children': promote children to parent. */
      strategy?: 'remove_all' | 'reparent_children'
    }
  | { type: 'move_node'; nodeId: string; newParentId: string; newIndex?: number }
  // FRS v3 Feature A: Agent lifecycle
  | { type: 'transition_agent_state'; nodeId: string; newState: AgentState }
  // FRS v3 Feature C: Proposal governance
  | { type: 'create_proposal'; node: Node; proposalData: ProposalNodeData }
  | { type: 'approve_proposal'; nodeId: string }
  | { type: 'reject_proposal'; nodeId: string }
  // FRS v3 Feature B: State rollback
  | { type: 'rollback_to_point'; targetPointer: number }
  // FRS v3 Feature D: Workspace linking
  | { type: 'link_workspaces'; link: WorkspaceLink }

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
  // Feature B: Navigate timeline
  | { type: 'jump_to_timeline'; index: number }
  // Feature B: Filter timeline
  | { type: 'filter_timeline'; mutationType?: string; agentId?: string }
  // Feature C: Proposal interaction
  | { type: 'approve_proposal'; nodeId: string }
  | { type: 'reject_proposal'; nodeId: string }
  // Feature D: Inspect workspace link
  | { type: 'inspect_link'; linkId: string }
  // Feature E: Rollback replay
  | { type: 'rollback_replay'; auditEntryId: string }

/** Messages from CanvasSession_DO to client */
export type ServerMessage =
  | { type: 'state'; doc: CanvasDocument }
  | { type: 'broadcast'; mutation?: Mutation; action?: string; version: number }
  | { type: 'mutation_rejected'; reason: string; currentVersion: number }
  | { type: 'mcp_call_accepted'; version: number }
  | { type: 'mcp_call_failed'; reason: string }
  | { type: 'compiled'; livePointer: number }
  // Feature B: Updated timeline after mutation or jump
  | { type: 'timeline_updated'; timeline: TimelineEntry[]; currentPointer: number }
  // Feature D: Workspace link inspection result
  | { type: 'link_inspection'; link: WorkspaceLink }
  // Feature E: Audit entry added
  | { type: 'audit_entry'; entry: AuditEntry }

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
