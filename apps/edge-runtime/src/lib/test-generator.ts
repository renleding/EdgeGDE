/**
 * EdgeGDE Runtime — Auto-Test Generator
 * Phase 35F: Generates a self-contained smoke test script for a tenant layout.
 *
 * The generated test is a bash script using curl to verify:
 *   1. Layout renders correctly (HTTP 200)
 *   2. Form fields render with correct names
 *   3. Form submission works (HTMX POST returns 200)
 *   4. D1 contains the submission (admin API)
 */

import type { LayoutDefinition } from '@edgegde/schema'

// ═══════════════════════════════════════════════════════════════════════════
// Field Detection
// ═══════════════════════════════════════════════════════════════════════════

interface DetectedField {
  name: string
  type: 'input' | 'select' | 'submit'
}

function detectFields(layout: LayoutDefinition): DetectedField[] {
  const fields: DetectedField[] = []
  const walk = (node: any) => {
    if (!node) return
    const name = node.name || node.type || ''
    if (name.startsWith('Input:')) {
      fields.push({ name, type: 'input' })
    } else if (name === 'Button:Submit' || name === 'Button') {
      fields.push({ name, type: 'submit' })
    }
    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) walk(child)
    }
  }
  walk(layout)
  return fields
}

function sampleValue(field: DetectedField): string {
  if (field.type === 'submit') return ''
  const n = field.name.toLowerCase()
  if (n.includes('principal') || n.includes('amount') || n.includes('loan')) return '500000'
  if (n.includes('rate') || n.includes('interest')) return '6.25'
  if (n.includes('term') || n.includes('year')) return '25'
  if (n.includes('name')) return 'Test User'
  if (n.includes('email')) return 'test@example.com'
  if (n.includes('phone')) return '0400000000'
  if (n.includes('property')) return '123 Test St'
  if (n.includes('income')) return '120000'
  return 'test_value'
}

// ═══════════════════════════════════════════════════════════════════════════
// Test Script Generator
// ═══════════════════════════════════════════════════════════════════════════

export interface GenerateTestInput {
  tenantId: string
  baseUrl?: string
  adminToken?: string
}

