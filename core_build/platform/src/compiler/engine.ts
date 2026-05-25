     1|/**
     2| * EdgeGDE Mortgage Calculator — JSON-to-HTML Compilation Engine
     3| * HSAES Phase 2: Provably stable compilation with strict sorting,
     4| * recursive loop protection, and WebMCP injections.
     5| *
     6| * @packageDocumentation
     7| */
     8|
     9|import type { LayoutDefinition, OpenPencilNode, FormField } from '@/schemas/openpencil'
    10|
    11|// ═══════════════════════════════════════════════════════════════════════════
    12|// Types
    13|// ═══════════════════════════════════════════════════════════════════════════
    14|
    15|/** Compiler context passed through recursive calls */
    16|interface CompileContext {
    17|  /** Set of visited node IDs for cycle detection */
    18|  visited: Set<string>
    19|  /** Layout definition for form field / submit / result metadata */
    20|  layout: LayoutDefinition
    21|  /** Map of field data by node ID */
    22|  fieldMap: Map<string, FormField>
    23|  /** Set of used mcp-param values for collision detection */
    24|  usedMcpParams: Set<string>
    25|  /** Node ID of the submit button, if any */
    26|  submitNodeId: string | null
    27|  /** Submit button label */
    28|  submitLabel: string
    29|  /** Node ID of the result display, if any */
    30|  resultNodeId: string | null
    31|}
    32|
    33|// ═══════════════════════════════════════════════════════════════════════════
    34|// Node type → HTML element mapping
    35|// ═══════════════════════════════════════════════════════════════════════════
    36|
    37|type NodeType = 'FRAME' | 'TEXT' | 'RECTANGLE' | 'ELLIPSE' | 'LINE' | 'COMPONENT' | 'INSTANCE' | 'GROUP' | 'VECTOR'
    38|
    39|const TYPE_TO_ELEMENT: Record<NodeType, string> = {
    40|  FRAME: 'div',
    41|  TEXT: 'span',
    42|  RECTANGLE: 'div',
    43|  ELLIPSE: 'div',
    44|  LINE: 'hr',
    45|  COMPONENT: 'div',
    46|  INSTANCE: 'div',
    47|  GROUP: 'div',
    48|  VECTOR: 'div',
    49|}
    50|
    51|function getElementType(node: OpenPencilNode): string {
    52|  return TYPE_TO_ELEMENT[node.type as NodeType] || 'div'
    53|}
    54|
    55|// ═══════════════════════════════════════════════════════════════════════════
    56|// Tailwind scale helpers
    57|// ═══════════════════════════════════════════════════════════════════════════
    58|
    59|/** Rounded value scale — maps px to Tailwind rounded name */
    60|const ROUNDED_MAP: [number, string][] = [
    61|  [0, 'none'],
    62|  [2, 'sm'],
    63|  [4, 'md'],
    64|  [6, 'lg'],
    65|  [8, 'xl'],
    66|  [12, '2xl'],
    67|  [16, '3xl'],
    68|]
    69|
    70|function mapRounded(px: number): string {
    71|  if (px >= 9999 || px >= 50) return 'full'
    72|  let best = 'none'
    73|  for (const [threshold, name] of ROUNDED_MAP) {
    74|    if (px >= threshold) best = name
    75|  }
    76|  return best
    77|}
    78|
    79|/** Opacity class map */
    80|const OPACITY_MAP: [number, string][] = [
    81|  [0, '0'],
    82|  [0.05, '5'],
    83|  [0.1, '10'],
    84|  [0.2, '20'],
    85|  [0.25, '25'],
    86|  [0.3, '30'],
    87|  [0.4, '40'],
    88|  [0.5, '50'],
    89|  [0.6, '60'],
    90|  [0.7, '70'],
    91|  [0.75, '75'],
    92|  [0.8, '80'],
    93|  [0.9, '90'],
    94|  [0.95, '95'],
    95|  [1, '100'],
    96|]
    97|
    98|function mapOpacity(value: number): string {
    99|  let best = '100'
   100|  for (const [threshold, name] of OPACITY_MAP) {
   101|    if (value >= threshold) best = name
   102|  }
   103|  return best
   104|}
   105|
   106|// ═══════════════════════════════════════════════════════════════════════════
   107|// Label → snake_case helper
   108|// ═══════════════════════════════════════════════════════════════════════════
   109|
   110|function toSnakeCase(label: string): string {
   111|  return label
   112|    .replace(/['']/g, '')
   113|    .replace(/[^a-zA-Z0-9\s]/g, '')
   114|    .replace(/\s+/g, '_')
   115|    .toLowerCase()
   116|}
   117|
   118|// ═══════════════════════════════════════════════════════════════════════════
   119|// Attribute builders
   120|// ═══════════════════════════════════════════════════════════════════════════
   121|
   122|function buildClasses(node: OpenPencilNode): string[] {
   123|  const classes: string[] = []
   124|
   125|  // Frame → flex layout
   126|  if (node.type === 'FRAME' || node.type === 'GROUP') {
   127|    classes.push('flex', 'flex-col')
   128|  }
   129|
   130|  // Corner radius
   131|  if (node.cornerRadius != null && node.cornerRadius > 0) {
   132|    classes.push(`rounded-${mapRounded(node.cornerRadius)}`)
   133|  }
   134|
   135|  // Opacity
   136|  if (node.opacity != null && node.opacity < 1) {
   137|    classes.push(`opacity-${mapOpacity(node.opacity)}`)
   138|  }
   139|
   140|  return classes
   141|}
   142|
   143|// ═══════════════════════════════════════════════════════════════════════════
   144|// Attribute serialization (sorted: class → hx-* → id → mcp-*)
   145|// ═══════════════════════════════════════════════════════════════════════════
   146|
   147|type AttrBucket = 'class' | 'hx' | 'id' | 'mcp'
   148|
   149|function classifyAttr(name: string): AttrBucket {
   150|  if (name === 'class') return 'class'
   151|  if (name === 'id') return 'id'
   152|  if (name.startsWith('hx-')) return 'hx'
   153|  if (name.startsWith('mcp-')) return 'mcp'
   154|  return 'mcp'
   155|}
   156|
   157|function serializeAttributes(attrs: Record<string, string>): string {
   158|  if (Object.keys(attrs).length === 0) return ''
   159|
   160|  const buckets: Record<AttrBucket, [string, string][]> = {
   161|    class: [],
   162|    hx: [],
   163|    id: [],
   164|    mcp: [],
   165|  }
   166|
   167|  for (const [name, value] of Object.entries(attrs)) {
   168|    const bucket = classifyAttr(name)
   169|    buckets[bucket].push([name, value])
   170|  }
   171|
   172|  // Sort within each bucket alphabetically by attribute name
   173|  for (const bucket of Object.keys(buckets) as AttrBucket[]) {
   174|    buckets[bucket].sort(([a], [b]) => a.localeCompare(b))
   175|  }
   176|
   177|  // Concatenate in bucket order
   178|  const parts: string[] = []
   179|  for (const bucket of ['class', 'hx', 'id', 'mcp'] as AttrBucket[]) {
   180|    for (const [name, value] of buckets[bucket]) {
   181|      parts.push(`${name}="${escapeAttr(value)}"`)
   182|    }
   183|  }
   184|
   185|  return parts.length > 0 ? ' ' + parts.join(' ') : ''
   186|}
   187|
   188|function escapeAttr(value: string): string {
   189|  return value.replace(/"/g, '&quot;').replace(/&/g, '&amp;')
   190|}
   191|
   192|// ═══════════════════════════════════════════════════════════════════════════
   193|// HTMX & WebMCP attribute generators
   194|// ═══════════════════════════════════════════════════════════════════════════
   195|
   196|function getFormContainerAttrs(): Record<string, string> {
   197|  const attrs: Record<string, string> = {}
   198|
   199|  // Always add HTMX attributes for form containers
   200|  attrs['hx-post'] = '/api/calc/mortgage'
   201|  attrs['hx-target'] = '#calculator-results'
   202|  attrs['hx-swap'] = 'outerHTML'
   203|
   204|  // Add WebMCP tool attributes
   205|  attrs['mcp-tool'] = 'calculate_mortgage'
   206|  attrs['mcp-description'] = 'Mortgage calculator — calculates repayments based on loan amount, interest rate, and term'
   207|
   208|  return attrs
   209|}
   210|
   211|/**
   212| * Check if the layout has form-related content that needs a <form> wrapper.
   213| * A form wrapper is needed when there are form fields OR a submit button.
   214| */
   215|function needsFormWrapper(layout: LayoutDefinition): boolean {
   216|  const hasFields = layout.formFields && layout.formFields.length > 0
   217|  const hasSubmit = !!layout.submitButton
   218|  return hasFields || hasSubmit
   219|}
   220|
   221|/**
   222| * Generate and validate the mcp-param for a given form field.
   223| * Throws on duplicate param values.
   224| */
   225|function getMcpParam(field: FormField, usedMcpParams: Set<string>): string {
   226|  const paramName = (field as any).mcpParam || toSnakeCase(field.label)
   227|  if (usedMcpParams.has(paramName)) {
   228|    throw new Error(
   229|      `Duplicate mcp-param value: "${paramName}" — ` +
   230|      `both "${field.label}" and a previous field would produce this value`
   231|    )
   232|  }
   233|  usedMcpParams.add(paramName)
   234|  return paramName
   235|}
   236|
   237|// ═══════════════════════════════════════════════════════════════════════════
   238|// Recursive node compiler
   239|// ═══════════════════════════════════════════════════════════════════════════
   240|
   241|/**
   242| * Compile a single node to its HTML representation.
   243| */
   244|function compileNode(node: OpenPencilNode, ctx: CompileContext): string {
   245|  // ── Cycle detection ──────────────────────────────────────────────────
   246|  if (ctx.visited.has(node.id)) {
   247|    throw new Error(
   248|      `Cycle detected: node "${node.id}" (${node.name}) has already been visited`
   249|    )
   250|  }
   251|  ctx.visited.add(node.id)
   252|
   253|  try {
   254|    const hasForm = needsFormWrapper(ctx.layout)
   255|    const isFormContainer = hasForm && node.id === ctx.layout.rootNode.id
   256|    const isFormField = ctx.fieldMap.has(node.id)
   257|    const isSubmit = node.id === ctx.submitNodeId
   258|    const isResult = node.id === ctx.resultNodeId
   259|
   260|    // ── Determine element type ─────────────────────────────────────────
   261|    let elementType: string
   262|    if (isFormContainer) {
   263|      elementType = 'form'
   264|    } else if (isSubmit && !isFormContainer) {
   265|      elementType = 'button'
   266|    } else if (isFormField) {
   267|      const field = ctx.fieldMap.get(node.id)!
   268|      elementType = field.fieldType === 'select' ? 'select' : 'input'
   269|    } else {
   270|      elementType = getElementType(node)
   271|    }
   272|
   273|    // ── Build attributes ───────────────────────────────────────────────
   274|    const allAttrs: Record<string, string> = {}
   275|    const classes = buildClasses(node)
   276|
   277|    // class
   278|    if (classes.length > 0) {
   279|      allAttrs.class = classes.join(' ')
   280|    }
   281|
   282|    // Form container HTMX + WebMCP attributes
   283|    if (isFormContainer) {
   284|      Object.assign(allAttrs, getFormContainerAttrs())
   285|    }
   286|
   287|    // id
   288|    if (isResult) {
   289|      allAttrs.id = 'calculator-results'
   290|    } else {
   291|      allAttrs.id = node.id
   292|    }
   293|
   294|    // Submit button gets type="submit"
   295|    if (isSubmit && elementType === 'button') {
   296|      allAttrs.type = 'submit'
   297|    }
   298|
   299|    // Form field attributes
   300|    if (isFormField) {
   301|      const field = ctx.fieldMap.get(node.id)!
   302|
   303|      if (elementType === 'input') {
   304|        allAttrs.type = field.fieldType === 'slider' ? 'range' : field.fieldType
   305|        if (field.placeholder) allAttrs.placeholder = field.placeholder
   306|        if (field.required) allAttrs.required = 'required'
   307|        if (field.min != null) allAttrs.min = String(field.min)
   308|        if (field.max != null) allAttrs.max = String(field.max)
   309|        if (field.step != null) allAttrs.step = String(field.step)
   310|      } else if (elementType === 'select') {
   311|        if (field.required) allAttrs.required = 'required'
   312|        if (field.placeholder) allAttrs.placeholder = field.placeholder
   313|      }
   314|
   315|      // mcp-param (register and get param name)
   316|      const paramName = getMcpParam(field, ctx.usedMcpParams)
   317|      allAttrs['mcp-param'] = paramName
   318|    }
   319|
   320|    // ── Build children HTML ────────────────────────────────────────────
   321|    let childrenHtml = compileChildren(node, ctx)
   322|
   323|    // If this is the submit button, use the label as text content
   324|    if (isSubmit && elementType === 'button') {
   325|      childrenHtml = escapeHtml(ctx.submitLabel)
   326|    }
   327|
   328|    // If this is the form container and the submit button IS the root,
   329|    // append a submit button inside the form
   330|    if (isFormContainer && ctx.submitNodeId === node.id) {
   331|      const btnAttrs: Record<string, string> = {}
   332|      btnAttrs.type = 'submit'
   333|      if (classes.length > 0) btnAttrs.class = classes.join(' ')
   334|      childrenHtml += `<button${serializeAttributes(btnAttrs)}>${escapeHtml(ctx.submitLabel)}</button>`
   335|    }
   336|
   337|    // ── Serialize ──────────────────────────────────────────────────────
   338|    const html = `<${elementType}${serializeAttributes(allAttrs)}>${childrenHtml}</${elementType}>`
   339|
   340|    ctx.visited.delete(node.id)
   341|    return html
   342|  } catch (e) {
   343|    ctx.visited.delete(node.id)
   344|    throw e
   345|  }
   346|}
   347|
   348|function compileChildren(node: OpenPencilNode, ctx: CompileContext): string {
   349|  if (!node.children || !Array.isArray(node.children)) return ''
   350|  return (node.children as OpenPencilNode[])
   351|    .filter((child: OpenPencilNode) => child != null && typeof child === 'object')
   352|    .map((child: OpenPencilNode) => compileNode(child, ctx))
   353|    .join('')
   354|}
   355|
   356|function escapeHtml(text: string): string {
   357|  return text
   358|    .replace(/&/g, '&amp;')
   359|    .replace(/</g, '&lt;')
   360|    .replace(/>/g, '&gt;')
   361|    .replace(/"/g, '&quot;')
   362|}
   363|
   364|// ═══════════════════════════════════════════════════════════════════════════
   365|// Public API
   366|// ═══════════════════════════════════════════════════════════════════════════
   367|
   368|/**
   369| * Compile an OpenPencil LayoutDefinition into a deterministic HTML string.
   370| *
   371| * - Recursively compiles nodes with cycle detection
   372| * - Sorts attributes in fixed order: class → hx-* → id → mcp-*
   373| * - Injects HTMX attributes for form containers
   374| * - Injects WebMCP tool/param/description attributes
   375| * - Maps OpenPencil layout properties to Tailwind classes
   376| *
   377| * @param layout - The validated layout definition
   378| * @returns Serialized HTML string
   379| * @throws {Error} If a cycle is detected or mcp-param collision occurs
   380| */
   381|export function compileLayout(layout: LayoutDefinition): string {
   382|  const fieldMap = new Map<string, FormField>()
   383|
   384|  // Build field map — mcp-param validation happens at render time
   385|  for (const field of layout.formFields || []) {
   386|    fieldMap.set(field.nodeId, field)
   387|  }
   388|
   389|  // Validate mcp-param uniqueness across ALL fields upfront
   390|  // (catches collisions even across different nodeIds before rendering)
   391|  {
   392|    const checkSet = new Set<string>()
   393|    for (const field of layout.formFields || []) {
   394|      const paramName = (field as any).mcpParam || toSnakeCase(field.label)
   395|      if (checkSet.has(paramName)) {
   396|        throw new Error(
   397|          `Duplicate mcp-param value: "${paramName}" — ` +
   398|          `both "${field.label}" and a previous field would produce this value`
   399|        )
   400|      }
   401|      checkSet.add(paramName)
   402|    }
   403|  }
   404|
   405|  // Build context
   406|  const ctx: CompileContext = {
   407|    visited: new Set<string>(),
   408|    layout,
   409|    fieldMap,
   410|    usedMcpParams: new Set<string>(),
   411|    submitNodeId: layout.submitButton?.nodeId ?? null,
   412|    submitLabel: layout.submitButton?.label ?? 'Submit',
   413|    resultNodeId: layout.resultDisplay?.nodeId ?? null,
   414|  }
   415|
   416|  // Compile the root node recursively
   417|  return compileNode(layout.rootNode, ctx)
   418|}
   419|