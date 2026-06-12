/**
 * EdgeGDE Canvas — Chat Agent API
 * Phase 6.5: Context-scoped AgentCommand generation.
 *
 * Instead of dumping ALL nodes into the prompt, we provide:
 * 1. High-level summary of document structure
 * 2. Full subtree of the selected node (if any)
 * 3. Recently modified nodes (last N mutations)
 * 4. Key nodes (root + direct children)
 *
 * This prevents token overflow as canvas scales.
 *
 * @packageDocumentation
 */

import { agentCommandSchema, type ValidatedAgentCommand } from '../canvas/agent-command-schema'
import type { CanvasDocument } from '../canvas/canvas-types'
import { getTree } from '../canvas/canvas-engine'

// ═══════════════════════════════════════════════════════════════════════════
// Context builders
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build a high-level summary of the canvas structure.
 * Includes node count, type breakdown, and one level of children from root.
 */
function buildSummary(doc: CanvasDocument): string {
  const total = Object.keys(doc.nodes).length
  const types: Record<string, number> = {}
  for (const n of Object.values(doc.nodes)) {
    types[n.type] = (types[n.type] || 0) + 1
  }
  const typeBreakdown = Object.entries(types)
    .map(([t, c]) => `${t}×${c}`).join(', ')

  const root = doc.nodes[doc.rootId]
  const directChildren = root?.children?.map((id: string) => {
    const child = doc.nodes[id]
    if (!child) return id
    return `${id} (${child.type}${child.children.length ? `, ${child.children.length} children` : ''})`
  }).join('; ') || '(none)'

  return `SUMMARY: ${total} nodes (${typeBreakdown})
ROOT: ${doc.rootId} — direct children: ${directChildren}`
}

/**
 * Build a detailed node section for a specific subtree (selected node).
 * Returns a recursive tree representation with full props and style.
 */
function buildSubtreeDetail(doc: CanvasDocument, nodeId: string, maxDepth = 5): string {
  const node = doc.nodes[nodeId]
  if (!node) return ''

  const lines: string[] = []

  function walk(id: string, depth: number): void {
    if (depth > maxDepth) {
      lines.push('  '.repeat(depth) + '...(max depth reached)')
      return
    }
    const n = doc.nodes[id]
    if (!n) return
    const indent = '  '.repeat(depth)
    const textInfo = n.props?.text ? ` text="${n.props.text.slice(0, 60)}"` : ''
    const styleKeys = Object.keys(n.style).length
    const styleInfo = styleKeys ? ` style_keys=[${Object.keys(n.style).join(',')}]` : ''
    const childInfo = n.children.length ? ` children=${n.children.length}` : ''
    const fieldInfo = n.props?.name ? ` name="${n.props.name}"` : ''
    const typeInfo = n.props?.type ? ` inputType="${n.props.type}"` : ''
    const placeholderInfo = n.props?.placeholder ? ` placeholder="${n.props.placeholder}"` : ''
    lines.push(`${indent}[${id}] ${n.type}${textInfo}${styleInfo}${childInfo}${fieldInfo}${typeInfo}${placeholderInfo}`)

    for (const childId of n.children) {
      walk(childId, depth + 1)
    }
  }

  lines.push(`SELECTED SUBTREE (root: ${nodeId}):`)
  walk(nodeId, 1)
  return lines.join('\n')
}

/**
 * List recently modified node IDs from the last N mutations.
 */
function buildRecentChanges(doc: CanvasDocument, maxCount = 5): string {
  const recent = doc.history.slice(-maxCount)
  if (recent.length === 0) return 'RECENT CHANGES: (none)'

  const changes = recent.map((m: any) => {
    if (m.type === 'add_node') return `  + added "${m.node?.id}" (${m.node?.type}) under "${m.parentId}"`
    if (m.type === 'update_node') return `  ~ updated "${m.nodeId}"`
    if (m.type === 'delete_node') return `  - deleted "${m.nodeId}"`
    if (m.type === 'move_node') return `  > moved "${m.nodeId}" to "${m.newParentId}"`
    return `  ? ${m.type}`
  }).join('\n')

  return `RECENT CHANGES (last ${recent.length}):\n${changes}`
}

/**
 * Build key nodes section — root + direct children with full props/style.
 */
function buildKeyNodes(doc: CanvasDocument): string {
  const root = doc.nodes[doc.rootId]
  if (!root) return 'KEY NODES: (none)'

  const lines: string[] = ['KEY NODES:']
  const candidates = [root, ...root.children.map((id: string) => doc.nodes[id]).filter(Boolean)]

  for (const n of candidates) {
    const textInfo = n.props?.text ? ` text="${n.props.text.slice(0, 60)}"` : ''
    const styleStr = Object.keys(n.style).length
      ? ' style={' + Object.entries(n.style).slice(0, 5).map(([k, v]) => `${k}:${v}`).join(', ') + (Object.keys(n.style).length > 5 ? ', ...' : '') + '}'
      : ''
    const childInfo = n.children.length ? ` children=[${n.children.join(',')}]` : ''
    lines.push(`  [${n.id}] ${n.type}${textInfo}${styleStr}${childInfo}`)
  }

  return lines.join('\n')
}

// ═══════════════════════════════════════════════════════════════════════════
// System Prompt Builder
// ═══════════════════════════════════════════════════════════════════════════

