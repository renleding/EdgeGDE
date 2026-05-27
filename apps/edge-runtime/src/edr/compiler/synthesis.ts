/**
 * EdgeGDE EDR — Synthesis Engine (Data-Driven)
 * EDR Architecture Spec v4.7.0:
 *   - Pure, deterministic, non-mutating
 *   - Data-driven form_group projection
 *   - Root → page → app_shell expansion
 *   - Primary section + secondary subsection elevation
 *   - Enforces canonical role location (props.role)
 *
 * @packageDocumentation
 */

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface EDRNode {
  type?: string
  props?: {
    role?: string | string[]
    fields?: Array<{ id: string; label: string; type?: string }>
    [key: string]: any
  }
  geometry?: Record<string, number | string>
  legacyStyles?: Record<string, number | string>
  children?: EDRNode[] | string | number | null
}

// ═══════════════════════════════════════════════════════════════════════════
// Synthesis
// ═══════════════════════════════════════════════════════════════════════════

function synthesize(node: EDRNode): EDRNode {
  const role = node.props?.role

  // ── Root → Page Shell Wrapper ──────────────────────────────────────────
  if (role === 'root') {
    return {
      type: 'div',
      props: { role: ['page'] },
      children: [
        { type: 'div', props: { role: ['app_shell'] }, children: node.children },
      ],
    }
  }

  // ── Data-Driven Form Group ──────────────────────────────────────────────
  if (role === 'form_group' && node.props?.fields && Array.isArray(node.props.fields)) {
    return {
      type: 'div',
      props: { role: ['grid_container'] },
      children: node.props.fields.map((f) => {
        if (f.type === 'select') {
          const options = (f as any).options || []
          const optionNodes = [
            { type: 'option', props: { value: '', disabled: true, selected: true }, children: 'Select...' },
            ...options.map((o: { value: string; label?: string }) => ({
              type: 'option' as const,
              props: { value: o.value },
              children: o.label || o.value,
            })),
          ]
          return {
            type: 'div', props: { role: ['field_wrapper'] },
            children: [
              { type: 'label', props: { role: 'label' }, children: f.label },
              { type: 'select', props: { role: 'input_field', id: f.id, name: f.id }, children: optionNodes },
            ],
          }
        }
        return {
          type: 'div', props: { role: ['field_wrapper'] },
          children: [
            { type: 'label', props: { role: 'label' }, children: f.label },
            { type: 'input', props: { role: 'input_field', id: f.id, name: f.id, type: f.type || 'text', placeholder: (f as any).placeholder || '' } },
          ],
        }
      }),
    }
  }

  // ── Structure-Only Expansions ──────────────────────────────────────────
  if (role === 'hero_section') {
    return { type: 'div', props: { role: ['hero_container'] }, children: node.children }
  }
  if (role === 'section') {
    return { type: 'div', props: { role: ['section_card'] }, children: node.children }
  }
  if (role === 'subsection') {
    return { type: 'div', props: { role: ['subsection_card'] }, children: node.children }
  }

  // ── Default: pass through ──────────────────────────────────────────────
  return node
}

/**
 * Recursive deep transform on a node tree.
 * Each node is passed through synthesize() for role-to-component mapping.
 * Enforces canonical role location.
 */
export function transform(node: EDRNode): EDRNode {
  const next = synthesize(node)

  if ((next as any).role !== undefined) {
    throw new Error(
      'Role must exist only in props.role' +
      ` (found top-level role on ${next.type || 'unknown'} node)`,
    )
  }

  if (next.children == null) return next
  if (!Array.isArray(next.children)) return next

  return {
    ...next,
    children: (next.children as EDRNode[]).map(transform) as EDRNode[],
  }
}
