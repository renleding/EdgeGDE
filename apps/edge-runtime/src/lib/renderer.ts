/**
 * EdgeGDE — Phase 13: Hypermedia Renderer
 * Pure function — no I/O, no network, no side effects.
 *
 * Accepts a UIPrimitive config tree + context projection → HTML fragment.
 * Caller is responsible for loading context from D1 before invoking.
 *
 * @packageDocumentation
 */

// ═════════════════════════════════════════════════════════════════════════════
// Constants
// ═════════════════════════════════════════════════════════════════════════════

const MAX_RECURSION_DEPTH = 16
const TEXT_INTERPOLATION_RE = /\{\{([\w.]+)\}\}/g

// ═════════════════════════════════════════════════════════════════════════════
// Whitelisted Attributes (Extended — HTMX + MCP safe subset)
// ═════════════════════════════════════════════════════════════════════════════

const WHITELISTED_ATTRS = new Set([
  'class', 'name', 'value', 'placeholder', 'style', 'disabled', 'required', 'type', 'for', 'id',
  'hx-get', 'hx-post', 'hx-target', 'hx-swap', 'hx-swap-oob', 'hx-trigger', 'hx-include', 'hx-indicator',
])

// ═════════════════════════════════════════════════════════════════════════════
// Types
// ═════════════════════════════════════════════════════════════════════════════

interface UiComponent {
  type: string
  id?: string
  children?: UiComponent[]
  // Typed props accessed by the renderer (all optional — UI primitives are sparse configs)
  text?: string
  label?: string
  title?: string
  subtitle?: string
  direction?: string
  gap?: string | number
  level?: string
  variant?: string
  dot?: boolean
  action?: string
  method?: string
  submitLabel?: string
  name?: string
  placeholder?: string
  value?: string | number
  required?: boolean
  maxLength?: number
  min?: number
  max?: number
  step?: number
  prefix?: string
  suffix?: string
  options?: Array<{ value: string; label?: string }>
  checked?: boolean
  disabled?: boolean
  href?: string
  target?: string
  src?: string
  alt?: string
  objectFit?: string
  [key: string]: unknown
}

type ContextMap = Readonly<Record<string, string | number | boolean>>

// ═════════════════════════════════════════════════════════════════════════════
// HTML Escaping
// ═════════════════════════════════════════════════════════════════════════════

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/javascript:/gi, '')
}

// ═════════════════════════════════════════════════════════════════════════════
// Context Interpolation
// ═════════════════════════════════════════════════════════════════════════════

function interpolate(text: string, ctx: ContextMap): string {
  return text.replace(TEXT_INTERPOLATION_RE, (_, key: string) => {
    // Reject nested/compound keys (dots)
    if (key.includes('.')) return ''
    const val = ctx[key]
    return val !== undefined ? escapeHtml(String(val)) : ''
  })
}

// ═════════════════════════════════════════════════════════════════════════════
// Attribute Rendering
// ═════════════════════════════════════════════════════════════════════════════

function renderAttrs(component: UiComponent, ctx: ContextMap): string {
  const parts: string[] = []

  for (const [key, raw] of Object.entries(component)) {
    if (key === 'type' || key === 'children' || key === 'text' || key === 'label' || key === 'title' || key === 'subtitle') continue

    if (WHITELISTED_ATTRS.has(key)) {
      const val = typeof raw === 'string' ? interpolate(raw, ctx) : String(raw ?? '')
      parts.push(`${key}="${escapeAttr(val)}"`)
      continue
    }

    // MCP → data-mcp-*
    if (key === 'mcp-param' || key === 'mcp-action') {
      const dataKey = `data-${key}`
      const val = String(raw ?? '')
      parts.push(`${dataKey}="${escapeAttr(val)}"`)
    }
  }

  return parts.length > 0 ? ' ' + parts.join(' ') : ''
}

// ═════════════════════════════════════════════════════════════════════════════
// Core Renderer — maps component type → HTML tag + content
// ═════════════════════════════════════════════════════════════════════════════

