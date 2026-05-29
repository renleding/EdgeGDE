/**
 * EdgeGDE EDR — Standalone Compiler + Validator Tests
 * v6.2: Uses node:assert. No test framework dependency.
 *
 * @packageDocumentation
 */

import assert from 'node:assert'
import { compile } from '../../src/edr/compiler/engine'
import { validate } from '../../src/edr/spec-runtime/validator'

// Shared minimal EDR definition for compile() calls
const edrDef = {
  components: {
    card: { padding: '20px', background_color: '#ffffff', border_radius: '12px' },
    form_container: { display: 'flex', flex_direction: 'column', gap: '12px' },
  },
  global: {},
}

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

// ═══════════════════════════════════════════════════════════════════════════
// TEST 1 — Design System Resolution
// ═══════════════════════════════════════════════════════════════════════════
run('design_system_resolution', () => {
  const input = {
    type: 'div',
    props: { role: 'card', preset: 'premium' },
    children: [],
  }

  const output = compile(input, edrDef, 'test-hash', 'edr')

  assert.ok(/edr-/.test(output), `Missing EDR class in output: ${output.substring(0, 100)}`)
  assert.ok(!/position:absolute/.test(output), 'Legacy layout leaked into output')
})

// ═══════════════════════════════════════════════════════════════════════════
// TEST 2 — HTMX Passthrough
// ═══════════════════════════════════════════════════════════════════════════
run('htmx_passthrough', () => {
  const input = {
    type: 'form',
    props: {
      role: 'form_container',
      'hx-post': '/api/test',
      'hx-target': '#result',
    },
    children: [],
  }

  const output = compile(input, edrDef, 'test-hash', 'edr')

  assert.ok(output.includes('hx-post="/api/test"'), `Missing hx-post in: ${output.substring(0, 100)}`)
  assert.ok(output.includes('hx-target="#result"'), `Missing hx-target in: ${output.substring(0, 100)}`)
})

// ═══════════════════════════════════════════════════════════════════════════
// TEST 3 — Validator MCP Collision Enforcement
// ═══════════════════════════════════════════════════════════════════════════
run('mcp_collision_validation', () => {
  const input = {
    type: 'div',
    props: { 'mcp-param': 'email' },
    children: [
      {
        type: 'input',
        props: { 'mcp-param': 'email' },
        children: [],
      },
    ],
  }

  assert.throws(
    () => validate(input),
    /collision|mcp-param/i,
    'Validator should throw on duplicate mcp-param',
  )
})

// ═══════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════
console.log('')
if (failed === 0) {
  console.log(`✅ All ${passed} EDR tests passed`)
  process.exit(0)
} else {
  console.error(`❌ ${failed}/${passed + failed} EDR tests failed`)
  process.exit(1)
}
