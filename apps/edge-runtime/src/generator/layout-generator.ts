/**
 * EdgeGDE Canvas — Layout Generator
 * Canvas Platform v1.0.0
 * Phase 5: LLM prompt → CanvasDocument generation.
 *
 * Takes a natural language prompt and generates a structured CanvasDocument.
 * The LLM outputs JSON matching the CanvasNode schema — NO HTML output.
 *
 * @packageDocumentation
 */

import type { CanvasDocument, Node, NodeType } from '../canvas/canvas-types'

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/** Configuration for the LLM provider */
export interface GeneratorConfig {
  /** API key for the LLM provider */
  apiKey?: string
  /** Model name (defaults to deepseek/deepseek-v4-flash) */
  model?: string
  /** Custom LLM provider function (for testing) */
  llmProvider?: (prompt: string) => Promise<any>
}

/** Expected shape of the LLM's JSON response */
interface LLMResponse {
  nodes: Array<{
    id: string
    type: NodeType
    parentId: string | null
    props?: Record<string, any>
    style?: Record<string, any>
  }>
  rootId: string
  title?: string
}

// ═══════════════════════════════════════════════════════════════════════════
// System Prompt
// ═══════════════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `You are a website layout generator for the EdgeGDE Canvas platform.
Output a STRICT JSON object — NO markdown, NO code fences, NO explanation.

The output must match this TypeScript interface:

{
  "nodes": [
    {
      "id": "unique-string-id",
      "type": "Page" | "Section" | "Text" | "Input" | "Button" | "Frame",
      "parentId": "id-of-parent-or-null-for-root",
      "props": { "text": "string content for text nodes", "placeholder": "for inputs", "href": "for links", "src": "for images" },
      "style": { "key": "css-value" }
    }
  ],
  "rootId": "id-of-the-page-node",
  "title": "Suggested page title"
}

