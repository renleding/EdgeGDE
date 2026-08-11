/**
 * EdgeGDE Canvas — Zod Schemas for Deterministic Mutation Validation
 * FRS v3 Recommendation #1: Structured Outputs / JSON Schema
 *
 * Every mutation must pass schema validation before entering the
 * append-only history. This eliminates the #1 failure mode (parse errors)
 * and enables Aegis governance gates to validate structurally.
 *
 * @packageDocumentation
 */

import { z } from 'zod'

// ═══════════════════════════════════════════════════════════════════════════
// Reusable Primitives
// ═══════════════════════════════════════════════════════════════════════════

export const NodeIdSchema = z.string().min(1, 'Node ID must be non-empty')
export const ParentIdSchema = z.string().min(1, 'Parent ID must be non-empty').nullable()
export const TimestampSchema = z.number().int().positive()
export const ColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be hex color')
/** HexHashSchema. */
export const HexHashSchema = z.string().regex(/^[0-9a-f]{8}$/, 'Must be 8-char hex hash')

// ═══════════════════════════════════════════════════════════════════════════
// Node Types
// ═══════════════════════════════════════════════════════════════════════════

export const NodeTypeSchema = z.enum([
  'Page', 'Section', 'Text', 'Input', 'Button', 'Frame',
  'AgentNode', 'ProposalNode', 'WorkspacePane',
])

/** AgentStateSchema. */
export const AgentStateSchema = z.enum(['Idle', 'Running', 'Paused', 'Failed', 'Completed'])

/** ProposalStatusSchema. */
export const ProposalStatusSchema = z.enum(['Draft', 'Review', 'Approved', 'Rejected'])

// ═══════════════════════════════════════════════════════════════════════════
// Node Schema
// ═══════════════════════════════════════════════════════════════════════════

export const NodeSchema = z.object({
  id: NodeIdSchema,
  type: NodeTypeSchema,
  parentId: ParentIdSchema,
  children: z.array(NodeIdSchema).default([]),
  props: z.record(z.string(), z.any()).default({}),
  style: z.record(z.string(), z.any()).default({}),
})

// ═══════════════════════════════════════════════════════════════════════════
// Agent History Entry (Feature A)
// ═══════════════════════════════════════════════════════════════════════════

export const AgentHistoryEntrySchema = z.object({
  state: AgentStateSchema,
  ts: TimestampSchema,
  mutationId: z.string().min(1),
  fromState: AgentStateSchema.default('Idle'),
})

// ═══════════════════════════════════════════════════════════════════════════
// Proposal Data (Feature C)
// ═══════════════════════════════════════════════════════════════════════════

