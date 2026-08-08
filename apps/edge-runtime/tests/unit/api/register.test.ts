import { describe, it, expect } from 'vitest'
// Static top-level import: module chain loads during collection, outside the
// test timeout window. Was a dynamic await import() inside the test body —
// 2138ms avg load, ~30% flake under load (EG-FIX-0008).
import { registerRouter } from '../../../src/api/register'

describe('Register API', () => {
  it('module loads without error', () => {
    expect(registerRouter).toBeDefined()
  })
})