RULES:
- The root node MUST have type "Page" and parentId null
- All other nodes MUST have a parentId that references an existing node
- Nodes are listed in the array — parent-child relationships are defined by parentId
- Use semantic types: Page (root container), Section (grouping), Text (headings/paragraphs), Input (form fields), Button (action buttons), Frame (generic container)
- Style keys use camelCase (e.g., "backgroundColor", "fontSize", "padding")
- Colors: use hex (#fff, #000) or named colors
- Layout: use flex-based layout (display: "flex", flexDirection: "column", gap, padding, margin)
- For realistic content, generate proper text for the requested type of site
- Include at least: hero section (title + subtitle), features section (3 items), footer, and contact form
- Make it beautiful: use dark theme colors (#0d1117 background, #1c2128 card backgrounds, #58a6ff accent, #e1e4e8 text)
- Generate 10-20 nodes for a complete page layout

EXAMPLE OUTPUT:
{"nodes":[{"id":"pg1","type":"Page","parentId":null,"props":{},"style":{"backgroundColor":"#0d1117"}},{"id":"hero","type":"Section","parentId":"pg1","props":{},"style":{"padding":"80px 40px"}},{"id":"title","type":"Text","parentId":"hero","props":{"text":"Welcome to Our Platform"},"style":{"fontSize":"48px","fontWeight":"700","color":"#f0f6fc"}},{"id":"sub","type":"Text","parentId":"hero","props":{"text":"Built for the modern web"},"style":{"fontSize":"20px","color":"#8b949e"}},{"id":"features","type":"Section","parentId":"pg1","props":{},"style":{"display":"flex","gap":"20px","padding":"40px"}},{"id":"f1","type":"Frame","parentId":"features","props":{"text":"Speed"},"style":{"padding":"20px","backgroundColor":"#1c2128","borderRadius":"8px"}},{"id":"f2","type":"Frame","parentId":"features","props":{"text":"Security"},"style":{"padding":"20px","backgroundColor":"#1c2128","borderRadius":"8px"}},{"id":"f3","type":"Frame","parentId":"features","props":{"text":"Scale"},"style":{"padding":"20px","backgroundColor":"#1c2128","borderRadius":"8px"}},{"id":"footer","type":"Section","parentId":"pg1","props":{"text":"© 2026"},"style":{"padding":"20px","textAlign":"center","color":"#8b949e"}}],"rootId":"pg1","title":"Platform Landing Page"}`

// ═══════════════════════════════════════════════════════════════════════════
// Default LLM Provider (OpenRouter)
// ═══════════════════════════════════════════════════════════════════════════

async function defaultLLMProvider(prompt: string, apiKey: string, model: string): Promise<any> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://edgegde-calculator.renleding.workers.dev',
      'X-Title': 'EdgeGDE Canvas',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 4000,
    }),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => 'unknown')
    throw new Error(`LLM API error: ${response.status} — ${errText}`)
  }

  const data: any = await response.json()
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('LLM returned empty response')

  return JSON.parse(content.replace(/^```(?:json)?\n?|```\n?$/g, '').trim())
}

// ═══════════════════════════════════════════════════════════════════════════
// Response Validation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate an LLM response and build a CanvasDocument.
 * Checks:
 * - Root node exists and is type Page
 * - All parentId references are valid
 * - Node IDs are unique
 * - Types are valid NodeType values
 */
function validateAndBuild(response: LLMResponse): CanvasDocument {
  const { nodes: rawNodes, rootId, title } = response

  if (!rawNodes || !Array.isArray(rawNodes) || rawNodes.length === 0) {
    throw new Error('LLM response must include a non-empty "nodes" array')
  }

  const VALID_TYPES = new Set(['Page', 'Section', 'Text', 'Input', 'Button', 'Frame'])
  const nodeMap: Record<string, Node> = {}
  const ids = new Set<string>()

  // Build node map with validation
  for (const raw of rawNodes) {
    if (!raw.id) throw new Error('Each node must have an "id" field')
    if (ids.has(raw.id)) throw new Error(`Duplicate node id: "${raw.id}"`)
    if (!VALID_TYPES.has(raw.type)) throw new Error(`Invalid node type: "${raw.type}"`)

    ids.add(raw.id)
    nodeMap[raw.id] = {
      id: raw.id,
      type: raw.type,
      parentId: raw.parentId || null,
      children: [],
      props: raw.props || {},
      style: raw.style || {},
    }
  }

  // Validate root
  const root = nodeMap[rootId]
  if (!root) throw new Error(`Root node "${rootId}" not found in nodes`)
  if (root.type !== 'Page') throw new Error(`Root node must have type "Page", got "${root.type}"`)

  // Build children arrays and validate parent references
  for (const nodeId in nodeMap) {
    const node = nodeMap[nodeId]
    if (node.parentId) {
      const parent = nodeMap[node.parentId]
      if (!parent) throw new Error(`Parent "${node.parentId}" not found for node "${nodeId}"`)
      parent.children.push(nodeId)
    }
  }

  const docId = `canvas-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const doc: CanvasDocument = {
    id: docId,
    version: 0,
    baseNodes: JSON.parse(JSON.stringify(nodeMap)),
    nodes: nodeMap,
    rootId,
    history: [],
    stagingPointer: -1,
    livePointer: -1,
    metadata: {
      name: title || 'Generated Website',
      source: 'ai-generated',
      createdAt: Date.now(),
    },
  }

  return doc
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a CanvasDocument from a natural language prompt.
 *
 * @param prompt - User's description of the desired website
 * @param config - Generator configuration (API key, model, or custom LLM provider)
 * @returns A validated CanvasDocument
 * @throws {Error} If the LLM response is invalid or the API call fails
 */
export async function generateCanvas(
  prompt: string,
  config: GeneratorConfig = {},
): Promise<CanvasDocument> {
  const apiKey = config.apiKey || ''
  const model = config.model || 'deepseek/deepseek-v4-flash'

  let response: LLMResponse

  if (config.llmProvider) {
    response = await config.llmProvider(prompt)
  } else {
    if (!apiKey) throw new Error('LLM_API_KEY required for generation')
    response = await defaultLLMProvider(prompt, apiKey, model)
  }

  return validateAndBuild(response)
}