export const ProposalNodeDataSchema = z.object({
  title: z.string().min(1, 'Proposal title required'),
  proposerAgentId: z.string().min(1),
  status: ProposalStatusSchema,
  targetNodes: z.array(NodeIdSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

// ═══════════════════════════════════════════════════════════════════════════
// Workspace Link (Feature D)
// ═══════════════════════════════════════════════════════════════════════════

export const WorkspaceLinkSchema = z.object({
  id: z.string().min(1),
  sourceWorkspaceId: z.string().min(1),
  targetWorkspaceId: z.string().min(1),
  sourceAgentId: z.string().min(1),
  targetAgentId: z.string().min(1),
  handoffType: z.enum(['artifact', 'event', 'query']),
  payloadSchema: z.string().optional(),
  lastHandoffAt: TimestampSchema.optional(),
  retryCount: z.number().int().min(0).default(0),
})

// ═══════════════════════════════════════════════════════════════════════════
// Audit Entry (Feature E)
// ═══════════════════════════════════════════════════════════════════════════

export const AuditEntrySchema = z.object({
  id: z.string().min(1),
  type: z.enum(['approve', 'reject', 'rollback', 'info']),
  agentId: z.string().min(1),
  targetNodeIds: z.array(NodeIdSchema).default([]),
  timestamp: TimestampSchema,
  detail: z.string(),
  mutationId: z.string().min(1),
})

// ═══════════════════════════════════════════════════════════════════════════
// Timeline Entry (Feature B)
// ═══════════════════════════════════════════════════════════════════════════

export const TimelineEntrySchema = z.object({
  index: z.number().int().min(0),
  type: z.string().min(1),
  mutationId: z.string().min(1),
  timestamp: TimestampSchema,
  hashPrefix: HexHashSchema,
  agentId: z.string().optional(),
})

// ═══════════════════════════════════════════════════════════════════════════
// Mutation Schemas (one per type — this is the core of FRS v3 Rec #1)
// ═══════════════════════════════════════════════════════════════════════════

// FRS v1/v2 mutations
export const AddNodeMutationSchema = z.object({
  type: z.literal('add_node'),
  node: NodeSchema,
  parentId: ParentIdSchema,
})

/** UpdateNodeMutationSchema. */
export const UpdateNodeMutationSchema = z.object({
  type: z.literal('update_node'),
  nodeId: NodeIdSchema,
  props: z.record(z.string(), z.any()).optional(),
  style: z.record(z.string(), z.any()).optional(),
})

/** DeleteNodeMutationSchema. */
export const DeleteNodeMutationSchema = z.object({
  type: z.literal('delete_node'),
  nodeId: NodeIdSchema,
  strategy: z.enum(['remove_all', 'reparent_children']).optional(),
})

/** MoveNodeMutationSchema. */
export const MoveNodeMutationSchema = z.object({
  type: z.literal('move_node'),
  nodeId: NodeIdSchema,
  newParentId: ParentIdSchema,
  newIndex: z.number().int().min(0).optional(),
})

// FRS v3 Feature A: Agent lifecycle
export const TransitionAgentStateMutationSchema = z.object({
  type: z.literal('transition_agent_state'),
  nodeId: NodeIdSchema,
  newState: AgentStateSchema,
})

// FRS v3 Feature C: Proposal governance
export const CreateProposalMutationSchema = z.object({
  type: z.literal('create_proposal'),
  node: NodeSchema,
  proposalData: ProposalNodeDataSchema,
})

/** ApproveProposalMutationSchema. */
export const ApproveProposalMutationSchema = z.object({
  type: z.literal('approve_proposal'),
  nodeId: NodeIdSchema,
})

/** RejectProposalMutationSchema. */
export const RejectProposalMutationSchema = z.object({
  type: z.literal('reject_proposal'),
  nodeId: NodeIdSchema,
})

// FRS v3 Feature B: State rollback
export const RollbackToPointMutationSchema = z.object({
  type: z.literal('rollback_to_point'),
  targetPointer: z.number().int().min(-1),
})

// FRS v3 Feature D: Workspace linking
export const LinkWorkspacesMutationSchema = z.object({
  type: z.literal('link_workspaces'),
  link: WorkspaceLinkSchema,
})

// ═══════════════════════════════════════════════════════════════════════════
// Union Schema — Every mutation is one of these
// ═══════════════════════════════════════════════════════════════════════════

export const MutationSchema = z.discriminatedUnion('type', [
  AddNodeMutationSchema,
  UpdateNodeMutationSchema,
  DeleteNodeMutationSchema,
  MoveNodeMutationSchema,
  TransitionAgentStateMutationSchema,
  CreateProposalMutationSchema,
  ApproveProposalMutationSchema,
  RejectProposalMutationSchema,
  RollbackToPointMutationSchema,
  LinkWorkspacesMutationSchema,
])

// ═══════════════════════════════════════════════════════════════════════════
// Agent Command Schema
// ═══════════════════════════════════════════════════════════════════════════

export const AgentCommandSchema = z.object({
  intent: z.string().min(1),
  expectedVersion: z.number().int().min(0),
  mutations: z.array(MutationSchema).min(1, 'At least one mutation required'),
})

// ═══════════════════════════════════════════════════════════════════════════
// CanvasDocument Schema — validates entire document structure
// ═══════════════════════════════════════════════════════════════════════════

export const CanvasDocumentSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().min(0),
  baseNodes: z.record(NodeIdSchema, NodeSchema),
  nodes: z.record(NodeIdSchema, NodeSchema),
  rootId: NodeIdSchema,
  history: z.array(MutationSchema),
  stagingPointer: z.number().int().min(-1),
  livePointer: z.number().int().min(-1),
  metadata: z.object({
    name: z.string().optional(),
    tenantId: z.string().optional(),
    source: z.string().optional(),
    sourceUrl: z.url().optional(),
    description: z.string().optional(),
    createdAt: TimestampSchema.optional(),
    updatedAt: TimestampSchema.optional(),
  }).optional(),
  timeline: z.array(TimelineEntrySchema).optional(),
  workspaceLinks: z.array(WorkspaceLinkSchema).optional(),
  auditTrail: z.array(AuditEntrySchema).optional(),
})

// ═══════════════════════════════════════════════════════════════════════════
// Inference types derived from Zod schemas
// ═══════════════════════════════════════════════════════════════════════════

export type MutationValidation = z.infer<typeof MutationSchema>
export type NodeValidation = z.infer<typeof NodeSchema>
export type AgentCommandValidation = z.infer<typeof AgentCommandSchema>
export type CanvasDocumentValidation = z.infer<typeof CanvasDocumentSchema>
export type AuditEntryValidation = z.infer<typeof AuditEntrySchema>
