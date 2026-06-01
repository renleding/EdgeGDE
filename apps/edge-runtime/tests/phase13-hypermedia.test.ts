/**
 * EdgeGDE — Phase 13: Hypermedia Renderer Integration Tests
 *
 * Tests:
 *   Suite 1: Functional Hypermedia Compilation (Stateless Determinism)
 *   Suite 3: Anti-Regression, Stack Limits, and Cycle Isolation
 *   Suite 4.1: Target Box Wrapper Decoupling
 *
 * Suites 2 and 5 require active SSE connections / browser context
 * and are run separately via wrangler dev + Playwright.
 *
 * @packageDocumentation
 */

import assert from 'node:assert'
import { createHash } from 'node:crypto'
import { renderUiConfigToHtml, renderUiConfigToHtmlWithOob } from '../src/lib/renderer'

let passed = 0
let failed = 0

function run(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e: any) {
    failed++
    console.error(`  ✗ ${name}`)
    console.error(`    ${e.message}`)
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Suite 1: Functional Hypermedia Compilation (Stateless Determinism)
// ═════════════════════════════════════════════════════════════════════════════

console.log('\n── Suite 1: Functional Hypermedia Compilation ──')

// Test 1.1: Exact String Output Determinism — 1000 parallel runs
run('1.1 exact string output determinism (1000x parallel)', async () => {
  const input = {
    type: 'container' as const,
    direction: 'column',
    gap: '12px',
    children: [
      { type: 'text_input' as const, name: 'fullName', label: 'Full Name', placeholder: 'Enter name' },
      { type: 'number_input' as const, name: 'income', label: 'Income', placeholder: 'Annual income' },
      { type: 'select' as const, name: 'employmentType', label: 'Employment Type', options: [{ value: 'PAYG', label: 'PAYG' }, { value: 'Self-Employed', label: 'Self-Employed' }] },
    ],
  }
  const ctx = { fullName: 'Alice', income: 120000 }

  const hashes = await Promise.all(Array.from({ length: 1000 }, () =>
    Promise.resolve().then(() => {
      const html = renderUiConfigToHtml(input, ctx)
      return createHash('sha256').update(html).digest('hex')
    })
  ))

  const first = hashes[0]
  for (let i = 1; i < hashes.length; i++) {
    assert.strictEqual(hashes[i], first, `Hash mismatch at index ${i}`)
  }
})

// Test 1.2: XSS Payload Neutralization
run('1.2 XSS payload neutralization', () => {
  const malicious = {
    type: 'text' as const,
    text: '<script>alert("xss")</script>',
    class: 'gde-field" onerror="javascript:alert(\'malicious\')"',
  }
  const html = renderUiConfigToHtml(malicious, {})
  assert.ok(!html.includes('<script>'), 'Script tag leaked through')
  assert.ok(html.includes('&lt;script&gt;'), 'Script tag not escaped')
  // Attribute values are escaped — class value contains escaped quotes
  assert.ok(html.includes('&quot;'), 'Attribute quotes properly escaped')
  assert.ok(!html.includes('javascript:'), 'javascript: URI leaked')
  // XSS injection attempt in class value is neutralized by quote escaping
  // The malicious payload becomes part of the class value, not a new attribute
  assert.ok(/class="[^"]*&quot;/.test(html), 'Class attribute injection blocked by escaping')
})

// Test 1.3: Mustache Token Interpolation Limits
run('1.3 mustache token interpolation', () => {
  const input = {
    type: 'text' as const,
    text: 'Hello {{applicant_name}}, your income is {{income}}.',
  }
  const ctx = { applicant_name: 'Warren', income: 120000 }
  const html = renderUiConfigToHtml(input, ctx)
  assert.ok(html.includes('Hello Warren'), 'Valid token not interpolated')
  // Nested key — not supported, should render empty
  const nested = {
    type: 'text' as const,
    text: 'Nested: {{nested.key.value}}',
  }
  const nestedHtml = renderUiConfigToHtml(nested, ctx)
  assert.ok(nestedHtml.includes('Nested: '), 'Nested key not resolved to empty string')
  assert.ok(!nestedHtml.includes('nested.key.value'), 'Nested key leaked through')

  // Missing token
  const missing = {
    type: 'text' as const,
    text: 'Missing: {{missing_token_id}}',
  }
  const missingHtml = renderUiConfigToHtml(missing, ctx)
  assert.ok(missingHtml.includes('Missing: '), 'Missing token not resolved to empty string')
})