function renderPrimitive(component: UiComponent, ctx: ContextMap, depth: number): string {
  if (depth > MAX_RECURSION_DEPTH) return '<!-- max depth -->'

  const type = component.type
  const id = component.id || ''
  const idAttr = id ? ` id="${escapeAttr(id)}"` : ''
  const attrs = renderAttrs(component, ctx)

  switch (type) {
    // ── Layout ───────────────────────────────────────────────────────────
    case 'container': {
      const dir = component.direction || 'column'
      const style = `display:flex;flex-direction:${dir}${component.gap ? `;gap:${escapeAttr(String(component.gap))}` : ''}`
      const children = renderChildren(component.children, ctx, depth + 1)
      return `<div${idAttr} style="${style}"${attrs}>${children}</div>`
    }

    case 'card': {
      const c = component
      const title = c.title ? `<div style="font-weight:600;margin-bottom:8px">${interpolate(c.title, ctx)}</div>` : ''
      const sub = c.subtitle ? `<div style="font-size:12px;color:#8b949e;margin-bottom:8px">${interpolate(c.subtitle, ctx)}</div>` : ''
      const children = renderChildren(c.children, ctx, depth + 1)
      return `<div${idAttr} class="card"${attrs} style="border:1px solid #2d3140;border-radius:12px;padding:16px;background:rgba(255,255,255,0.03)">${title}${sub}${children}</div>`
    }

    case 'section': {
      const c = component
      const title = c.title ? `<h3 style="font-size:14px;font-weight:600;margin-bottom:8px">${interpolate(c.title, ctx)}</h3>` : ''
      const children = renderChildren(c.children, ctx, depth + 1)
      return `<section${idAttr}${attrs}>${title}${children}</section>`
    }

    // ── Typography ───────────────────────────────────────────────────────
    case 'heading': {
      const c = component
      const level = c.level || 'h2'
      const text = escapeHtml(interpolate(c.text ?? '', ctx))
      return `<${level}${idAttr}${attrs}>${text}</${level}>`
    }

    case 'text': {
      const text = escapeHtml(interpolate(component.text || '', ctx))
      return `<span${idAttr}${attrs}>${text}</span>`
    }

    case 'badge': {
      const c = component
      const variant = c.variant || 'neutral'
      const colors: Record<string, string> = { info: '#58a6ff', success: '#3fb950', warning: '#d29922', danger: '#f85149', neutral: '#8b949e' }
      const color = colors[variant] || colors.neutral
      const text = escapeHtml(interpolate(c.text ?? '', ctx))
      const dot = c.dot ? `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${color};margin-right:4px"></span>` : ''
      return `<span${idAttr}${attrs} style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;background:${color}20;color:${color}">${dot}${text}</span>`
    }

    // ── Interactive: Form ────────────────────────────────────────────────
    case 'form': {
      const c = component
      const action = c.action || '/api/v1/chat/action'
      const method = c.method || 'POST'
      const submitLabel = c.submitLabel || 'Submit'
      const children = renderChildren(c.children, ctx, depth + 1)
      return `<form${idAttr} hx-post="${action}" hx-swap="outerHTML" method="${method}"${attrs}>${children}<button type="submit" style="margin-top:12px;padding:8px 16px;border-radius:8px;border:1px solid #2d3140;background:#238636;color:#fff;cursor:pointer">${escapeHtml(submitLabel)}</button></form>`
    }

    // ── Interactive: Input ───────────────────────────────────────────────
    case 'text_input': {
      const c = component
      const label = c.label ? `<label for="${escapeAttr(c.name || '')}" style="display:block;font-size:12px;margin-bottom:4px;color:#e1e4e8">${interpolate(c.label, ctx)}</label>` : ''
      const ph = c.placeholder ? ` placeholder="${escapeAttr(interpolate(c.placeholder, ctx))}"` : ''
      const val = c.value !== undefined ? ` value="${escapeAttr(String(c.value))}"` : ''
      const required = c.required ? ' required' : ''
      return `<div id="wrapper-${id || ''}"${attrs}>${label}<input${idAttr} type="text" name="${escapeAttr(c.name || '')}"${ph}${val}${required} hx-target="#wrapper-${id || ''}" hx-trigger="blur changed delay:400ms" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid #2d3140;background:#0f1117;color:#e1e4e8;font-size:14px">${c.maxLength ? `<span style="font-size:10px;color:#8b949e;margin-top:2px;display:block">Max ${c.maxLength} characters</span>` : ''}</div>`
    }

    case 'number_input': {
      const c = component
      const label = c.label ? `<label for="${escapeAttr(c.name || '')}" style="display:block;font-size:12px;margin-bottom:4px;color:#e1e4e8">${interpolate(c.label, ctx)}</label>` : ''
      const ph = c.placeholder ? ` placeholder="${escapeAttr(interpolate(c.placeholder, ctx))}"` : ''
      const val = c.value !== undefined ? ` value="${c.value}"` : ''
      const min = c.min !== undefined ? ` min="${c.min}"` : ''
      const max = c.max !== undefined ? ` max="${c.max}"` : ''
      const step = c.step !== undefined ? ` step="${c.step}"` : ''
      const prefix = c.prefix ? `<span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#8b949e;font-size:14px">${escapeHtml(c.prefix)}</span>` : ''
      return `<div id="wrapper-${id || ''}"${attrs} style="position:relative">${label}${prefix}<input${idAttr} type="number" name="${escapeAttr(c.name || '')}"${ph}${val}${min}${max}${step} hx-target="#wrapper-${id || ''}" hx-trigger="blur changed delay:400ms" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid #2d3140;background:#0f1117;color:#e1e4e8;font-size:14px;${prefix ? 'padding-left:32px' : ''}">${c.suffix ? `<span style="position:absolute;right:12px;top:50%;transform:translateY(-50%);color:#8b949e;font-size:14px">${escapeHtml(c.suffix)}</span>` : ''}</div>`
    }

    case 'select': {
      const c = component
      const label = c.label ? `<label for="${escapeAttr(c.name || '')}" style="display:block;font-size:12px;margin-bottom:4px;color:#e1e4e8">${interpolate(c.label, ctx)}</label>` : ''
      const options = (c.options || []).map((opt: { value: string; label?: string }) =>
        `<option value="${escapeAttr(opt.value)}"${opt.value === c.value ? ' selected' : ''}>${escapeHtml(opt.label || opt.value)}</option>`
      ).join('')
      return `<div id="wrapper-${id || ''}"${attrs}>${label}<select${idAttr} name="${escapeAttr(c.name || '')}" hx-target="#wrapper-${id || ''}" hx-trigger="change" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid #2d3140;background:#0f1117;color:#e1e4e8;font-size:14px">${options}</select></div>`
    }

    case 'checkbox': {
      const c = component
      const checked = c.checked ? ' checked' : ''
      return `<label${idAttr}${attrs} style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" name="${escapeAttr(c.name || '')}"${checked} hx-target="next siblings" hx-trigger="change">${interpolate(c.label || '', ctx)}</label>`
    }

    // ── Interactive: Button ──────────────────────────────────────────────
    case 'button': {
      const c = component
      const variant = c.variant || 'primary'
      const colors: Record<string, string> = { primary: '#238636', secondary: '#2d3140', danger: '#da3633', ghost: 'transparent', link: 'transparent' }
      const bg = colors[variant] || colors.primary
      const txt = variant === 'link' ? 'none' : variant === 'ghost' ? '1px solid #2d3140' : 'none'
      const label = interpolate(c.label || 'Button', ctx)
      const disabled = c.disabled ? ' disabled' : ''
      return `<button${idAttr}${disabled}${attrs} style="padding:8px 16px;border-radius:8px;border:${txt || '1px solid #2d3140'};background:${bg};color:#fff;cursor:pointer;font-size:13px">${label}</button>`
    }

    case 'link': {
      const c = component
      const label = interpolate(c.label || '', ctx)
      const href = c.href ? escapeAttr(interpolate(c.href, ctx)) : '#'
      const target = c.target ? ` target="${escapeAttr(c.target)}"` : ''
      return `<a${idAttr} href="${href}"${target}${attrs} style="color:#58a6ff;text-decoration:none">${label}</a>`
    }

    // ── Display ──────────────────────────────────────────────────────────
    case 'image': {
      const c = component
      const src = escapeAttr(interpolate(c.src || '', ctx))
      const alt = c.alt ? ` alt="${escapeAttr(interpolate(c.alt, ctx))}"` : ''
      const fit = c.objectFit || 'cover'
      return `<img${idAttr} src="${src}"${alt} style="width:100%;object-fit:${fit};border-radius:8px"${attrs}>`
    }

    // ── Unknown ──────────────────────────────────────────────────────────
    default:
      return `<!-- unknown component type: ${escapeHtml(type)} -->`
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Children Renderer
// ═════════════════════════════════════════════════════════════════════════════

function renderChildren(children: UiComponent[] | undefined, ctx: ContextMap, depth: number): string {
  if (!children || !Array.isArray(children)) return ''
  return children.map(c => renderPrimitive(c, ctx, depth)).join('\n')
}

// ═════════════════════════════════════════════════════════════════════════════
// Public API
// ═════════════════════════════════════════════════════════════════════════════

export type { UiComponent, ContextMap }

/**
 * Render a UIPrimitive config tree to an HTML fragment.
 * Pure function — no I/O, no side effects, no network calls.
 *
 * @param root  The UIPrimitive component tree root node
 * @param ctx   Flat key-value context projection for {{key}} interpolation
 * @param oobIds Optional set of element IDs that should be rendered as OOB swaps
 */
export function renderUiConfigToHtml(root: UiComponent, ctx: ContextMap = {}, oobIds?: Set<string>): string {
  const fragment = renderPrimitive(root, ctx, 0)

  if (oobIds && oobIds.size > 0) {
    // OOB rendering is handled by the caller by injecting hx-swap-oob attributes
    return fragment
  }

  return fragment
}

/**
 * Render with OOB (Out-of-Band) swap markers for specific element IDs.
 * Each matching element gets hx-swap-oob="true" injected into its attributes.
 */
export function renderUiConfigToHtmlWithOob(root: UiComponent, ctx: ContextMap, oobIds: Set<string>): string {
  // Mark OOB elements by temporarily injecting the attribute
  function markOob(node: UiComponent): void {
    if (node.id && oobIds.has(node.id)) {
      node['hx-swap-oob'] = 'true'
    }
    if (node.children) {
      node.children.forEach(markOob)
    }
  }

  // Deep clone to avoid mutating the input
  const clone = JSON.parse(JSON.stringify(root))
  markOob(clone)

  return renderPrimitive(clone, ctx, 0)
}
