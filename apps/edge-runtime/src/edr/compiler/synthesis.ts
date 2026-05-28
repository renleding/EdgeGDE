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
        {
          type: 'div',
          props: { role: ['app_shell'] },
          children: [
            {
              type: 'form',
              props: {
                'hx-post': '/api/fragment/calculate',
                'hx-target': '#results',
                'hx-swap': 'innerHTML',
                'hx-trigger': 'submit, keyup changed delay:400ms from:find input, find select',
                'hx-indicator': '#loading',
                style: 'display:contents',
              },
              children: [
                ...(Array.isArray(node.children) ? (node.children as EDRNode[]) : []),
                { type: 'div', props: { id: 'results' } },
                {
                  type: 'div',
                  props: { id: 'loading', class: 'htmx-indicator', style: 'display:none;text-align:center;padding:16px;color:rgba(255,255,255,0.5);font-size:14px' },
                  children: 'Calculating...',
                },
              ],
            },
          ],
        },
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

        // Range slider fields — slider + number input synced
        if (f.type === 'range') {
          const min = (f as any).min ?? '0'
          const max = (f as any).max ?? '100'
          const step = (f as any).step ?? '1'
          const def = (f as any).default ?? min
          return {
            type: 'div', props: { role: ['field_wrapper'] },
            children: [
              { type: 'label', props: { role: 'label' }, children: f.label },
              {
                type: 'div',
                props: { style: 'display:flex;align-items:center;gap:12px' },
                children: [
                  {
                    type: 'input',
                    props: {
                      role: 'input_field',
                      id: f.id, name: f.id,
                      type: 'range', min, max, step,
                      value: String(def),
                      style: 'flex:1;padding:0;height:auto;border:none',
                      oninput: `var s=this.nextElementSibling;if(s&&s.type==='number'){s.value=parseFloat(this.value).toFixed(1)}`,
                    },
                  },
                  {
                    type: 'input',
                    props: {
                      role: 'input_field',
                      name: f.id,
                      type: 'number', min, max, step,
                      value: String(def),
                      placeholder: def,
                      style: 'width:96px;text-align:center',
                      oninput: `var s=this.previousElementSibling;if(s&&s.type==='range'){s.value=this.value}`,
                    },
                  },
                ],
              },
            ],
          }
        }

        return {
          type: 'div', props: { role: ['field_wrapper'] },
          children: [
            { type: 'label', props: { role: 'label' }, children: f.label },
            { type: 'input', props: { role: 'input_field', id: f.id, name: f.id, type: f.type || 'text', placeholder: (f as any).placeholder || '', step: (f as any).step } },
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