// ═════════════════════════════════════════════════════════════════════════════
// Suite 3: Anti-Regression, Stack Limits, and Cycle Isolation
// ═════════════════════════════════════════════════════════════════════════════

console.log('\n── Suite 3: Anti-Regression, Stack Limits, Cycle Isolation ──')

// Test 3.1: Stack Overflow Depth Guard
run('3.1 stack overflow depth guard (max 16)', () => {
  // Build 20 layers of nested containers
  let root: any = { type: 'container' as const, children: [] }
  let current = root
  for (let i = 0; i < 20; i++) {
    const child: any = { type: 'container' as const, children: [] }
    current.children = [child]
    current = child
  }

  const html = renderUiConfigToHtml(root, {})
  // Should render without throwing
  assert.ok(typeof html === 'string', 'Renderer threw exception')
  // Depth > 16 should produce <!-- max depth --> at the deepest levels
  assert.ok(html.includes('<!-- max depth -->'), 'Depth guard comment not found')
})

// Test 3.2: Parallel Sibling Cycle Isolation
run('3.2 parallel sibling cycle isolation', () => {
  const input = {
    type: 'container' as const,
    direction: 'row',
    gap: '16px',
    children: [
      {
        type: 'card' as const,
        id: 'parallel-field-id',
        title: 'Card A',
        children: [
          { type: 'text_input' as const, name: 'fieldA', label: 'Field A' },
        ],
      },
      {
        type: 'card' as const,
        id: 'parallel-field-id', // Duplicate ID — should not cause cycle error
        title: 'Card B',
        children: [
          { type: 'text_input' as const, name: 'fieldB', label: 'Field B' },
        ],
      },
    ],
  }

  const html = renderUiConfigToHtml(input, {})
  assert.ok(html.includes('Card A'), 'Card A missing from output')
  assert.ok(html.includes('Card B'), 'Card B missing from output')
  // Should not throw — duplicate IDs are allowed (just not ideal)
  assert.ok(typeof html === 'string', 'Renderer threw on duplicate IDs')
})

// ═════════════════════════════════════════════════════════════════════════════
// Suite 4.1: Target Box Wrapper Decoupling
// ═════════════════════════════════════════════════════════════════════════════

console.log('\n── Suite 4.1: Target Box Wrapper Decoupling ──')

run('4.1 target box wrapper — wrapper-{id} structure', () => {
  const input = {
    type: 'text_input' as const,
    id: 'name-field',
    name: 'fullName',
    label: 'Full Name',
    placeholder: 'Enter your name',
  }

  const html = renderUiConfigToHtml(input, {})
  assert.ok(html.includes('id="wrapper-name-field"'), 'Wrapper div missing id="wrapper-{id}"')
  assert.ok(html.includes('hx-target="#wrapper-name-field"'), 'hx-target missing wrapper reference')
  assert.ok(html.includes('hx-trigger="blur changed delay:400ms"'), 'Default hx-trigger missing')
})

run('4.1b OOB swap rendering', () => {
  const input = {
    type: 'text_input' as const,
    id: 'oob-field',
    name: 'oobTest',
    label: 'OOB Test',
  }

  const oobIds = new Set(['oob-field'])
  const html = renderUiConfigToHtmlWithOob(input, {}, oobIds)
  assert.ok(html.includes('hx-swap-oob="true"'), 'OOB attribute missing from output')
})

// ═════════════════════════════════════════════════════════════════════════════
// Summary
// ═════════════════════════════════════════════════════════════════════════════

console.log('')
if (failed === 0) {
  console.log(`✅ All ${passed} Phase 13 integration tests passed`)
  process.exit(0)
} else {
  console.error(`❌ ${failed}/${passed + failed} Phase 13 integration tests failed`)
  process.exit(1)
}