function buildSystemPrompt(
  doc: CanvasDocument,
  userMessage: string,
  selectedNodeId?: string,
): string {
  const version = doc.version
  const summary = buildSummary(doc)
  const keyNodes = buildKeyNodes(doc)
  const recentChanges = buildRecentChanges(doc)
  const subtreeDetail = selectedNodeId ? buildSubtreeDetail(doc, selectedNodeId) : ''
  const totalTokens = Object.keys(doc.nodes).length

  return `You are a website editor agent for the EdgeGDE Canvas platform.
Your ONLY output format is a JSON object.
You MUST NOT output HTML, natural language, or any other format.
You are expected to reason about the user request and generate mutations accordingly.

CONTEXT:
- Version: ${version}
- ${summary}
- Total nodes available: ${totalTokens}

${keyNodes}

${recentChanges}

${subtreeDetail}

AVAILABLE MUTATIONS (output these in your JSON response):
- add_node: Create a new node. Fields: node {id, type, props, style}, parentId
- update_node: Modify an existing node. Fields: nodeId, optional props, style
- delete_node: Remove a node. Fields: nodeId, optional strategy ("remove_all" default, "reparent_children")
- move_node: Reparent a node. Fields: nodeId, newParentId, optional newIndex

RULES:
1. Use EXISTING node IDs from KEY NODES or SELECTED SUBTREE when referencing existing nodes
2. Generate NEW unique IDs for new nodes (descriptive names like "hero-section", "feature-card-1")
3. All style keys use camelCase (backgroundColor, fontSize, padding, margin, borderRadius)
4. Use dark theme colors (#0d1117 bg, #1c2128 cards, #58a6ff accent, #f0f6fc text, #8b949e muted)
5. Include the CURRENT version (${version}) as expectedVersion
6. Output valid JSON matching this type:

{
  "intent": "description of the change",
  "expectedVersion": ${version},
  "mutations": [
    { "type": "add_node", "node": { "id": "...", "type": "Text", "parentId": null, "props": {}, "style": {} }, "parentId": "root-id" },
    { "type": "update_node", "nodeId": "...", "props": { "text": "..." }, "style": { "fontSize": "24px" } }
  ]
}

USER REQUEST: ${userMessage}

Respond ONLY with the JSON object. No explanation. No markdown. No code fences.`
}

// ═══════════════════════════════════════════════════════════════════════════
// LLM Provider
// ═══════════════════════════════════════════════════════════════════════════

async function callLLM(prompt: string, apiKey: string): Promise<string> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://edgegde-calculator.renleding.workers.dev',
      'X-Title': 'EdgeGDE Canvas',
    },
    body: JSON.stringify({
      model: 'deepseek/deepseek-v4-flash',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 3000,
    }),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => 'unknown')
    throw new Error(`LLM error: ${response.status} — ${errText}`)
  }

  const data: any = await response.json()
  return data?.choices?.[0]?.message?.content || ''
}

// ═══════════════════════════════════════════════════════════════════════════
// Canvas Chat Handler
// ═══════════════════════════════════════════════════════════════════════════

export interface ChatResult {
  success: boolean
  intent?: string
  version?: number
  mutCount?: number
  error?: string
}

/**
 * Handle a chat message for a canvas with context-scoped prompting.
 *
 * @param canvasId - Canvas ID
 * @param userMessage - User's natural language request
 * @param env - Worker env bindings
 * @param selectedNodeId - Optional: scope context to this node's subtree
 */
export async function handleCanvasChat(
  canvasId: string,
  userMessage: string,
  env: any,
  selectedNodeId?: string,
): Promise<ChatResult> {
  const doId = env.CANVAS_SESSION.idFromName(canvasId)
  const stub = env.CANVAS_SESSION.get(doId)

  const stateRes = await stub.fetch('http://dO/state')
  if (stateRes.status !== 200) return { success: false, error: 'Canvas not found' }

  const doc: CanvasDocument = await stateRes.json()

  // Build context-scoped prompt
  const systemPrompt = buildSystemPrompt(doc, userMessage, selectedNodeId)
  const llmKey = env.LLM_API_KEY || ''
  if (!llmKey) return { success: false, error: 'LLM_API_KEY not configured' }

  const llmResponse = await callLLM(systemPrompt, llmKey)
  if (!llmResponse) return { success: false, error: 'LLM returned empty response' }

  // Parse and validate with Zod
  let parsed: any
  try {
    const clean = llmResponse.replace(/^```(?:json)?\n?|```\n?$/g, '').trim()
    parsed = JSON.parse(clean)
  } catch {
    return { success: false, error: 'LLM returned invalid JSON' }
  }

  let agentCommand!: ValidatedAgentCommand
  try {
    agentCommand = agentCommandSchema.parse(parsed)
  } catch (e: any) {
    const issues = e.issues?.map((i: any) => `${i.path.join('.')}: ${i.message}`).join('; ') || e.message
    return { success: false, error: `AgentCommand validation failed: ${issues}` }
  }

  // 4. Apply all mutations in a single batch request
  const batchRes = await stub.fetch('http://dO/mutation/batch', {
    method: 'POST',
    body: JSON.stringify({
      mutations: agentCommand.mutations,
      expectedVersion: agentCommand.expectedVersion,
    }),
  })

  if (batchRes.status === 409) {
    return { success: false, error: 'Version conflict — re-sync and retry' }
  }
  if (!batchRes.ok) {
    const errBody = await batchRes.json().catch(() => ({ error: 'Unknown error' }))
    return { success: false, error: errBody.error || 'Mutation failed' }
  }

  const batchData = await batchRes.json() as any

  return {
    success: true,
    intent: agentCommand.intent,
    version: doc.version + agentCommand.mutations.length,
    mutCount: agentCommand.mutations.length,
  }
}
