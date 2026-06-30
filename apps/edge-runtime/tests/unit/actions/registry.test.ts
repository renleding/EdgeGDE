import { describe, it, expect } from 'vitest'
import { registerAction, getAction, listActions } from '../../../src/actions/lifecycle'
import type { EdgeGDEAction } from '../../../src/actions/types'

describe('Action Registry', () => {
  it('registerAction and getAction round-trip', () => {
    const action: EdgeGDEAction = {
      type: 'test.action' as const,
      async execute() { return { status: 'success' as const, output: null, durationMs: 0 } },
      async compensate() {},
    }
    registerAction(action)
    const retrieved = getAction('test.action')
    expect(retrieved).toBeDefined()
    expect(retrieved!.type).toBe('test.action')
  })

  it('getAction returns undefined for unknown type', () => {
    expect(getAction('nonexistent')).toBeUndefined()
  })

  it('listActions returns registered actions', () => {
    const actions = listActions()
    expect(Array.isArray(actions)).toBe(true)
  })
})
