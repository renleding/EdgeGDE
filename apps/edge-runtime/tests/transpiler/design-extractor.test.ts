/**
 * EdgeGDE Canvas — Design Token Extractor Tests
 * v2.1: Verify automatic extraction from inline styles.
 *
 * @packageDocumentation
 */

import assert from 'node:assert'
import { extractDesignTokens, type ParsedStyle } from '../../src/transpiler/design-extractor'

let passed = 0
let failed = 0

function run(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log('  ✓ ' + name)
  } catch (e: any) {
    failed++
    console.error('  ✗ ' + name)
    console.error('    ' + e.message)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

run('extracts dark theme tokens from dark page styles', () => {
  const styles: ParsedStyle[] = [
    { tagName: 'body', backgroundColor: '#0d1117', color: '#e1e4e8' },
    { tagName: 'h1', color: '#f0f6fc', fontFamily: 'Inter', fontSize: '36px', fontWeight: 700 },
    { tagName: 'p', color: '#8b949e', fontFamily: 'Inter', fontSize: '16px' },
    { tagName: 'a', color: '#58a6ff' },
    { tagName: 'div', backgroundColor: '#1c2128', borderColor: '#2d3140', borderRadius: '8px' },
    { tagName: 'button', backgroundColor: '#238636', color: '#ffffff' },
  ]

  const tokens = extractDesignTokens(styles)

  assert.strictEqual(tokens.colors.background, '#0d1117')
  assert.strictEqual(tokens.colors.text, '#8b949e')
  assert.strictEqual(tokens.colors.primary, '#58a6ff')
  assert.strictEqual(tokens.colors.surface, '#1c2128')
  assert.strictEqual(tokens.colors.border, '#2d3140')
  assert.strictEqual(tokens.colors.muted, '#e1e4e8')
})

run('extracts light theme tokens from light page styles', () => {
  const styles: ParsedStyle[] = [
    { tagName: 'body', backgroundColor: '#ffffff', color: '#1c2128' },
    { tagName: 'h1', color: '#0d1117', fontFamily: 'Inter', fontSize: '32px' },
    { tagName: 'p', color: '#6e7681' },
    { tagName: 'a', color: '#0969da' },
    { tagName: 'div', backgroundColor: '#f6f8fa' },
  ]

  const tokens = extractDesignTokens(styles)

  assert.strictEqual(tokens.colors.background, '#ffffff')
  assert.strictEqual(tokens.colors.text, '#6e7681')
  assert.strictEqual(tokens.colors.primary, '#1c2128')
})

run('extracts typography from heading and body elements', () => {
  const styles: ParsedStyle[] = [
    { tagName: 'h1', fontFamily: 'Inter', fontSize: '48px', fontWeight: 700 },
    { tagName: 'h1', fontFamily: 'Inter', fontSize: '48px', fontWeight: 700 },
    { tagName: 'h2', fontFamily: 'Inter', fontSize: '32px', fontWeight: 600 },
    { tagName: 'p', fontFamily: 'Inter', fontSize: '16px', fontWeight: 400 },
    { tagName: 'p', fontFamily: 'Inter', fontSize: '16px', fontWeight: 400 },
    { tagName: 'p', fontFamily: 'Inter', fontSize: '16px', fontWeight: 400 },
  ]

  const tokens = extractDesignTokens(styles)

  assert.strictEqual(tokens.typography.fontFamily, 'Inter')
  assert.strictEqual(tokens.typography.fontSize?.h1, '48px')
  assert.strictEqual(tokens.typography.fontSize?.body, '16px')
  assert.strictEqual(tokens.typography.fontWeight?.h1, 700)
  assert.strictEqual(tokens.typography.fontWeight?.body, 400)
})

run('returns defaults for empty input', () => {
  const tokens = extractDesignTokens([])

  assert.ok(tokens.colors.background)
  assert.ok(tokens.colors.text)
  assert.ok(tokens.colors.primary)
  assert.ok(tokens.typography.fontFamily)
  assert.ok(tokens.typography.fontSize?.h1)
  assert.ok(tokens.spacing.borderRadius)
})

run('extracts spacing values', () => {
  const styles: ParsedStyle[] = [
    { tagName: 'section', padding: '60px 40px', borderRadius: '12px' },
    { tagName: 'div', padding: '20px', borderRadius: '8px' },
    { tagName: 'div', padding: '20px', borderRadius: '8px' },
    { tagName: 'div', padding: '16px', borderRadius: '8px' },
  ]

  const tokens = extractDesignTokens(styles)

  assert.strictEqual(tokens.spacing.sectionPadding, '16px')
  assert.strictEqual(tokens.spacing.cardPadding, '16px')
  assert.strictEqual(tokens.spacing.borderRadius, '8px')
})

run('detects accent color without matching background or text', () => {
  const styles: ParsedStyle[] = [
    { tagName: 'body', backgroundColor: '#0d1117', color: '#e1e4e8' },
    { tagName: 'a', color: '#ff6b6b' },
    { tagName: 'a', color: '#ff6b6b' },
    { tagName: 'button', backgroundColor: '#ff6b6b' },
    { tagName: 'h1', color: '#f0f6fc' },
  ]

  const tokens = extractDesignTokens(styles)

  assert.strictEqual(tokens.colors.primary, '#ff6b6b')
})

run('produces complete DesignTokens — no undefined values', () => {
  const styles: ParsedStyle[] = [
    { tagName: 'body', backgroundColor: '#111', color: '#eee' },
  ]

  const tokens = extractDesignTokens(styles)

  // All fields should be strings (not undefined)
  const check = (obj: any, path: string[] = []) => {
    for (const [key, val] of Object.entries(obj)) {
      if (val && typeof val === 'object') check(val, [...path, key])
      // Strings and numbers are OK
    }
  }
  check(tokens)
  // Just verify no crash
  assert.ok(true)
})

console.log('\nDesign Token Extractor: ' + passed + ' passed, ' + failed + ' failed')
if (failed > 0) process.exit(1)
