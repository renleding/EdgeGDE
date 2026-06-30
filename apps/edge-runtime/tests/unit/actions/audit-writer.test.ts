import { describe, it, expect } from 'vitest'
import { appendToAuditLedger } from '../../../src/actions/audit-writer'

describe('appendToAuditLedger', () => {
  it('silently skips when env has no AUDIT_LEDGER binding', async () => {
    // fire-and-forget: should never throw, just log and return
    const result = appendToAuditLedger({}, {
      type: 'test.event',
      tenantId: 'tenant-1',
      actor: 'test',
      data: { key: 'value' },
    })
    await expect(result).resolves.toBeUndefined()
  })
})
