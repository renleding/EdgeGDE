/**
 * Quick validation check for guardKV schema gate
 */
import { guardKV } from '../src/lib/kv'
import { validateStoragePayload } from '../src/lib/validators'

// Test 1: guardKV blocks invalid entry
console.log('=== Test 1: guardKV schema gate ===')
const mockKV = {
  get: async (k: string) => null,
  put: async (k: string, v: string) => { console.log(`  PUT allowed: ${k.substring(0, 40)}...`) },
}
const guarded = guardKV(mockKV as any)

// Valid knowledge entry should work
try {
  await guarded.put(
    'tenant:test:kb_pending:rates',
    JSON.stringify({
      entries: [{
        type: 'knowledge',
        id: 'rate_var',
        value: '6.15%',
        description: 'Variable rate',
        source_ref: 'r2/path',
        updated_at: Date.now(),
      }],
      source_ref: 'r2/path',
      ingested_at: Date.now(),
    }),
    { tenantId: 'test' }
  )
  console.log('  ✅ Valid knowledge entry accepted')
} catch (e: any) {
  console.log(`  ❌ Valid entry rejected: ${e.message}`)
}

// Invalid compliance entry (missing trigger) should be blocked
try {
  await guarded.put(
    'tenant:test:kb:compliance',
    JSON.stringify({
      entries: [{
        type: 'compliance',
        id: 'disc_1',
        value: 'Some disclosure',
        description: 'Test',
        source_ref: 'r2/path',
        updated_at: Date.now(),
        // missing trigger!
      }],
    }),
    { tenantId: 'test' }
  )
  console.log('  ❌ Invalid compliance entry was ACCEPTED (should be blocked)')
} catch (e: any) {
  console.log(`  ✅ Invalid compliance entry blocked: ${e.message}`)
}

// Malformed JSON in kb: key should be blocked
try {
  await guarded.put(
    'tenant:test:kb:rates',
    '{invalid json here',
    { tenantId: 'test' }
  )
  console.log('  ❌ Malformed JSON was ACCEPTED (should be blocked)')
} catch (e: any) {
  console.log(`  ✅ Malformed JSON blocked: ${e.message}`)
}

// Primitive key should pass through
try {
  await guarded.put(
    'tenant:test:some_flag',
    '1',
    { tenantId: 'test' }
  )
  console.log('  ✅ Primitive key allowed')
} catch (e: any) {
  console.log(`  ❌ Primitive key blocked: ${e.message}`)
}

console.log('\n=== Test 2: validateStoragePayload ===')

// Valid knowledge
try {
  validateStoragePayload('kb:rates', { entries: [{ type: 'knowledge', id: 'a', value: 'b', description: 'c', source_ref: 'd', updated_at: 1 }] })
  console.log('  ✅ Valid knowledge passes')
} catch (e: any) {
  console.log(`  ❌ Valid knowledge failed: ${e.message}`)
}

// Valid compliance
try {
  validateStoragePayload('kb:compliance', { entries: [{ type: 'compliance', id: 'a', value: 'b', description: 'c', trigger: 'd', source_ref: 'e', updated_at: 1 }] })
  console.log('  ✅ Valid compliance passes')
} catch (e: any) {
  console.log(`  ❌ Valid compliance failed: ${e.message}`)
}

// kb_pending with valid knowledge
try {
  validateStoragePayload('kb_pending:rates', { entries: [{ type: 'knowledge', id: 'a', value: 'b', description: 'c', source_ref: 'd', updated_at: 1 }] })
  console.log('  ✅ kb_pending knowledge passes')
} catch (e: any) {
  console.log(`  ❌ kb_pending knowledge failed: ${e.message}`)
}

// kb_rejected — same validation
try {
  validateStoragePayload('kb_rejected:rates', { entries: [{ type: 'knowledge', id: 'a', value: 'b', description: 'c', source_ref: 'd', updated_at: 1 }] })
  console.log('  ✅ kb_rejected knowledge passes')
} catch (e: any) {
  console.log(`  ❌ kb_rejected knowledge failed: ${e.message}`)
}

console.log('\nAll validation tests complete.')
