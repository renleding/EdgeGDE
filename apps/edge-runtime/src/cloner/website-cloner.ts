/**
 * EdgeGDE Canvas — Website Cloner
 * Canvas Platform v1.0.0
 * Phase 4: Parse real websites into CanvasDocument.
 *
 * Lightweight recursive descent HTML parser (no external deps).
 *
 * @packageDocumentation
 */

import type { CanvasDocument, Node, NodeType } from '../canvas/canvas-types'

const VOID_ELEMENTS = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'])
const SKIP_TAGS = new Set(['script','style','noscript','iframe','svg','path'])
const BLOCK_TAGS = new Set(['main','section','header','footer','nav','article','aside','div','form','ul','ol','li','p','h1','h2','h3','h4','h5','h6','figure','figcaption','details','summary'])
const INLINE_TAGS = new Set(['span','a','strong','em','b','i','u','code','small','label','legend'])

interface ParsedElement {
  tag: string
  attrs: Record<string, string>
  children: (ParsedElement | string)[]
}

let nodeCounter = 0
function nextId(): string { return 'clone-' + (++nodeCounter) }
function resetCounter(): void { nodeCounter = 0 }

function parseHTML(html: string): ParsedElement[] {
  const result: ParsedElement[] = []
  let i = 0

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
        i++
        const q = html[i]
        if (q === '"' || q === "'") {
          i++
          let val = ''
          while (i < html.length && html[i] !== q) { val += html[i]; i++ }
          if (i < html.length) i++ // skip closing quote
          attrs[name.toLowerCase()] = val
        } else {
          let val = ''
          while (i < html.length && html[i] !== ' ' && html[i] !== '>' && html[i] !== '/') { val += html[i]; i++ }
          attrs[name.toLowerCase()] = val
        }
      } else {
        attrs[name.toLowerCase()] = ''
      }
    }
    return attrs
  }

  function skipToCloseTag(tag: string): void {
    const search = '</' + tag
    while (i < html.length) {
      if (html[i] === '<' && html.substring(i, i + search.length).toLowerCase() === search) {
        while (i < html.length && html[i] !== '>') i++
        if (i < html.length) i++
        return
      }
      i++
    }
  }

  function parseChildren(parentTag: string): (ParsedElement | string)[] {
    const children: (ParsedElement | string)[] = []
    let textBuf = ''

    function flushText() {
      if (textBuf.trim()) {
        children.push(textBuf.trim())
      }
      textBuf = ''
    }

    while (i < html.length) {
      if (html[i] === '<' && html[i + 1] === '/') {
        flushText()
        // skip to end of closing tag
        while (i < html.length && html[i] !== '>') i++
        if (i < html.length) i++
        return children
      }
      if (html[i] === '<' && html.substring(i, i + 4) === '<!--') {
        flushText()
        while (i < html.length) {
          if (html.substring(i, i + 3) === '-->') { i += 3; break }
          i++
        }
        continue
      }
      if (html[i] === '<') {
        flushText()
        i++
        const tagName = parseTag()
        if (!tagName) { i++; continue }
        const attrs = parseAttrs()
        // skip '>' (and optional '/')
        if (html[i] === '/') i++
        if (html[i] === '>') i++
        if (VOID_ELEMENTS.has(tagName)) {
          children.push({ tag: tagName, attrs, children: [] })
        } else if (SKIP_TAGS.has(tagName)) {
          skipToCloseTag(tagName)
        } else {
          const el: ParsedElement = { tag: tagName, attrs, children: [] }
          el.children = parseChildren(tagName)
          children.push(el)
        }
      } else {
        textBuf += html[i]
        i++
      }
    }
    flushText()
    return children
  }

  // Root-level parse
  while (i < html.length) {
    if (html[i] === '<' && html.substring(i, i + 4) === '<!--') {
      while (i < html.length) {
        if (html.substring(i, i + 3) === '-->') { i += 3; break }
        i++
      }
      continue
    }
    if (html[i] === '<' && html[i + 1] === '/') {
      while (i < html.length && html[i] !== '>') i++
      if (i < html.length) i++
      continue
    }
    if (html[i] === '<') {
      i++
      const tagName = parseTag()
      if (!tagName) { i++; continue }
      const attrs = parseAttrs()
      if (html[i] === '/') i++
      if (html[i] === '>') i++
      if (VOID_ELEMENTS.has(tagName)) {
        result.push({ tag: tagName, attrs, children: [] })
      } else if (SKIP_TAGS.has(tagName)) {
        skipToCloseTag(tagName)
      } else {
        const el: ParsedElement = { tag: tagName, attrs, children: [] }
        el.children = parseChildren(tagName)
        result.push(el)
      }
    } else {
      i++
    }
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

function extractText(el: ParsedElement): string {
  let result = ''
  for (const child of el.children) {
    if (typeof child === 'string') result += child + ' '
    else if (child.tag === 'br') result += '\n'
    else result += extractText(child) + ' '
  }
  return result.trim()
}

function convertElement(el: ParsedElement, parentId: string | null, nodes: Record<string, Node>): string {
  const tag = el.tag.toLowerCase()
  const id = el.attrs?.id || nextId()
  const inlineStyles = parseInlineStyle(el.attrs?.style || '')

  let nodeType: NodeType = 'Frame'
  let props: Record<string, any> = {}
  let textContent = ''

  if (tag === 'img') {
    nodeType = 'Frame'
    props.src = el.attrs?.src || ''
    props.alt = el.attrs?.alt || ''
  } else if (['h1','h2','h3','h4','h5','h6'].includes(tag)) {
    nodeType = 'Text'
    props.level = parseInt(tag[1])
    textContent = extractText(el)
    props.text = textContent || el.attrs?.title || ''
  } else if (tag === 'p' || tag === 'li') {
    nodeType = 'Text'
    textContent = extractText(el)
    props.text = textContent || el.attrs?.title || ''
  } else if (INLINE_TAGS.has(tag)) {
    nodeType = 'Text'
    textContent = extractText(el)
    props.text = textContent
    if (tag === 'a') props.href = el.attrs?.href || ''
  } else if (tag === 'input') {
    nodeType = 'Input'
    props.name = el.attrs?.name || el.attrs?.id || ''
    props.type = el.attrs?.type || 'text'
    props.placeholder = el.attrs?.placeholder || ''
  } else if (tag === 'button') {
    nodeType = 'Button'
    props.text = el.attrs?.value || extractText(el) || el.attrs?.title || 'Button'
  } else if (tag === 'header') {
    nodeType = 'Section'
    props.role = 'header'
  } else if (tag === 'footer') {
    nodeType = 'Section'
    props.role = 'footer'
  } else if (tag === 'section') {
    nodeType = 'Section'
  } else if (tag === 'nav') {
    nodeType = 'Section'
    props.role = 'nav'
  } else if (tag === 'form') {
    nodeType = 'Frame'
    props.role = 'form'
  } else if (BLOCK_TAGS.has(tag)) {
    nodeType = 'Frame'
  }

  if (el.attrs?.['mcp-tool']) props.mcpTool = el.attrs['mcp-tool']

  const node: Node = { id, type: nodeType, parentId, children: [], props, style: inlineStyles }
  nodes[id] = node

  for (const child of el.children) {
    if (typeof child === 'string') {
      // Bare text is already captured by extractText — no extra append needed
    } else {
      const childId = convertElement(child, id, nodes)
      node.children.push(childId)
    }
  }
  return id
}

export function cloneWebsite(url: string, html: string): CanvasDocument {
  resetCounter()
  const id = `canvas-${Date.now()}`
  const nodes: Record<string, Node> = {}
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i)
  const pageTitle = titleMatch ? titleMatch[1].trim() : 'Cloned Website'

  const rootId = nextId()
  nodes[rootId] = { id: rootId, type: 'Page', parentId: null, children: [], props: {}, style: { display: 'flex', flexDirection: 'column', minHeight: '100vh' } }

  const parsed = parseHTML(html)

  // Find body element in parsed tree
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
      const childId = convertElement(child, rootId, nodes)
      nodes[rootId].children.push(childId)
    }
  }

  const doc: CanvasDocument = {
    id, version: 0,
    baseNodes: JSON.parse(JSON.stringify(nodes)), nodes, rootId,
    history: [], stagingPointer: -1, livePointer: -1,
    metadata: { name: pageTitle, source: 'website-clone', createdAt: Date.now() },
  }
  return doc
}
