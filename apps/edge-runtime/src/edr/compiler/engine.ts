/**
 * EdgeGDE EDR — Pure Compiler (HTML Generator)
 *
 * ⚠️ BOUNDARY GUARD: DO NOT depend on legacy compiler.
 * This is the EDR pipeline. It must remain fully isolated from
 * the legacy system (src/compiler/engine.ts) which is kept only for
 * backward compatibility with the deploy/publish flow.
 *
 * EDR Architecture Spec v4.7.0:
 *   - Deterministic HTML generation from EDRNode tree
 *   - Collision-guarded normalization with token property wrapping
 *   - Semantic tag preservation (h1, input, select, button, etc.)
 *   - Void element support (input, br, hr, img, etc.)
 *   - Strict child rendering guard
 *   - Absolute attribute order: class then style
 *
 * @packageDocumentation
 */

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/** A node in the EDR rendering tree */
export interface EDRNode {
  /** HTML tag name (default: "div") */
  type?: string
  /** Properties including canonical role field and data-driven field definitions */
  props?: {
    /** Design role(s) — maps to edr.components */
    role?: string | string[]
    /** Data-driven field definitions for form_group synthesis */
    fields?: Array<{
      id: string
      label: string
      type?: string
    }>
    [key: string]: any
  }
  /** Geometry style properties (dimensions, position) */
  geometry?: Record<string, number | string>
  /** Legacy full style properties */
  legacyStyles?: Record<string, number | string>
  /** Child nodes or text content */
  children?: EDRNode[] | string | number | null
}

/** EDR (EdgeGDE Design Renderer) definition */
export interface EDR {
  /** Named component definitions */
  components: Record<string, Record<string, any>>
  /** Global CSS custom property tokens (→ :root) */
  global?: Record<string, string>
}

// ═══════════════════════════════════════════════════════════════════════════
// Style Builders
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract geometry-only styles from an EDR node.
 * Returns object of CSS property name → value pairs.
 */
function buildGeometryStyles(node: EDRNode): Record<string, string> {
  const result: Record<string, string> = {}
  if (!node.geometry) return result

  for (const [key, value] of Object.entries(node.geometry)) {
    if (value == null) continue
    result[key] = String(value).trim()
  }
  return result
}

/**
 * Extract full legacy styles from an EDR node.
 *
 * INVARIANT (LOCKED): legacy styles override geometry styles deterministically.
 * Geometry is written first, then legacyStyles overwrite matching keys.
 */
function buildLegacyFullStyles(node: EDRNode): Record<string, string> {
  const result: Record<string, string> = {}

  if (node.geometry) {
    for (const [key, value] of Object.entries(node.geometry)) {
      if (value == null) continue
      result[key] = String(value).trim()
    }
  }

  if (node.legacyStyles) {
    for (const [key, value] of Object.entries(node.legacyStyles)) {
      if (value == null) continue
      result[key] = String(value).trim()
    }
  }

  return result
}

// ═══════════════════════════════════════════════════════════════════════════
// Token Properties & Normalization
// ═══════════════════════════════════════════════════════════════════════════

/** Token properties that should be wrapped in CSS custom properties for themeability */
const TOKEN_PROPS = new Set([
  'color',
  'background-color',
  'border-color',
  'border-radius',
  'backdrop-filter',
  'font-family',
  'font-size',
  'box-shadow',
])

/**
 * Normalize style property names to kebab-case with collision detection.
 * Token properties are wrapped in CSS custom properties (var(--prop, value))
 * for runtime themeability. Throws on duplicate keys after normalization.
 */
function normalizeAndGuard(styles: Record<string, string>): Record<string, string> {
  return Object.keys(styles).reduce<Record<string, string>>((acc, k) => {
    const nk = k.replace(/_/g, '-')
    if (acc[nk] !== undefined) {
      throw new Error(`Collision: property "${nk}" defined twice after kebab-case normalization`)
    }
    const val = String(styles[k]).trim()
    acc[nk] = TOKEN_PROPS.has(nk) ? `var(--${nk}, ${val})` : val
    return acc
  }, {})
}

