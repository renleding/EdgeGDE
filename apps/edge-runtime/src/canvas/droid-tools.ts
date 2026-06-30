/**
 * Droid CLI — Constrained Tool Schemas (FRS v3 Rec #5)
 * ======================================================
 * Defines the allowed tool operations for Droid execution.
 * Every tool call is validated against its schema before execution.
 *
 * This is the execution surface — Droid can only invoke pre-approved tools.
 *
 * @packageDocumentation
 */

import { z } from 'zod'

// ═══════════════════════════════════════════════════════════════════════════
// Tool Identifiers
// ═══════════════════════════════════════════════════════════════════════════

export type DroidToolName =
  | 'architecture_summary'
  | 'read_file'
  | 'list_dir'
  | 'write_text'
  | 'shell'
  | 'delete'
  | 'kanban_create'
  | 'verify'

// ═══════════════════════════════════════════════════════════════════════════
// Tool Schemas
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Produce a structured codebase overview.
 * No side effects — read-only.
 */
export const ArchitectureSummarySchema = z.object({
  tool: z.literal('architecture_summary'),
  params: z.object({
    path: z.string().optional().describe('Root path to analyze'),
    depth: z.number().int().min(1).max(5).optional().describe('Directory depth'),
    fileGlob: z.string().optional().describe('File pattern filter (e.g. "*.ts")'),
  }),
})

/**
 * Read a file's contents.
 * No mutations — pure read.
 */
export const ReadFileSchema = z.object({
  tool: z.literal('read_file'),
  params: z.object({
    path: z.string().min(1).describe('Absolute or relative file path'),
    offset: z.number().int().min(0).optional().describe('Line offset'),
    limit: z.number().int().min(1).max(2000).optional().describe('Max lines'),
  }),
})

/**
 * List directory contents.
 * No mutations — pure read.
 */
export const ListDirSchema = z.object({
  tool: z.literal('list_dir'),
  params: z.object({
    path: z.string().min(1).describe('Directory path'),
    depth: z.number().int().min(1).max(3).optional().describe('Recursion depth'),
  }),
})

/**
 * Write content to a file.
 * MUTATION — authorized paths only.
 */
export const WriteTextSchema = z.object({
  tool: z.literal('write_text'),
  params: z.object({
    path: z.string().min(1).describe('Target file path'),
    content: z.string().describe('File content to write'),
    append: z.boolean().optional().describe('Append instead of overwrite'),
  }),
})

/**
 * Execute a shell command.
 * HIGH-RISK — requires allow_shell: true in Mission Manifest.
 */
export const ShellSchema = z.object({
  tool: z.literal('shell'),
  params: z.object({
    command: z.string().min(1).describe('Shell command to execute'),
    timeout: z.number().int().min(1).max(300).optional().describe('Timeout in seconds'),
    workdir: z.string().optional().describe('Working directory'),
  }),
})

/**
 * Delete a file or directory.
 * HIGH-RISK — requires allow_delete: true in Mission Manifest.
 */
export const DeleteSchema = z.object({
  tool: z.literal('delete'),
  params: z.object({
    path: z.string().min(1).describe('File or directory path to delete'),
    recursive: z.boolean().optional().describe('Recursive deletion for directories'),
  }),
})

/**
 * Create a Kanban task.
 * Low-risk — communicates intent.
 */
export const KanbanCreateSchema = z.object({
  tool: z.literal('kanban_create'),
  params: z.object({
    title: z.string().min(1).describe('Kanban task title'),
    body: z.string().optional().describe('Task description'),
    assignee: z.string().optional().describe('Assignee name'),
  }),
})

/**
 * Run a verification gate (typecheck, tests, lint).
 * Read-only execution — no side effects beyond logs.
 */
export const VerifySchema = z.object({
  tool: z.literal('verify'),
  params: z.object({
    check: z.enum(['typecheck', 'tests', 'lint', 'governance', 'all']).describe('Verification gate to run'),
  }),
})

// ═══════════════════════════════════════════════════════════════════════════
// Union Schema — Every Droid call is one of these
// ═══════════════════════════════════════════════════════════════════════════

export const DroidToolCallSchema = z.discriminatedUnion('tool', [
  ArchitectureSummarySchema,
  ReadFileSchema,
  ListDirSchema,
  WriteTextSchema,
  ShellSchema,
  DeleteSchema,
  KanbanCreateSchema,
  VerifySchema,
])

// ═══════════════════════════════════════════════════════════════════════════
// Tool Classification
// ═══════════════════════════════════════════════════════════════════════════

export type ToolRiskLevel = 'read' | 'mutation' | 'high-risk'

export const TOOL_RISK_LEVELS: Record<DroidToolName, ToolRiskLevel> = {
  architecture_summary: 'read',
  read_file: 'read',
  list_dir: 'read',
  verify: 'read',
  write_text: 'mutation',
  kanban_create: 'mutation',
  shell: 'high-risk',
  delete: 'high-risk',
}

export const READ_TOOLS: DroidToolName[] = ['architecture_summary', 'read_file', 'list_dir', 'verify']
export const MUTATION_TOOLS: DroidToolName[] = ['write_text', 'kanban_create']
export const HIGH_RISK_TOOLS: DroidToolName[] = ['shell', 'delete']
export const ALL_TOOLS: DroidToolName[] = [...READ_TOOLS, ...MUTATION_TOOLS, ...HIGH_RISK_TOOLS]

// ═══════════════════════════════════════════════════════════════════════════
// Inference type
// ═══════════════════════════════════════════════════════════════════════════

export type DroidToolCall = z.infer<typeof DroidToolCallSchema>
