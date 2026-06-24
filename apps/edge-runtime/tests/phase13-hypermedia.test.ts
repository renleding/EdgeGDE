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

import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { renderUiConfigToHtml, renderUiConfigToHtmlWithOob } from '../src/lib/renderer'

describe('Suite 1: Functional Hypermedia Compilation (Stateless Determinism)', () => {
  it('1.1 exact string output determinism (1000x parallel)', async () => {
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
      expect(hashes[i]).toBe(first)
    }
  })

  it('1.2 XSS payload neutralization', () => {
    const malicious = {
      type: 'text' as const,
      text: '<script>alert("xss")</script>',
      class: 'gde-field" onerror="javascript:alert(\'malicious\')"',
    }
    const html = renderUiConfigToHtml(malicious, {})
    expect(html.includes('<script>')).toBeFalsy()
    expect(html.includes('&lt;script&gt;')).toBeTruthy()
    // Attribute values are escaped — class value contains escaped quotes
    expect(html.includes('&quot;')).toBeTruthy()
    expect(html.includes('javascript:')).toBeFalsy()
    // XSS injection attempt in class value is neutralized by quote escaping
    // The malicious payload becomes part of the class value, not a new attribute
    expect(/class="[^"]*&quot;/.test(html)).toBeTruthy()
  })

  it('1.3 mustache token interpolation', () => {
    const input = {
      type: 'text' as const,
      text: 'Hello {{applicant_name}}, your income is {{income}}.',
    }
    const ctx = { applicant_name: 'Warren', income: 120000 }
    const html = renderUiConfigToHtml(input, ctx)
    expect(html.includes('Hello Warren')).toBeTruthy()
    // Nested key — not supported, should render empty
    const nested = {
      type: 'text' as const,
      text: 'Nested: {{nested.key.value}}',
    }
    const nestedHtml = renderUiConfigToHtml(nested, ctx)
    expect(nestedHtml.includes('Nested: ')).toBeTruthy()
    expect(nestedHtml.includes('nested.key.value')).toBeFalsy()

    // Missing token
    const missing = {
      type: 'text' as const,
      text: 'Missing: {{missing_token_id}}',
    }
    const missingHtml = renderUiConfigToHtml(missing, ctx)
    expect(missingHtml.includes('Missing: ')).toBeTruthy()
  })
})

describe('Suite 3: Anti-Regression, Stack Limits, and Cycle Isolation', () => {
  it('3.1 stack overflow depth guard (max 16)', () => {
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
    expect(typeof html === 'string').toBeTruthy()
    // Depth > 16 should produce <!-- max depth --> at the deepest levels
    expect(html.includes('<!-- max depth -->')).toBeTruthy()
  })

  it('3.2 parallel sibling cycle isolation', () => {
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
    expect(html.includes('Card A')).toBeTruthy()
    expect(html.includes('Card B')).toBeTruthy()
    // Should not throw — duplicate IDs are allowed (just not ideal)
    expect(typeof html === 'string').toBeTruthy()
  })
})

describe('Suite 4.1: Target Box Wrapper Decoupling', () => {
  it('4.1 target box wrapper — wrapper-{id} structure', () => {
    const input = {
      type: 'text_input' as const,
      id: 'name-field',
      name: 'fullName',
      label: 'Full Name',
      placeholder: 'Enter your name',
    }

    const html = renderUiConfigToHtml(input, {})
    expect(html.includes('id="wrapper-name-field"')).toBeTruthy()
    expect(html.includes('hx-target="#wrapper-name-field"')).toBeTruthy()
    expect(html.includes('hx-trigger="blur changed delay:400ms"')).toBeTruthy()
  })

  it('4.1b OOB swap rendering', () => {
    const input = {
      type: 'text_input' as const,
      id: 'oob-field',
      name: 'oobTest',
      label: 'OOB Test',
    }

    const oobIds = new Set(['oob-field'])
    const html = renderUiConfigToHtmlWithOob(input, {}, oobIds)
    expect(html.includes('hx-swap-oob="true"')).toBeTruthy()
  })
})
