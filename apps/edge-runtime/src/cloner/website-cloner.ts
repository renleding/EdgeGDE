/**
 * EdgeGDE Canvas — Website Cloner v2
 * Phase 4 + Structural Inference Fix
 *
 * Core fix: modern sites are HTML + CSS + JS.
 * Our parser reads only HTML content (~20%).
 * These fixes add visibility filtering, text normalization,
 * component detection, and basic layout inference.
 *
 * @packageDocumentation
 */

import type { CanvasDocument, Node, NodeType } from '../canvas/canvas-types'

const VOID_ELEMENTS = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'])
const SKIP_TAGS = new Set(['script','style','noscript','iframe','svg','path'])
const BLOCK_TAGS = new Set(['main','section','header','footer','nav','article','aside','div','form','ul','ol','li','p','h1','h2','h3','h4','h5','h6','figure','figcaption','details','summary'])
const INLINE_TAGS = new Set(['span','a','strong','em','b','i','u','code','small','label','legend'])
const HEADER_NAV_TAGS = new Set(['nav','header'])
const LIST_TAGS = new Set(['ul','ol'])

interface ParsedElement {
  tag: string
  attrs: Record<string, string>
  children: (ParsedElement | string)[]
}

let nodeCounter = 0
let usedIds = new Set<string>()
function nextId(): string { return 'clone-' + (++nodeCounter) }
function resetCounter(): void { nodeCounter = 0; usedIds = new Set<string>() }
function uniqueId(raw?: string): string {
  const base = raw ? 'clone-' + raw.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() : nextId()
  const fallback = base || nextId()
  let id = fallback
  let suffix = 2
  while (usedIds.has(id)) id = `${fallback}-${suffix++}`
  usedIds.add(id)
  return id
}
export function normalizeCloneUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) throw new Error('Clone URL is required')
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`
  const parsed = new URL(candidate)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Clone URL must use http or https')
  const host = parsed.hostname.toLowerCase()
  if (['localhost', '127.0.0.1', '::1'].includes(host) || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(host)) {
    throw new Error('Clone URL must reference a public web host')
  }
  return parsed.href
}
function resolveUrl(value: string | undefined, baseUrl: string): string {
  if (!value) return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^(javascript|data|mailto|tel):/i.test(trimmed)) return trimmed
  try { return new URL(trimmed, baseUrl).href } catch { return trimmed }
}
function decodeEntities(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}
function extractTitle(html: string): string {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
  return decodeEntities((match?.[1] || 'Cloned Website').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()) || 'Cloned Website'
}
function extractDescription(html: string): string {
  const match = html.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i)
    || html.match(/<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i)
  return decodeEntities((match?.[1] || '').replace(/\s+/g, ' ').trim())
}

// ── HTML Parser ───────────────────────────────────────────────────────────

function parseHTML(html: string): ParsedElement[] {
  const result: ParsedElement[] = []; let i = 0

  function parseTag(): string {
    const start = i
    while (i < html.length && html[i] !== '>' && html[i] !== '/' && html[i] !== ' ' && html[i] !== '\t' && html[i] !== '\n') i++
    return html.slice(start, i).trim().toLowerCase()
  }

  function parseAttrs(): Record<string, string> {
    const attrs: Record<string, string> = {}
    while (i < html.length && html[i] !== '>') {
      while (i < html.length && (html[i] === ' ' || html[i] === '\t' || html[i] === '\n')) i++
      if (i >= html.length || html[i] === '>') break
      const nameStart = i
      while (i < html.length && html[i] !== '=' && html[i] !== ' ' && html[i] !== '>' && html[i] !== '/') i++
      const name = html.slice(nameStart, i)
      if (!name) { i++; break }
      if (html[i] === '=') {
        i++; const q = html[i]
        if (q === '"' || q === "'") {
          i++; let val = ''
          while (i < html.length && html[i] !== q) { val += html[i]; i++ }
          if (i < html.length) i++
          attrs[name.toLowerCase()] = val
        } else {
          let val = ''
          while (i < html.length && html[i] !== ' ' && html[i] !== '>' && html[i] !== '/') { val += html[i]; i++ }
          attrs[name.toLowerCase()] = val
        }
      } else { attrs[name.toLowerCase()] = '' }
    }
    return attrs
  }

  function skipToCloseTag(tag: string): void {
    const search = '</' + tag
    while (i < html.length) {
      if (html[i] === '<' && html.substring(i, i + search.length).toLowerCase() === search) {
        while (i < html.length && html[i] !== '>') i++
        if (i < html.length) i++; return
      }
      i++
    }
  }

  function parseChildren(parentTag: string): (ParsedElement | string)[] {
    const children: (ParsedElement | string)[] = []; let textBuf = ''
    function flushText() { if (textBuf.trim()) children.push(textBuf.trim()); textBuf = '' }

    while (i < html.length) {
      if (html[i] === '<' && html[i + 1] === '/') { flushText(); while (i < html.length && html[i] !== '>') i++; if (i < html.length) i++; return children }
      if (html[i] === '<' && html.substring(i, i + 4) === '<!--') { flushText(); while (i < html.length) { if (html.substring(i, i + 3) === '-->') { i += 3; break } i++ }; continue }
      if (html[i] === '<') {
        flushText(); i++
        const tagName = parseTag()
        if (!tagName) { i++; continue }
        const attrs = parseAttrs()
        if (html[i] === '/') i++
        if (html[i] === '>') i++
        if (VOID_ELEMENTS.has(tagName)) { children.push({ tag: tagName, attrs, children: [] }) }
        else if (SKIP_TAGS.has(tagName)) { skipToCloseTag(tagName) }
        else { const el: ParsedElement = { tag: tagName, attrs, children: [] }; el.children = parseChildren(tagName); children.push(el) }
      } else { textBuf += html[i]; i++ }
    }
    flushText()
    return children
  }

  while (i < html.length) {
    if (html[i] === '<' && html.substring(i, i + 4) === '<!--') { while (i < html.length) { if (html.substring(i, i + 3) === '-->') { i += 3; break } i++ }; continue }
    if (html[i] === '<' && html[i + 1] === '/') { while (i < html.length && html[i] !== '>') i++; if (i < html.length) i++; continue }
    if (html[i] === '<') {
      i++; const tagName = parseTag(); if (!tagName) { i++; continue }
      const attrs = parseAttrs()
      if (html[i] === '/') i++
      if (html[i] === '>') i++
      if (VOID_ELEMENTS.has(tagName)) { result.push({ tag: tagName, attrs, children: [] }) }
      else if (SKIP_TAGS.has(tagName)) { skipToCloseTag(tagName) }
      else { const el: ParsedElement = { tag: tagName, attrs, children: [] }; el.children = parseChildren(tagName); result.push(el) }
    } else { i++ }
  }
  return result
}

function parseInlineStyle(styleStr: string): Record<string, string> {
  const result: Record<string, string> = {}
  if (!styleStr) return result
  for (const pair of styleStr.split(';')) {
    const colon = pair.indexOf(':')
    if (colon === -1) continue
    const key = pair.slice(0, colon).trim()
    const val = pair.slice(colon + 1).trim()
    if (key && val) result[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = val
  }
  return result
}

// ── FIX 2: Text Normalization ────────────────────────────────────────────
// Prevents concatenated sibling text by ensuring spacing between text nodes.

function extractText(el: ParsedElement): string {
  const parts: string[] = []
  for (const child of el.children) {
    if (typeof child === 'string') parts.push(child)
    else if (child.tag === 'br') parts.push('\n')
    else { const t = extractText(child); if (t) parts.push(t) }
  }
  // Join with space to prevent concatenation like "ProductEnterprise"
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

// ── FIX 1: Visibility Filter ────────────────────────────────────────────
// Skip hidden/invisible elements at parsing time.

function isHidden(el: ParsedElement): boolean {
  const style = el.attrs?.style || ''
  if (style.includes('display:none') || style.includes('display: none')) return true
  if (style.includes('visibility:hidden') || style.includes('visibility: hidden')) return true
  if (style.includes('opacity:0') || style.includes('opacity: 0')) return true
  if (el.attrs?.['aria-hidden'] === 'true') return true
  if (el.attrs?.hidden !== undefined) return true
  return false
}

// ── FIX 3: Component Detection ───────────────────────────────────────────
// Improved button label detection using aria-label and title.

function extractButtonLabel(el: ParsedElement): string {
  if (el.attrs?.['aria-label']) return el.attrs['aria-label']
  if (el.attrs?.title) return el.attrs.title
  if (el.attrs?.value) return el.attrs.value
  const text = extractText(el)
  // Filter out pure SVG/icon content
  if (text && !text.startsWith('/svg>') && text.length > 0) return text
  return ''
}

// ── Element → CanvasNode ──────────────────────────────────────────────────

function convertElement(el: ParsedElement, parentId: string | null, nodes: Record<string, Node>, baseUrl: string): string {
  const tag = el.tag.toLowerCase()
  const id = uniqueId(el.attrs?.id)
  const inlineStyles = parseInlineStyle(el.attrs?.style || '')

  // FIX 1: Visibility filter — skip hidden nodes entirely (no children)
  if (isHidden(el)) {
    const placeholder: Node = { id, type: 'Frame', parentId, children: [], props: {}, style: { display: 'none' } }
    nodes[id] = placeholder
    return id
  }

  let nodeType: NodeType = 'Frame'
  let props: Record<string, any> = {}
  let textContent = ''

  if (tag === 'img') { nodeType = 'Frame'; props.src = resolveUrl(el.attrs?.src || el.attrs?.['data-src'], baseUrl); props.alt = el.attrs?.alt || '' }
  else if (['h1','h2','h3','h4','h5','h6'].includes(tag)) {
    nodeType = 'Text'; props.level = parseInt(tag[1])
    textContent = extractText(el); props.text = textContent || el.attrs?.title || ''
  } else if (tag === 'p' || tag === 'li') {
    nodeType = 'Text'; textContent = extractText(el); props.text = textContent || el.attrs?.title || ''
  } else if (INLINE_TAGS.has(tag)) {
    nodeType = 'Text'; textContent = extractText(el); props.text = textContent
    if (tag === 'a') props.href = resolveUrl(el.attrs?.href, baseUrl)
  } else if (tag === 'input') { nodeType = 'Input'; props.name = el.attrs?.name || el.attrs?.id || ''; props.type = el.attrs?.type || 'text'; props.placeholder = el.attrs?.placeholder || '' }
  else if (tag === 'button') {
    nodeType = 'Button'
    const label = extractButtonLabel(el)
    props.text = label || 'Button'
  } else if (tag === 'header') { nodeType = 'Section'; props.role = 'header' }
  else if (tag === 'footer') { nodeType = 'Section'; props.role = 'footer' }
  else if (tag === 'section') { nodeType = 'Section' }
  else if (tag === 'nav') { nodeType = 'Section'; props.role = 'nav' }
  else if (tag === 'form') { nodeType = 'Frame'; props.role = 'form' }
  else if (LIST_TAGS.has(tag)) { nodeType = 'Section'; props.role = 'list' }
  else if (tag === 'table' || tag === 'thead' || tag === 'tbody' || tag === 'tr' || tag === 'td' || tag === 'th') { nodeType = 'Frame'; props.role = 'table' }
  else if (BLOCK_TAGS.has(tag)) { nodeType = 'Frame' }

  // Role-based detection for non-semantic tags
  const roleAttr = el.attrs?.role || ''
  if (roleAttr === 'navigation' || roleAttr === 'nav') { nodeType = 'Section'; props.role = 'nav' }
  if (roleAttr === 'banner') { nodeType = 'Section'; props.role = 'header' }
  if (roleAttr === 'contentinfo') { nodeType = 'Section'; props.role = 'footer' }
  if (roleAttr === 'main') { nodeType = 'Section'; props.role = 'main' }
  if (roleAttr === 'search') { nodeType = 'Section'; props.role = 'search' }

  // Class-based detection for common patterns
  const cls = (el.attrs?.['class'] || '').toLowerCase()
  if (cls.includes('nav') || cls.includes('navbar') || cls.includes('navigation')) {
    if (nodeType === 'Frame') { nodeType = 'Section'; props.role = 'nav' }
  }
  if (cls.includes('header') || cls.includes('banner')) {
    if (nodeType === 'Frame') { nodeType = 'Section'; props.role = 'header' }
  }
  if (cls.includes('footer')) {
    if (nodeType === 'Frame') { nodeType = 'Section'; props.role = 'footer' }
  }

  if (el.attrs?.['mcp-tool']) props.mcpTool = el.attrs['mcp-tool']

  // Skip artifact text nodes (script/style/svg artifacts)
  if (textContent && (textContent.startsWith('/script>') || textContent.startsWith('/noscript>') || textContent.startsWith('/svg>') || textContent.startsWith('/style>'))) {
    const placeholder: Node = { id, type: 'Frame', parentId, children: [], props: {}, style: { display: 'none' } }
    nodes[id] = placeholder
    for (const child of el.children) {
      if (typeof child !== 'string') { const childId = convertElement(child, id, nodes, baseUrl); placeholder.children.push(childId) }
    }
    return id
  }

  const node: Node = { id, type: nodeType, parentId, children: [], props, style: inlineStyles }
  nodes[id] = node

  for (const child of el.children) {
    if (typeof child === 'string') {
      // Bare text is already captured by extractText — no extra append
    } else {
      const childId = convertElement(child, id, nodes, baseUrl)
      node.children.push(childId)
    }
  }
  return id
}

// ── FIX 5: Basic Layout Inference ────────────────────────────────────────
// After tree conversion, detect horizontal groups and apply flexDirection.

function inferLayout(nodes: Record<string, Node>, rootId: string): void {
  function walk(id: string, depth: number): void {
    const node = nodes[id]
    if (!node || depth > 20) return

    const children = node.children.map(cid => nodes[cid]).filter(Boolean)

    // Dedup sibling text nodes with identical content (mobile/desktop nav)
    const seen = new Set<string>()
    node.children = node.children.filter(cid => {
      const n = nodes[cid]
      if (n?.type === 'Text' && n.props?.text) {
        const key = n.props.text.toLowerCase().trim()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      }
      return true
    })

    const childrenToWalk = node.children.slice()

    // Rule: nav / header → horizontal layout + flatten children
    if (node.props?.role === 'nav' || node.props?.role === 'header') {
      node.style.display = 'flex'
      node.style.flexDirection = 'row'
      node.style.alignItems = 'center'
      node.style.flexWrap = 'wrap'
      if (!node.style.gap) node.style.gap = '8px'

      // Flatten: promote inline/text grandchildren to direct children
      const flatChildren: string[] = []
      for (const cid of node.children) {
        const child = nodes[cid]
        if (!child) continue
        // If child is a Frame/Section with only inline/Text children, promote them
        if ((child.type === 'Frame' || child.type === 'Section') && child.children.length > 0) {
          const grandChildren = child.children.map(gid => nodes[gid]).filter(Boolean)
          const allInline = grandChildren.every(gc => gc.type === 'Text' || gc.type === 'Button')
          if (allInline) {
            // Add gap between promoted items
            for (let i = 0; i < child.children.length; i++) {
              flatChildren.push(child.children[i])
            }
            continue
          }
        }
        flatChildren.push(cid)
      }
      if (flatChildren.length > 0) {
        node.children = flatChildren
      }
    }

    // Rule: only apply flex-row if this is a navigation/header/section, NOT arbitrary divs
    // Arbitrary divs stay vertical by default

    // Rule: list containers → column with gap
    if (node.props?.role === 'list') {
      node.style.display = 'flex'
      node.style.flexDirection = 'column'
      if (!node.style.gap) node.style.gap = '4px'
    }

    // Recurse
    for (const cid of childrenToWalk) walk(cid, depth + 1)
  }
  walk(rootId, 0)
}

function inferHeroLayout(nodes: Record<string, Node>, rootId: string): void {
  const root = nodes[rootId]
  if (!root) return

  function walk(id: string): boolean {
    const node = nodes[id]
    if (!node) return false
    if (node.type === 'Section' && sectionHasHeading(node, nodes) && sectionHasButton(node, nodes)) {
      node.props.role = 'hero'
      node.style.display = 'flex'
      node.style.flexDirection = 'row'
      node.style.alignItems = 'center'
      node.style.justifyContent = 'space-between'
      node.style.flexWrap = 'wrap'
      if (!node.style.gap) node.style.gap = '24px'
      if (!node.style.padding || node.style.padding === '0px') node.style.padding = '60px 0'
      return true
    }
    for (const childId of node.children) {
      if (walk(childId)) return true
    }
    return false
  }

  walk(rootId)
}

function sectionHasHeading(section: Node, nodes: Record<string, Node>): boolean {
  return visitDescendants(section, nodes).some(node => node.type === 'Text' && node.props?.level === 1)
}

function sectionHasButton(section: Node, nodes: Record<string, Node>): boolean {
  return visitDescendants(section, nodes).some(node => node.type === 'Button')
}

function visitDescendants(root: Node, nodes: Record<string, Node>): Node[] {
  const result: Node[] = []
  function walk(id: string): void {
    const node = nodes[id]
    if (!node) return
    result.push(node)
    for (const childId of node.children) walk(childId)
  }
  for (const childId of root.children) walk(childId)
  return result
}

// ── Public API ────────────────────────────────────────────────────────────

export function cloneWebsite(url: string, html: string): CanvasDocument {
  resetCounter()
  const normalizedUrl = normalizeCloneUrl(url)
  const id = `canvas-${Date.now()}`
  const nodes: Record<string, Node> = {}
  const pageTitle = extractTitle(html)
  const pageDescription = extractDescription(html)

  const rootId = nextId()
  nodes[rootId] = { id: rootId, type: 'Page', parentId: null, children: [], props: {}, style: { display: 'flex', flexDirection: 'column', minHeight: '100vh' } }

  const parsed = parseHTML(html)

  function findInTree(els: ParsedElement[]): ParsedElement | null {
    for (const el of els) {
      if (el.tag === 'body') return el
      const found = findInTree(el.children.filter((c): c is ParsedElement => typeof c !== 'string'))
      if (found) return found
    }
    return null
  }

  const bodyEl = findInTree(parsed)
  const contentChildren = bodyEl ? bodyEl.children : []

  for (const child of contentChildren) {
    if (typeof child !== 'string') {
      const childId = convertElement(child, rootId, nodes, normalizedUrl)
      nodes[rootId].children.push(childId)
    }
  }

  // FIX 5: Apply layout inference after building the tree
  inferLayout(nodes, rootId)
  inferHeroLayout(nodes, rootId)

  const doc: CanvasDocument = {
    id, version: 0,
    baseNodes: JSON.parse(JSON.stringify(nodes)), nodes, rootId,
    history: [], stagingPointer: -1, livePointer: -1,
    metadata: {
      name: pageTitle,
      source: 'website-clone',
      sourceUrl: normalizedUrl,
      description: pageDescription,
      createdAt: Date.now(),
    },
  }
  return doc
}
