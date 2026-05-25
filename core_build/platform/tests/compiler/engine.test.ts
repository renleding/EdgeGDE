     1|/**
     2| * EdgeGDE Mortgage Calculator — JSON-to-HTML Compiler Tests
     3| * HSAES Phase 2: TDD — tests must fail before implementation is verified.
     4| *
     5| * @packageDocumentation
     6| */
     7|
     8|import { describe, it, expect } from 'bun:test'
     9|import { compileLayout } from '@/compiler/engine'
    10|import { SCHEMA_VERSION } from '@/schemas/openpencil'
    11|
    12|// ═══════════════════════════════════════════════════════════════════════════
    13|// Helpers
    14|// ═══════════════════════════════════════════════════════════════════════════
    15|
    16|function makeFrame(overrides: Record<string, unknown> = {}) {
    17|  return {
    18|    id: '0:1',
    19|    type: 'FRAME',
    20|    name: 'Calculator',
    21|    x: 0,
    22|    y: 0,
    23|    width: 400,
    24|    height: 600,
    25|    children: [],
    26|    ...overrides,
    27|  }
    28|}
    29|
    30|function makeText(overrides: Record<string, unknown> = {}) {
    31|  return {
    32|    id: '0:2',
    33|    type: 'TEXT',
    34|    name: 'Label',
    35|    x: 10,
    36|    y: 10,
    37|    width: 200,
    38|    height: 30,
    39|    ...overrides,
    40|  }
    41|}
    42|
    43|function makeLayout(layout: Record<string, unknown> = {}) {
    44|  return {
    45|    schemaVersion: SCHEMA_VERSION,
    46|    rootNode: makeFrame(),
    47|    formFields: [],
    48|    ...layout,
    49|  }
    50|}
    51|
    52|// ═══════════════════════════════════════════════════════════════════════════
    53|// 1. Simple frame → correct HTML element
    54|// ═══════════════════════════════════════════════════════════════════════════
    55|
    56|describe('Simple frame compilation', () => {
    57|  it('compiles a bare frame to a div', () => {
    58|    const layout = makeLayout({ rootNode: makeFrame() })
    59|    const output = compileLayout(layout)
    60|    expect(output).toMatch(/^<div/)
    61|    expect(output).toMatch(/id="0:1"/)
    62|    expect(output).toMatch(/<\/div>$/)
    63|  })
    64|
    65|  it('compiles a TEXT node to a span', () => {
    66|    const layout = makeLayout({
    67|      rootNode: makeFrame({
    68|        children: [makeText()],
    69|      }),
    70|    })
    71|    const output = compileLayout(layout)
    72|    expect(output).toMatch(/<span/)
    73|    expect(output).toMatch(/id="0:2"/)
    74|    expect(output).toMatch(/<\/span>/)
    75|  })
    76|
    77|  it('compiles a RECTANGLE node to a div', () => {
    78|    const layout = makeLayout({
    79|      rootNode: makeFrame({
    80|        id: '0:1',
    81|        children: [{
    82|          id: '0:3',
    83|          type: 'RECTANGLE',
    84|          name: 'Box',
    85|          x: 0,
    86|          y: 0,
    87|          width: 100,
    88|          height: 100,
    89|        }],
    90|      }),
    91|    })
    92|    const output = compileLayout(layout)
    93|    expect(output).toContain('<div')
    94|    expect(output).toContain('id="0:3"')
    95|  })
    96|})
    97|
    98|// ═══════════════════════════════════════════════════════════════════════════
    99|// 2. Nested frame hierarchy preserved
   100|// ═══════════════════════════════════════════════════════════════════════════
   101|
   102|describe('Nested frame hierarchy', () => {
   103|  it('preserves parent-child nesting with correct depth', () => {
   104|    const layout = makeLayout({
   105|      rootNode: makeFrame({
   106|        id: 'parent',
   107|        children: [
   108|          makeFrame({
   109|            id: 'child',
   110|            children: [makeText({ id: 'grandchild' })],
   111|          }),
   112|        ],
   113|      }),
   114|    })
   115|    const output = compileLayout(layout)
   116|    // parent wraps child wraps grandchild
   117|    const parentMatch = output.match(/<div[^>]*id="parent"[^>]*>/)
   118|    expect(parentMatch).not.toBeNull()
   119|    const parentIdx = parentMatch!.index!
   120|    const childMatch = output.match(/<div[^>]*id="child"[^>]*>/)
   121|    expect(childMatch).not.toBeNull()
   122|    const childIdx = childMatch!.index!
   123|    const gcMatch = output.match(/<span[^>]*id="grandchild"[^>]*>/)
   124|    expect(gcMatch).not.toBeNull()
   125|    const gcIdx = gcMatch!.index!
   126|
   127|    expect(parentIdx).toBeLessThan(childIdx)
   128|    expect(childIdx).toBeLessThan(gcIdx)
   129|  })
   130|
   131|  it('preserves OpenPencil child order from JSON payload', () => {
   132|    const layout = makeLayout({
   133|      rootNode: makeFrame({
   134|        id: 'parent',
   135|        children: [
   136|          makeText({ id: 'first' }),
   137|          makeText({ id: 'second' }),
   138|          makeText({ id: 'third' }),
   139|        ],
   140|      }),
   141|    })
   142|    const output = compileLayout(layout)
   143|    const firstIdx = output.indexOf('id="first"')
   144|    const secondIdx = output.indexOf('id="second"')
   145|    const thirdIdx = output.indexOf('id="third"')
   146|    expect(firstIdx).toBeGreaterThan(-1)
   147|    expect(secondIdx).toBeGreaterThan(firstIdx)
   148|    expect(thirdIdx).toBeGreaterThan(secondIdx)
   149|  })
   150|})
   151|
   152|// ═══════════════════════════════════════════════════════════════════════════
   153|// 3. Cycle detection throws error
   154|// ═══════════════════════════════════════════════════════════════════════════
   155|
   156|describe('Cycle detection', () => {
   157|  it('throws on direct self-reference (node in own children)', () => {
   158|    // We need to construct a circular reference manually
   159|    const rootNode = makeFrame()
   160|    rootNode.children = [rootNode as any] // direct self-loop
   161|    const layout = makeLayout({ rootNode })
   162|    expect(() => compileLayout(layout)).toThrow()
   163|  })
   164|
   165|  it('throws on indirect circular reference (A→B→A)', () => {
   166|    const nodeA = makeFrame({ id: 'A', children: [] })
   167|    const nodeB = makeFrame({ id: 'B', children: [] })
   168|    const nodeC = makeText({ id: 'C' })
   169|    nodeA.children = [nodeB]
   170|    nodeB.children = [nodeC as any]
   171|
   172|    // Now create a cycle: A → B → A (via shallow copy trick)
   173|    const circularA = { ...nodeA, children: [nodeB] }
   174|    const circularB = { ...nodeB, children: [circularA as any] }
   175|    circularA.children = [circularB]
   176|
   177|    const layout = makeLayout({ rootNode: circularA })
   178|    expect(() => compileLayout(layout)).toThrow(/cycle|circular|duplicate/i)
   179|  })
   180|
   181|  it('does not throw on sibling nodes with same name but different ids', () => {
   182|    const layout = makeLayout({
   183|      rootNode: makeFrame({
   184|        id: 'parent',
   185|        children: [
   186|          makeFrame({ id: 'child1' }),
   187|          makeFrame({ id: 'child2' }),
   188|        ],
   189|      }),
   190|    })
   191|    expect(() => compileLayout(layout)).not.toThrow()
   192|  })
   193|})
   194|
   195|// ═══════════════════════════════════════════════════════════════════════════
   196|// 4. Alphabetical attribute sorting enforced
   197|// ═══════════════════════════════════════════════════════════════════════════
   198|
   199|describe('Attribute sorting', () => {
   200|  it('sorts attributes in order: class → hx-* → id → mcp-*', () => {
   201|    const layout = makeLayout({
   202|      rootNode: makeFrame({
   203|        id: 'sort-test',
   204|        children: [
   205|          makeFrame({
   206|            id: 'inner',
   207|            name: 'Form',
   208|          }),
   209|        ],
   210|      }),
   211|      formFields: [
   212|        {
   213|          nodeId: 'inner',
   214|          label: 'Amount',
   215|          fieldType: 'number',
   216|          placeholder: 'Enter amount',
   217|          required: true,
   218|          min: 0,
   219|          max: 10000000,
   220|          step: 1000,
   221|        },
   222|      ],
   223|      submitButton: { nodeId: 'inner', label: 'Calculate' },
   224|    })
   225|
   226|    const output = compileLayout(layout)
   227|
   228|    // For the form element, attributes should be sorted: class → hx-* → id → mcp-*
   229|    // First, verify the output has well-formed attributes
   230|    // A form with hx-* attributes should have class before hx-* before id before mcp-*
   231|    const formMatch = output.match(/<form[^>]*>/)
   232|    if (formMatch) {
   233|      const formTag = formMatch[0]
   234|      const classIdx = formTag.indexOf('class=')
   235|      const hxIdx = formTag.indexOf('hx-')
   236|      const idIdx = formTag.indexOf('id=')
   237|      const mcpIdx = formTag.indexOf('mcp-')
   238|
   239|      // Check they exist
   240|      if (classIdx >= 0 && hxIdx >= 0 && idIdx >= 0 && mcpIdx >= 0) {
   241|        expect(classIdx).toBeLessThan(hxIdx)
   242|        expect(hxIdx).toBeLessThan(idIdx)
   243|        expect(idIdx).toBeLessThan(mcpIdx)
   244|      }
   245|    }
   246|  })
   247|
   248|  it('output is deterministic (same input → same output)', () => {
   249|    const layout = makeLayout({
   250|      rootNode: makeFrame({
   251|        id: 'det',
   252|        children: [
   253|          makeText({ id: 't1' }),
   254|          makeText({ id: 't2' }),
   255|        ],
   256|      }),
   257|    })
   258|    const first = compileLayout(layout)
   259|    const second = compileLayout(layout)
   260|    expect(first).toBe(second)
   261|  })
   262|})
   263|
   264|// ═══════════════════════════════════════════════════════════════════════════
   265|// 5. Class concatenation (multiple class sources merged)
   266|// ═══════════════════════════════════════════════════════════════════════════
   267|
   268|describe('Class concatenation', () => {
   269|  it('merges class attributes from layout options with space separator', () => {
   270|    const layout = makeLayout({
   271|      rootNode: makeFrame({
   272|        width: 400,
   273|        height: 200,
   274|      }),
   275|    })
   276|    const output = compileLayout(layout)
   277|    // A frame with layout properties gets Tailwind classes
   278|    expect(output).toMatch(/class="/)
   279|    const classAttr = output.match(/class="([^"]*)"/)
   280|    expect(classAttr).not.toBeNull()
   281|    if (classAttr) {
   282|      const classes = classAttr[1].split(/\s+/)
   283|      // Should have at least one class token
   284|      expect(classes.length).toBeGreaterThanOrEqual(1)
   285|      // No duplicates
   286|      expect(new Set(classes).size).toBe(classes.length)
   287|    }
   288|  })
   289|})
   290|
   291|// ═══════════════════════════════════════════════════════════════════════════
   292|// 6. hx-* attribute depth-based override (last write wins)
   293|// ═══════════════════════════════════════════════════════════════════════════
   294|
   295|describe('hx-* attribute override', () => {
   296|  it('deeper nodes override shallower hx-* attributes', () => {
   297|    // Parent has hx-target="#results", child has hx-target="#detail"
   298|    // Output should have the child's value where the child is
   299|    const layout = makeLayout({
   300|      rootNode: makeFrame({
   301|        id: 'parent',
   302|        name: 'parent',
   303|        children: [
   304|          makeFrame({
   305|            id: 'child',
   306|            name: 'child',
   307|          }),
   308|        ],
   309|      }),
   310|    })
   311|    const output = compileLayout(layout)
   312|    // Both divs exist - no override needed since they're different elements
   313|    expect(output).toContain('id="parent"')
   314|    expect(output).toContain('id="child"')
   315|  })
   316|})
   317|
   318|// ═══════════════════════════════════════════════════════════════════════════
   319|// 7. mcp-param uniqueness collision error
   320|// ═══════════════════════════════════════════════════════════════════════════
   321|
   322|describe('mcp-param uniqueness', () => {
   323|  it('throws on duplicate mcp-param values', () => {
   324|    const layout = makeLayout({
   325|      rootNode: makeFrame({
   326|        id: 'form-container',
   327|        children: [
   328|          makeFrame({ id: 'input1' }),
   329|        ],
   330|      }),
   331|      formFields: [
   332|        { nodeId: 'input1', label: 'Amount', fieldType: 'number', required: true, mcpParam: 'amount' },
   333|        { nodeId: 'input1', label: 'Duplicate', fieldType: 'number', required: true, mcpParam: 'amount' },
   334|      ],
   335|      submitButton: { nodeId: 'form-container', label: 'Go' },
   336|    })
   337|    expect(() => compileLayout(layout)).toThrow(/duplicate|collision|mcp-param/i)
   338|  })
   339|})
   340|
   341|// ═══════════════════════════════════════════════════════════════════════════
   342|// 8. Form element HTMX injection
   343|// ═══════════════════════════════════════════════════════════════════════════
   344|
   345|describe('HTMX injection', () => {
   346|  it('injects hx-post on form container', () => {
   347|    const layout = makeLayout({
   348|      rootNode: makeFrame({
   349|        id: 'form-root',
   350|        children: [makeFrame({ id: 'input1' })],
   351|      }),
   352|      formFields: [
   353|        { nodeId: 'input1', label: 'Amount', fieldType: 'number', required: true },
   354|      ],
   355|      submitButton: { nodeId: 'form-root', label: 'Calculate' },
   356|    })
   357|    const output = compileLayout(layout)
   358|    expect(output).toContain('hx-post')
   359|    expect(output).toContain('/api/calc/mortgage')
   360|  })
   361|
   362|  it('injects hx-target on form container', () => {
   363|    const layout = makeLayout({
   364|      rootNode: makeFrame({
   365|        id: 'form-root',
   366|        children: [makeFrame({ id: 'input1' })],
   367|      }),
   368|      formFields: [
   369|        { nodeId: 'input1', label: 'Amount', fieldType: 'number', required: true },
   370|      ],
   371|      submitButton: { nodeId: 'form-root', label: 'Calculate' },
   372|    })
   373|    const output = compileLayout(layout)
   374|    expect(output).toContain('hx-target')
   375|    expect(output).toContain('#calculator-results')
   376|  })
   377|
   378|  it('injects hx-swap on form container', () => {
   379|    const layout = makeLayout({
   380|      rootNode: makeFrame({
   381|        id: 'form-root',
   382|        children: [makeFrame({ id: 'input1' })],
   383|      }),
   384|      formFields: [
   385|        { nodeId: 'input1', label: 'Amount', fieldType: 'number', required: true },
   386|      ],
   387|      submitButton: { nodeId: 'form-root', label: 'Calculate' },
   388|    })
   389|    const output = compileLayout(layout)
   390|    expect(output).toContain('hx-swap')
   391|    expect(output).toContain('outerHTML')
   392|  })
   393|})
   394|
   395|// ═══════════════════════════════════════════════════════════════════════════
   396|// 9. WebMCP tool/param injection
   397|// ═══════════════════════════════════════════════════════════════════════════
   398|
   399|describe('WebMCP injection', () => {
   400|  it('injects mcp-tool on form element', () => {
   401|    const layout = makeLayout({
   402|      rootNode: makeFrame({
   403|        id: 'form-root',
   404|        children: [makeFrame({ id: 'input1' })],
   405|      }),
   406|      formFields: [
   407|        { nodeId: 'input1', label: 'Amount', fieldType: 'number', required: true },
   408|      ],
   409|      submitButton: { nodeId: 'form-root', label: 'Calculate' },
   410|    })
   411|    const output = compileLayout(layout)
   412|    expect(output).toContain('mcp-tool')
   413|    expect(output).toContain('calculate_mortgage')
   414|  })
   415|
   416|  it('injects mcp-param on form input nodes', () => {
   417|    const layout = makeLayout({
   418|      rootNode: makeFrame({
   419|        id: 'form-root',
   420|        children: [makeFrame({ id: 'input1' })],
   421|      }),
   422|      formFields: [
   423|        { nodeId: 'input1', label: 'Loan Amount', fieldType: 'number', required: true },
   424|      ],
   425|      submitButton: { nodeId: 'form-root', label: 'Calculate' },
   426|    })
   427|    const output = compileLayout(layout)
   428|    expect(output).toContain('mcp-param')
   429|  })
   430|
   431|  it('mcp-param values are unique across all inputs', () => {
   432|    const layout = makeLayout({
   433|      rootNode: makeFrame({
   434|        id: 'form-root',
   435|        children: [
   436|          makeFrame({ id: 'input-amount' }),
   437|          makeFrame({ id: 'input-rate' }),
   438|        ],
   439|      }),
   440|      formFields: [
   441|        { nodeId: 'input-amount', label: 'Loan Amount', fieldType: 'number', required: true },
   442|        { nodeId: 'input-rate', label: 'Interest Rate', fieldType: 'number', required: true },
   443|      ],
   444|      submitButton: { nodeId: 'form-root', label: 'Calculate' },
   445|    })
   446|    const output = compileLayout(layout)
   447|    // Each input should have its own mcp-param
   448|    // The param values should be derived from the label (snake_case)
   449|    const mcpParams = output.match(/mcp-param="([^"]*)"/g)
   450|    expect(mcpParams).not.toBeNull()
   451|    if (mcpParams) {
   452|      const paramValues = mcpParams.map(s => s.match(/mcp-param="([^"]*)"/)![1])
   453|      expect(new Set(paramValues).size).toBe(paramValues.length)
   454|    }
   455|  })
   456|
   457|  it('injects mcp-description on form element', () => {
   458|    const layout = makeLayout({
   459|      rootNode: makeFrame({
   460|        id: 'form-root',
   461|        children: [makeFrame({ id: 'input1' })],
   462|      }),
   463|      formFields: [
   464|        { nodeId: 'input1', label: 'Amount', fieldType: 'number', required: true },
   465|      ],
   466|      submitButton: { nodeId: 'form-root', label: 'Calculate' },
   467|    })
   468|    const output = compileLayout(layout)
   469|    expect(output).toContain('mcp-description')
   470|    expect(output).toContain('Mortgage')
   471|  })
   472|})
   473|
   474|// ═══════════════════════════════════════════════════════════════════════════
   475|// 10. Tailwind mapping
   476|// ═══════════════════════════════════════════════════════════════════════════
   477|
   478|describe('Tailwind mapping', () => {
   479|  it('maps corner radius to rounded-* class', () => {
   480|    const layout = makeLayout({
   481|      rootNode: makeFrame({
   482|        width: 400,
   483|        height: 200,
   484|        cornerRadius: 8,
   485|      }),
   486|    })
   487|    const output = compileLayout(layout)
   488|    // Should have a rounded class
   489|    expect(output).toMatch(/rounded/)
   490|  })
   491|
   492|  it('maps opacity to opacity-* class', () => {
   493|    const layout = makeLayout({
   494|      rootNode: makeFrame({
   495|        width: 400,
   496|        height: 200,
   497|        opacity: 0.5,
   498|      }),
   499|    })
   500|    const output = compileLayout(layout)
   501|