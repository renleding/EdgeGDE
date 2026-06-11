/**
 * EdgeGDE Canvas — AgentCommand Zod Schema
 * Phase 6: Strict validation for LLM → Canvas mutation protocol.
 *
 * AgentCommand is the ONLY way an agent can mutate canvas state.
 * FieldParser MUST NOT be used for UI mutations.
 *
 * @packageDocumentation
 */

import { z } from 'zod'

// ═══════════════════════════════════════════════════════════════════════════
// Node Schema
// ═══════════════════════════════════════════════════════════════════════════

const nodeTypeSchema = z.enum(['Page', 'Section', 'Text', 'Input', 'Button', 'Frame'])

const nodeSchema = z.object({
  id: z.string().min(1),
  type: nodeTypeSchema,
  parentId: z.string().nullable(),
  children: z.array(z.string()).default([]),
  props: z.record(z.any()).default({}),
  style: z.record(z.any()).default({}),
})

// ═══════════════════════════════════════════════════════════════════════════
// Mutation Schemas
// ═══════════════════════════════════════════════════════════════════════════

const addNodeMutationSchema = z.object({
  type: z.literal('add_node'),
  node: nodeSchema,
  parentId: z.string().min(1),
})

const updateNodeMutationSchema = z.object({
  type: z.literal('update_node'),
  nodeId: z.string().min(1),
  props: z.record(z.any()).optional(),
  style: z.record(z.any()).optional(),
})

const deleteNodeMutationSchema = z.object({
  type: z.literal('delete_node'),
  nodeId: z.string().min(1),
  strategy: z.enum(['remove_all', 'reparent_children']).optional(),
})

const moveNodeMutationSchema = z.object({
  type: z.literal('move_node'),
  nodeId: z.string().min(1),
  newParentId: z.string().min(1),
  newIndex: z.number().int().min(0).optional(),
})

const mutationSchema = z.discriminatedUnion('type', [
  addNodeMutationSchema,
  updateNodeMutationSchema,
  deleteNodeMutationSchema,
  moveNodeMutationSchema,
])

// ═══════════════════════════════════════════════════════════════════════════
// AgentCommand Schema
// ═══════════════════════════════════════════════════════════════════════════

export const agentCommandSchema = z.object({
  intent: z.string().min(1, 'intent is required'),
  expectedVersion: z.number().int().min(0, 'expectedVersion must be >= 0'),
  mutations: z.array(mutationSchema).min(1, 'at least one mutation required'),
})

export type ValidatedAgentCommand = z.infer<typeof agentCommandSchema>
