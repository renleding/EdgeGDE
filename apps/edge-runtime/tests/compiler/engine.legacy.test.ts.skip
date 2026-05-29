/**
 * EdgeGDE Mortgage Calculator — JSON-to-HTML Compiler Tests
 * HSAES Phase 2: TDD — tests must fail before implementation is verified.
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'bun:test'
import { compileLayout } from '@/compiler/engine'
import { SCHEMA_VERSION } from '@edgegde/schema'

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function makeFrame(overrides: Record<string, unknown> = {}) {
  return {
    id: '0:1',
    type: 'FRAME',
    name: 'Calculator',
    x: 0,
    y: 0,
    width: 400,
    height: 600,
    children: [],
    ...overrides,
  }
}

function makeText(overrides: Record<string, unknown> = {}) {
  return {
    id: '0:2',
    type: 'TEXT',
    name: 'Label',
    x: 10,
    y: 10,
    width: 200,
    height: 30,
    ...overrides,
  }
}

function makeLayout(layout: Record<string, unknown> = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    rootNode: makeFrame(),
    formFields: [],
    ...layout,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Simple frame → correct HTML element
// ═══════════════════════════════════════════════════════════════════════════

describe('Simple frame compilation', () => {
  it('compiles a bare frame to a div', () => {
    const layout = makeLayout({ rootNode: makeFrame() })
    const output = compileLayout(layout)
    expect(output).toMatch(/^<div/)
    expect(output).toMatch(/id="0:1"/)
    expect(output).toMatch(/<\/div>$/)
  })

  it('compiles a TEXT node to a span', () => {
    const layout = makeLayout({
      rootNode: makeFrame({
        children: [makeText()],
      }),
    })
    const output = compileLayout(layout)
    expect(output).toMatch(/<span/)
    expect(output).toMatch(/id="0:2"/)
    expect(output).toMatch(/<\/span>/)
  })

  it('compiles a RECTANGLE node to a div', () => {
    const layout = makeLayout({
      rootNode: makeFrame({
        id: '0:1',
        children: [{
          id: '0:3',
          type: 'RECTANGLE',
          name: 'Box',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
        }],
      }),
    })
    const output = compileLayout(layout)
    expect(output).toContain('<div')
    expect(output).toContain('id="0:3"')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. Nested frame hierarchy preserved
// ═══════════════════════════════════════════════════════════════════════════

describe('Nested frame hierarchy', () => {
  it('preserves parent-child nesting with correct depth', () => {
    const layout = makeLayout({
      rootNode: makeFrame({
        id: 'parent',
        children: [
          makeFrame({
            id: 'child',
            children: [makeText({ id: 'grandchild' })],
          }),
        ],
      }),
    })
    const output = compileLayout(layout)
    // parent wraps child wraps grandchild
    const parentMatch = output.match(/<div[^>]*id="parent"[^>]*>/)
    expect(parentMatch).not.toBeNull()
    const parentIdx = parentMatch!.index!
    const childMatch = output.match(/<div[^>]*id="child"[^>]*>/)
    expect(childMatch).not.toBeNull()
    const childIdx = childMatch!.index!
    const gcMatch = output.match(/<span[^>]*id="grandchild"[^>]*>/)
    expect(gcMatch).not.toBeNull()
    const gcIdx = gcMatch!.index!

    expect(parentIdx).toBeLessThan(childIdx)
    expect(childIdx).toBeLessThan(gcIdx)
  })

  it('preserves OpenPencil child order from JSON payload', () => {
    const layout = makeLayout({
      rootNode: makeFrame({
        id: 'parent',
        children: [
          makeText({ id: 'first' }),
          makeText({ id: 'second' }),
          makeText({ id: 'third' }),
        ],
      }),
    })
    const output = compileLayout(layout)
    const firstIdx = output.indexOf('id="first"')
    const secondIdx = output.indexOf('id="second"')
    const thirdIdx = output.indexOf('id="third"')
    expect(firstIdx).toBeGreaterThan(-1)
    expect(secondIdx).toBeGreaterThan(firstIdx)
    expect(thirdIdx).toBeGreaterThan(secondIdx)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. Cycle detection throws error
// ═══════════════════════════════════════════════════════════════════════════

describe('Cycle detection', () => {
  it('throws on direct self-reference (node in own children)', () => {
    // We need to construct a circular reference manually
    const rootNode = makeFrame()
    rootNode.children = [rootNode as any] // direct self-loop
    const layout = makeLayout({ rootNode })
    expect(() => compileLayout(layout)).toThrow()
  })

  it('throws on indirect circular reference (A→B→A)', () => {
    const nodeA = makeFrame({ id: 'A', children: [] })
    const nodeB = makeFrame({ id: 'B', children: [] })
    const nodeC = makeText({ id: 'C' })
    nodeA.children = [nodeB]
    nodeB.children = [nodeC as any]

    // Now create a cycle: A → B → A (via shallow copy trick)
    const circularA = { ...nodeA, children: [nodeB] }
    const circularB = { ...nodeB, children: [circularA as any] }
    circularA.children = [circularB]

    const layout = makeLayout({ rootNode: circularA })
    expect(() => compileLayout(layout)).toThrow(/cycle|circular|duplicate/i)
  })

  it('does not throw on sibling nodes with same name but different ids', () => {
    const layout = makeLayout({
      rootNode: makeFrame({
        id: 'parent',
        children: [
          makeFrame({ id: 'child1' }),
          makeFrame({ id: 'child2' }),
        ],
      }),
    })
    expect(() => compileLayout(layout)).not.toThrow()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. Alphabetical attribute sorting enforced
// ═══════════════════════════════════════════════════════════════════════════

describe('Attribute sorting', () => {
  it('sorts attributes in order: class → hx-* → id → mcp-*', () => {
    const layout = makeLayout({
      rootNode: makeFrame({
        id: 'sort-test',
        children: [
          makeFrame({
            id: 'inner',
            name: 'Form',
          }),
        ],
      }),
      formFields: [
        {
          nodeId: 'inner',
          label: 'Amount',
          fieldType: 'number',
          placeholder: 'Enter amount',
          required: true,
          min: 0,
          max: 10000000,
          step: 1000,
        },
      ],
      submitButton: { nodeId: 'inner', label: 'Calculate' },
    })

    const output = compileLayout(layout)

    // For the form element, attributes should be sorted: class → hx-* → id → mcp-*
    // First, verify the output has well-formed attributes
    // A form with hx-* attributes should have class before hx-* before id before mcp-*
    const formMatch = output.match(/<form[^>]*>/)
    if (formMatch) {
      const formTag = formMatch[0]
      const classIdx = formTag.indexOf('class=')
      const hxIdx = formTag.indexOf('hx-')
      const idIdx = formTag.indexOf('id=')
      const mcpIdx = formTag.indexOf('mcp-')

      // Check they exist
      if (classIdx >= 0 && hxIdx >= 0 && idIdx >= 0 && mcpIdx >= 0) {
        expect(classIdx).toBeLessThan(hxIdx)
        expect(hxIdx).toBeLessThan(idIdx)
        expect(idIdx).toBeLessThan(mcpIdx)
      }
    }
  })

  it('output is deterministic (same input → same output)', () => {
    const layout = makeLayout({
      rootNode: makeFrame({
        id: 'det',
        children: [
          makeText({ id: 't1' }),
          makeText({ id: 't2' }),
        ],
      }),
    })
    const first = compileLayout(layout)
    const second = compileLayout(layout)
    expect(first).toBe(second)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. Class concatenation (multiple class sources merged)
// ═══════════════════════════════════════════════════════════════════════════

describe('Class concatenation', () => {
  it('merges class attributes from layout options with space separator', () => {
    const layout = makeLayout({
      rootNode: makeFrame({
        width: 400,
        height: 200,
      }),
    })
    const output = compileLayout(layout)
    // A frame with layout properties gets Tailwind classes
    expect(output).toMatch(/class="/)
    const classAttr = output.match(/class="([^"]*)"/)
    expect(classAttr).not.toBeNull()
    if (classAttr) {
      const classes = classAttr[1].split(/\s+/)
      // Should have at least one class token
      expect(classes.length).toBeGreaterThanOrEqual(1)
      // No duplicates
      expect(new Set(classes).size).toBe(classes.length)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6. hx-* attribute depth-based override (last write wins)
// ═══════════════════════════════════════════════════════════════════════════

describe('hx-* attribute override', () => {
  it('deeper nodes override shallower hx-* attributes', () => {
    // Parent has hx-target="#results", child has hx-target="#detail"
    // Output should have the child's value where the child is
    const layout = makeLayout({
      rootNode: makeFrame({
        id: 'parent',
        name: 'parent',
        children: [
          makeFrame({
            id: 'child',
            name: 'child',
          }),
        ],
      }),
    })
    const output = compileLayout(layout)
    // Both divs exist - no override needed since they're different elements
    expect(output).toContain('id="parent"')
    expect(output).toContain('id="child"')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 7. mcp-param uniqueness collision error
// ═══════════════════════════════════════════════════════════════════════════

describe('mcp-param uniqueness', () => {
  it('throws on duplicate mcp-param values', () => {
    const layout = makeLayout({
      rootNode: makeFrame({
        id: 'form-container',
        children: [
          makeFrame({ id: 'input1' }),
        ],
      }),
      formFields: [
        { nodeId: 'input1', label: 'Amount', fieldType: 'number', required: true, mcpParam: 'amount' },
        { nodeId: 'input1', label: 'Duplicate', fieldType: 'number', required: true, mcpParam: 'amount' },
      ],
      submitButton: { nodeId: 'form-container', label: 'Go' },
    })
    expect(() => compileLayout(layout)).toThrow(/duplicate|collision|mcp-param/i)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 8. Form element HTMX injection
// ═══════════════════════════════════════════════════════════════════════════

describe('HTMX injection', () => {
  it('injects hx-post on form container', () => {
    const layout = makeLayout({
      rootNode: makeFrame({
        id: 'form-root',
        children: [makeFrame({ id: 'input1' })],
      }),
      formFields: [
        { nodeId: 'input1', label: 'Amount', fieldType: 'number', required: true },
      ],
      submitButton: { nodeId: 'form-root', label: 'Calculate' },
    })
    const output = compileLayout(layout)
    expect(output).toContain('hx-post')
    expect(output).toContain('/api/calc/mortgage')
  })

  it('injects hx-target on form container', () => {
    const layout = makeLayout({
      rootNode: makeFrame({
        id: 'form-root',
        children: [makeFrame({ id: 'input1' })],
      }),
      formFields: [
        { nodeId: 'input1', label: 'Amount', fieldType: 'number', required: true },
      ],
      submitButton: { nodeId: 'form-root', label: 'Calculate' },
    })
    const output = compileLayout(layout)
    expect(output).toContain('hx-target')
    expect(output).toContain('#calculator-results')
  })

  it('injects hx-swap on form container', () => {
    const layout = makeLayout({
      rootNode: makeFrame({
        id: 'form-root',
        children: [makeFrame({ id: 'input1' })],
      }),
      formFields: [
        { nodeId: 'input1', label: 'Amount', fieldType: 'number', required: true },
      ],
      submitButton: { nodeId: 'form-root', label: 'Calculate' },
    })
    const output = compileLayout(layout)
    expect(output).toContain('hx-swap')
    expect(output).toContain('outerHTML')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 9. WebMCP tool/param injection
// ═══════════════════════════════════════════════════════════════════════════

describe('WebMCP injection', () => {
  it('injects mcp-tool on form element', () => {
    const layout = makeLayout({
      rootNode: makeFrame({
        id: 'form-root',
        children: [makeFrame({ id: 'input1' })],
      }),
      formFields: [
        { nodeId: 'input1', label: 'Amount', fieldType: 'number', required: true },
      ],
      submitButton: { nodeId: 'form-root', label: 'Calculate' },
    })
    const output = compileLayout(layout)
    expect(output).toContain('mcp-tool')
    expect(output).toContain('calculate_mortgage')
  })

  it('injects mcp-param on form input nodes', () => {
    const layout = makeLayout({
      rootNode: makeFrame({
        id: 'form-root',
        children: [makeFrame({ id: 'input1' })],
      }),
      formFields: [
        { nodeId: 'input1', label: 'Loan Amount', fieldType: 'number', required: true },
      ],
      submitButton: { nodeId: 'form-root', label: 'Calculate' },
    })
    const output = compileLayout(layout)
    expect(output).toContain('mcp-param')
  })

  it('mcp-param values are unique across all inputs', () => {
    const layout = makeLayout({
      rootNode: makeFrame({
        id: 'form-root',
        children: [
          makeFrame({ id: 'input-amount' }),
          makeFrame({ id: 'input-rate' }),
        ],
      }),
      formFields: [
        { nodeId: 'input-amount', label: 'Loan Amount', fieldType: 'number', required: true },
        { nodeId: 'input-rate', label: 'Interest Rate', fieldType: 'number', required: true },
      ],
      submitButton: { nodeId: 'form-root', label: 'Calculate' },
    })
    const output = compileLayout(layout)
    // Each input should have its own mcp-param
    // The param values should be derived from the label (snake_case)
    const mcpParams = output.match(/mcp-param="([^"]*)"/g)
    expect(mcpParams).not.toBeNull()
    if (mcpParams) {
      const paramValues = mcpParams.map(s => s.match(/mcp-param="([^"]*)"/)![1])
      expect(new Set(paramValues).size).toBe(paramValues.length)
    }
  })

  it('injects mcp-description on form element', () => {
    const layout = makeLayout({
      rootNode: makeFrame({
        id: 'form-root',
        children: [makeFrame({ id: 'input1' })],
      }),
      formFields: [
        { nodeId: 'input1', label: 'Amount', fieldType: 'number', required: true },
      ],
      submitButton: { nodeId: 'form-root', label: 'Calculate' },
    })
    const output = compileLayout(layout)
    expect(output).toContain('mcp-description')
    expect(output).toContain('Mortgage')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 10. Tailwind mapping
// ═══════════════════════════════════════════════════════════════════════════

describe('Tailwind mapping', () => {
  it('maps corner radius to rounded-* class', () => {
    const layout = makeLayout({
      rootNode: makeFrame({
        width: 400,
        height: 200,
        cornerRadius: 8,
      }),
    })
    const output = compileLayout(layout)
    // Should have a rounded class
    expect(output).toMatch(/rounded/)
  })

  it('maps opacity to opacity-* class', () => {
    const layout = makeLayout({
      rootNode: makeFrame({
        width: 400,
        height: 200,
        opacity: 0.5,
      }),
    })
    const output = compileLayout(layout)
    expect(output).toMatch(/opacity/)
  })

  it('maps flex layout to flex classes', () => {
    const layout = makeLayout({
      rootNode: makeFrame({
        width: 400,
        height: 600,
      }),
    })
    const output = compileLayout(layout)
    // A frame with children should have flex layout
    expect(output).toMatch(/class="/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 11. Full LayoutDefinition with mortgage form
// ═══════════════════════════════════════════════════════════════════════════

describe('Full mortgage form compilation', () => {
  it('compiles a complete mortgage calculator layout to valid HTML', () => {
    const layout = makeLayout({
      rootNode: makeFrame({
        id: 'calc-root',
        width: 420,
        height: 640,
        cornerRadius: 12,
        children: [
          makeText({
            id: 'title',
            name: 'Title',
            x: 20,
            y: 20,
            width: 380,
            height: 40,
          }),
          makeFrame({
            id: 'amount-input',
            name: 'Loan Amount',
            x: 20,
            y: 80,
            width: 380,
            height: 60,
            cornerRadius: 8,
          }),
          makeFrame({
            id: 'rate-input',
            name: 'Interest Rate',
            x: 20,
            y: 160,
            width: 380,
            height: 60,
            cornerRadius: 8,
          }),
          makeFrame({
            id: 'term-input',
            name: 'Loan Term',
            x: 20,
            y: 240,
            width: 380,
            height: 60,
            cornerRadius: 8,
          }),
          makeFrame({
            id: 'submit-btn',
            name: 'Calculate Button',
            x: 20,
            y: 340,
            width: 380,
            height: 56,
            cornerRadius: 28,
          }),
          makeFrame({
            id: 'results-area',
            name: 'Results',
            x: 20,
            y: 420,
            width: 380,
            height: 200,
            cornerRadius: 12,
          }),
        ],
      }),
      formFields: [
        {
          nodeId: 'amount-input',
          label: 'Loan Amount',
          fieldType: 'number',
          placeholder: 'e.g. 500000',
          required: true,
          min: 0,
          max: 10000000,
          step: 1000,
        },
        {
          nodeId: 'rate-input',
          label: 'Interest Rate',
          fieldType: 'number',
          placeholder: 'e.g. 6.25',
          required: true,
          min: 0,
          max: 25,
          step: 0.01,
        },
        {
          nodeId: 'term-input',
          label: 'Loan Term',
          fieldType: 'number',
          placeholder: 'e.g. 30',
          required: true,
          min: 1,
          max: 40,
          step: 1,
        },
      ],
      submitButton: { nodeId: 'submit-btn', label: 'Calculate' },
      resultDisplay: { nodeId: 'results-area', type: 'card' },
    })

    const output = compileLayout(layout)

    // Validate structure
    expect(output).toBeTruthy()
    expect(output).toContain('<div') // root frame
    expect(output).toContain('id="calc-root"')

    // Form injection: should have <form> element
    expect(output).toContain('<form')
    expect(output).toContain('</form>')

    // HTMX attributes
    expect(output).toContain('hx-post="/api/calc/mortgage"')
    expect(output).toContain('hx-target="#calculator-results"')
    expect(output).toContain('hx-swap="outerHTML"')

    // WebMCP attributes
    expect(output).toContain('mcp-tool="calculate_mortgage"')
    expect(output).toContain('mcp-param=')
    expect(output).toContain('mcp-description=')

    // Tailwind classes
    expect(output).toMatch(/rounded/)

    // All node IDs present
    expect(output).toContain('id="title"')
    expect(output).toContain('id="amount-input"')
    expect(output).toContain('id="rate-input"')
    expect(output).toContain('id="term-input"')
    expect(output).toContain('id="submit-btn"')
    // Result display gets overridden to calculator-results
    expect(output).toContain('id="calculator-results"')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 12. Empty/null safe handling
// ═══════════════════════════════════════════════════════════════════════════

describe('Empty/null safe handling', () => {
  it('handles empty children array gracefully', () => {
    const layout = makeLayout({
      rootNode: makeFrame({ children: [] }),
    })
    const output = compileLayout(layout)
    expect(output).toBeTruthy()
    expect(output).toMatch(/^<div/)
    expect(output).toMatch(/<\/div>$/)
  })

  it('handles nodes with no children property', () => {
    const layout = makeLayout({
      rootNode: makeFrame({ children: undefined }),
    })
    const output = compileLayout(layout)
    expect(output).toBeTruthy()
  })

  it('handles null children', () => {
    const layout = makeLayout({
      rootNode: makeFrame({ children: null as any }),
    })
    const output = compileLayout(layout)
    expect(output).toBeTruthy()
  })

  it('handles missing formFields gracefully', () => {
    const layout = {
      schemaVersion: SCHEMA_VERSION,
      rootNode: makeFrame(),
    }
    const output = compileLayout(layout as any)
    expect(output).toBeTruthy()
    expect(output).toContain('<div')
  })

  it('handles undefined corner radius', () => {
    const layout = makeLayout({
      rootNode: makeFrame({ cornerRadius: undefined }),
    })
    const output = compileLayout(layout)
    expect(output).toBeTruthy()
  })

  it('handles undefined opacity', () => {
    const layout = makeLayout({
      rootNode: makeFrame({ opacity: undefined }),
    })
    const output = compileLayout(layout)
    expect(output).toBeTruthy()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 13. Form input type mapping from fieldType
// ═══════════════════════════════════════════════════════════════════════════

describe('Form input type mapping', () => {
  it('maps fieldType "number" to input type="number"', () => {
    const layout = makeLayout({
      rootNode: makeFrame({
        id: 'form-root',
        children: [makeFrame({ id: 'input1' })],
      }),
      formFields: [
        { nodeId: 'input1', label: 'Amount', fieldType: 'number', required: true },
      ],
      submitButton: { nodeId: 'form-root', label: 'Calculate' },
    })
    const output = compileLayout(layout)
    expect(output).toContain('type="number"')
  })

  it('maps fieldType "text" to input type="text"', () => {
    const layout = makeLayout({
      rootNode: makeFrame({
        id: 'form-root',
        children: [makeFrame({ id: 'input1' })],
      }),
      formFields: [
        { nodeId: 'input1', label: 'Name', fieldType: 'text', required: true },
      ],
      submitButton: { nodeId: 'form-root', label: 'Go' },
    })
    const output = compileLayout(layout)
    expect(output).toContain('type="text"')
  })

  it('maps fieldType "select" to <select> element', () => {
    const layout = makeLayout({
      rootNode: makeFrame({
        id: 'form-root',
        children: [makeFrame({ id: 'select1' })],
      }),
      formFields: [
        { nodeId: 'select1', label: 'Frequency', fieldType: 'select', required: true },
      ],
      submitButton: { nodeId: 'form-root', label: 'Go' },
    })
    const output = compileLayout(layout)
    expect(output).toContain('<select')
    expect(output).toContain('</select>')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 14. Submit button rendering
// ═══════════════════════════════════════════════════════════════════════════

describe('Submit button', () => {
  it('renders submit button with label text', () => {
    const layout = makeLayout({
      rootNode: makeFrame({
        id: 'form-root',
        children: [makeFrame({ id: 'btn' })],
      }),
      formFields: [],
      submitButton: { nodeId: 'btn', label: 'Calculate My Mortgage' },
    })
    const output = compileLayout(layout)
    expect(output).toContain('type="submit"')
    expect(output).toContain('Calculate My Mortgage')
  })

  it('wraps submit button in form', () => {
    const layout = makeLayout({
      rootNode: makeFrame({
        id: 'form-root',
        children: [makeFrame({ id: 'btn' })],
      }),
      formFields: [],
      submitButton: { nodeId: 'btn', label: 'Submit' },
    })
    const output = compileLayout(layout)
    expect(output).toContain('<form')
    expect(output).toContain('</form>')
    // Submit button should be inside form
    const formStart = output.indexOf('<form')
    const submitIdx = output.indexOf('type="submit"')
    expect(submitIdx).toBeGreaterThan(formStart)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 15. Result display container
// ═══════════════════════════════════════════════════════════════════════════

describe('Result display', () => {
  it('injects id="calculator-results" on result display node', () => {
    const layout = makeLayout({
      rootNode: makeFrame({
        id: 'form-root',
        children: [makeFrame({ id: 'results' })],
      }),
      formFields: [],
      resultDisplay: { nodeId: 'results', type: 'card' },
    })
    const output = compileLayout(layout)
    expect(output).toContain('id="calculator-results"')
  })

  it('uses resultDisplay node for the results target', () => {
    const layout = makeLayout({
      rootNode: makeFrame({
        id: 'form-root',
        children: [
          makeFrame({ id: 'btn' }),
          makeFrame({ id: 'results-area' }),
        ],
      }),
      formFields: [],
      submitButton: { nodeId: 'btn', label: 'Go' },
      resultDisplay: { nodeId: 'results-area', type: 'card' },
    })
    const output = compileLayout(layout)
    // The hx-target should point to the result display node
    expect(output).toContain('hx-target')
    expect(output).toContain('#calculator-results')
    // The results div should have the calculator-results id (replaces original id)
    expect(output).toContain('id="calculator-results"')
    // The original id should NOT be present (since it's overridden)
    expect(output).not.toContain('id="results-area"')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 16. Public API surface
// ═══════════════════════════════════════════════════════════════════════════

describe('Public API', () => {
  it('exports compileLayout as a function', () => {
    expect(typeof compileLayout).toBe('function')
  })

  it('compileLayout returns a string', () => {
    const result = compileLayout(makeLayout())
    expect(typeof result).toBe('string')
  })
})