// ═══════════════════════════════════════════════════════════════════════════
// EDR Compiler
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compile a single EDR node into deterministic HTML with inline styles.
 *
 * - Exhaustive mode check (fail-fast on invalid mode)
 * - Canonical role location enforcement (role must be inside props)
 * - Sorted, unique, filtered roles from props.role
 * - Semantic tag preservation with void element support
 * - Collision-guarded kebab-case normalization
 * - Token properties wrapped in CSS custom properties
 * - Additional props rendered as HTML attributes (id, type, name, etc.)
 * - Strict child rendering guard
 * - Absolute attribute order: class then style
 *
 * @param node - The EDR node to compile
 * @param edr - The full EDR definition (for component lookup)
 * @param EDR_HASH - Canonical EDR hash identifier
 * @param mode - 'edr' for geometry-only styles, 'legacy' for full styles
 * @returns Deterministic HTML string
 * @throws {Error} On invalid mode, collision, or missing component
 */
export function compile(
  node: EDRNode,
  edr: EDR,
  EDR_HASH: string,
  mode: 'edr' | 'legacy',
): string {
  // 1. Exhaustive Mode Check (fail-fast)
  if (mode !== 'edr' && mode !== 'legacy') {
    throw new Error(`Mode violation: "${mode}" — must be "edr" or "legacy"`)
  }

  // 2. Role validation (canonical location enforcement)
  if ((node as { role?: unknown }).role !== undefined) {
    throw new Error(
      `Invalid node shape: role must be inside props` +
      ` (found top-level role on ${node.type || 'unknown'} node)`,
    )
  }

  // 3. Role resolution from props.role (canonical source)
  const rawRoles = Array.isArray(node.props?.role)
    ? node.props.role
    : node.props?.role
      ? [node.props.role]
      : []

  const uniqueRoles = Array.from(new Set(rawRoles))
    .filter(r => typeof r === 'string' && edr.components?.[r] != null)
    .sort()

  const className = uniqueRoles
    .map(r => `edr-${EDR_HASH}-${r}`)
    .join(' ')

  // 4. Tag preservation with self-closing support for void elements
  const Tag = typeof node.type === 'string' ? node.type : 'div'
  const isVoid = Tag === 'input' || Tag === 'br' || Tag === 'hr' || Tag === 'img' || Tag === 'meta' || Tag === 'link'

  // 5. Additional HTML attributes from props (id, type, name, placeholder, etc.)
  const restAttrs: string[] = []
  if (node.props) {
    for (const [key, value] of Object.entries(node.props)) {
      if (key === 'role' || key === 'fields') continue
      if (value == null) continue
      if (typeof value === 'string') {
        restAttrs.push(` ${key}="${value.replace(/"/g, '&quot;')}"`)
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        restAttrs.push(` ${key}="${String(value)}"`)
      }
    }
  }

  // 6. Branching Path
  const rawStyles = mode === 'edr'
    ? buildGeometryStyles(node)
    : buildLegacyFullStyles(node)

  // 7. Collision-Guarded Normalization (with token property wrapping)
  const normalizedStyles = normalizeAndGuard(rawStyles)

  // 8. Inline Style Serialization
  const inlineStyle = Object.keys(normalizedStyles)
    .sort()
    .filter(k => normalizedStyles[k] !== '' && normalizedStyles[k] !== undefined)
    .map(k => `${k}:${normalizedStyles[k]}`)
    .join(';')

  // 9. Strict Child Rendering Guard
  const renderChildren = (n: EDRNode): string => {
    if (n.children == null) return ''
    return Array.isArray(n.children)
      ? n.children.map(child => compile(child, edr, EDR_HASH, mode)).join('')
      : (typeof n.children === 'string' || typeof n.children === 'number')
        ? String(n.children)
        : ''
  }

  // 10. Attribute Guards (no empty attributes) + rest props + void element support
  const classAttr = className ? ` class="${className}"` : ''
  const styleAttr = inlineStyle ? ` style="${inlineStyle};"` : ''
  const extraAttrs = restAttrs.join('')

  if (isVoid) {
    return `<${Tag}${classAttr}${styleAttr}${extraAttrs}/>`
  }

  return `<${Tag}${classAttr}${styleAttr}${extraAttrs}>${renderChildren(node)}</${Tag}>`
}