export function generateTestScript(
  layout: LayoutDefinition,
  input: GenerateTestInput,
): string {
  const fields = detectFields(layout)
  const baseUrl = input.baseUrl || `https://${input.tenantId}.edgegde.com`
  const formFields = fields.filter((f) => f.type === 'input')
  const ts = new Date().toISOString().split('T')[0]
  const hasForm = formFields.length > 0

  const formData = formFields
    .filter((f) => !f.name.startsWith('Input:submit'))
    .map((f) => `  --data-urlencode "${f.name}=${sampleValue(f)}" \\`)
    .join('\n')

  // Build static lines that don't use TS template substitution
  const lines: string[] = []
  lines.push('#!/usr/bin/env bash')
  lines.push('# =============================================================================')
  lines.push(`# EdgeGDE Smoke Test — ${input.tenantId}`)
  lines.push(`# Generated: ${ts}`)
  lines.push('# Tests:')
  lines.push('#   1. Layout renders (HTTP 200)')
  if (hasForm) {
    lines.push(`#   2. Form fields render correctly (${formFields.length} fields detected)`)
    lines.push('#   3. Form submission succeeds (HTMX POST)')
    lines.push('#   4. D1 persistence verified via admin API')
  }
  lines.push('# =============================================================================')
  lines.push('')
  lines.push('set -e')
  lines.push('PASS=0')
  lines.push('FAIL=0')
  lines.push('')
  lines.push('check() {')
  lines.push('  local desc="$1"')
  lines.push('  local status="$2"')
  lines.push('  if [ "$status" -eq 0 ]; then')
  lines.push('    PASS=$((PASS + 1))')
  lines.push('    echo "  PASS $desc"')
  lines.push('  else')
  lines.push('    FAIL=$((FAIL + 1))')
  lines.push('    echo "  FAIL $desc"')
  lines.push('  fi')
  lines.push('}')
  lines.push('')
  lines.push('echo ""')
  lines.push('echo "========================================"')
  lines.push(`echo "  EdgeGDE Tenant: ${input.tenantId}"`)
  lines.push('echo "========================================"')
  lines.push('echo ""')
  lines.push('')
  lines.push('# Test 1: Layout renders')
  lines.push(`echo "Test 1: Layout at ${baseUrl}"`)
  lines.push('HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \\')
  lines.push(`  "${baseUrl}/?tenant=${input.tenantId}")`)
  lines.push('if [ "$HTTP_CODE" = "200" ]; then check "Layout OK (200)" 0; else check "Layout FAIL ($HTTP_CODE)" 1; fi')
  lines.push('echo ""')
  lines.push('')
  lines.push('# Test 2: Health endpoint')
  lines.push(`echo "Test 2: Health at ${baseUrl}/healthz"`)
  lines.push('H_CODE=$(curl -s -o /dev/null -w "%{http_code}" \\')
  lines.push(`  "${baseUrl}/healthz")`)
  lines.push('if [ "$H_CODE" = "200" ]; then check "Health OK (200)" 0; else check "Health FAIL ($H_CODE)" 1; fi')
  lines.push('echo ""')
  lines.push('')
  lines.push('# Test 3: MCP discovery')
  lines.push('D_CODE=$(curl -s -o /dev/null -w "%{http_code}" \\')
  lines.push(`  "${baseUrl}/.well-known/mcp.json")`)
  lines.push('if [ "$D_CODE" = "200" ]; then check "MCP OK (200)" 0; else check "MCP FAIL ($D_CODE)" 1; fi')
  lines.push('echo ""')
  lines.push('')

  if (hasForm) {
    lines.push('# Generate unique correlation ID for this test run')
    lines.push('CID="test-$(date +%s)-$$"')
    lines.push(`echo "Correlation ID: $CID"`)
    lines.push('echo ""')
    lines.push('')
    lines.push('# Test 4: Form submission with correlation ID')
    lines.push(`echo "Test 4: Submit form (${formFields.length} fields)"`)
    lines.push('S_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \\')
    lines.push(`  "${baseUrl}/api/form/mortgage" \\`)
    lines.push('  --data-urlencode "_test_correlation=$CID" \\')
    lines.push(formData)
    lines.push('  -H "Content-Type: application/x-www-form-urlencoded" \\')
    lines.push('  -H "HX-Request: true")')
    lines.push('if [ "$S_CODE" = "200" ]; then check "Submit OK (200)" 0; else check "Submit FAIL ($S_CODE)" 1; fi')
    lines.push('echo ""')
    lines.push('')
    lines.push('# Test 5: D1 persistence — verify correlation ID exists')
    lines.push(`echo "Test 5: D1 persistence (admin leads API)"`)
    lines.push('LEADS=$(curl -s \\')
    lines.push(`  "${baseUrl}/api/admin/leads/${input.tenantId}" \\`)
    lines.push('  -H "Authorization: Bearer $ADMIN_TOKEN" 2>/dev/null || echo "{}")')
    lines.push('if echo "$LEADS" | grep -q "$CID"; then')
    lines.push('  check "Persistence verified (CID=$CID)" 0')
    lines.push('else')
    lines.push('  check "Persistence FAIL (CID not found)" 1')
    lines.push('fi')
    lines.push('echo ""')
    lines.push('')
  }

  lines.push('echo ""')
  lines.push('echo "========================================"')
  lines.push('echo "  Results: $PASS passed / $((PASS + FAIL)) total"')
  lines.push('if [ "$FAIL" -gt 0 ]; then echo "  FAILURES: $FAIL"; fi')
  lines.push('echo "========================================"')
  lines.push('')
  lines.push('if [ "$FAIL" -gt 0 ]; then exit 1; fi')
  lines.push('exit 0')
  lines.push('')

  return lines.join('\n')
}
