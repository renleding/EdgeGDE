/**
 * Tests for gogo authorization gate.
 */
import { describe, it, expect } from 'vitest'
import { checkGogo, createGogo, scopeFromGogo } from '../../src/actions/gogo'
import type { MissionDefinition } from '../../src/actions/types'

describe('checkGogo', () => {
  const mission: MissionDefinition = {
    id: 'test',
    name: 'Test',
    desiredState: {},
    actions: [],
  }

  const manifest = {
    id: 'test',
    steps: [{ stepId: 's1', actionType: 'site.publish', description: 'Deploy', risk: 'low' as const, approvalMode: 'auto' as const, input: {} }],
  } as any

  it('rejects missing gogo', () => {
    const result = checkGogo(mission, manifest)
    expect(result.authorized).toBe(false)
    expect(result.reason).toContain('No gogo authorization')
  })

  it('accepts valid gogo', () => {
    mission.gogo = createGogo({ authorizedBy: 'warren' })
    const result = checkGogo(mission, manifest)
    expect(result.authorized).toBe(true)
  })

  it('rejects expired gogo', () => {
    mission.gogo = createGogo({
      authorizedBy: 'warren',
      expiresAt: '2020-01-01T00:00:00Z',
    })
    const result = checkGogo(mission, manifest)
    expect(result.authorized).toBe(false)
    expect(result.reason).toContain('expired')
  })

  it('rejects action outside scope', () => {
    mission.gogo = createGogo({
      authorizedBy: 'warren',
      scope: { actions: ['lead.capture'] },
    })
    const result = checkGogo(mission, manifest)
    expect(result.authorized).toBe(false)
    expect(result.reason).toContain('site.publish')
  })

  it('accepts action inside scope', () => {
    mission.gogo = createGogo({
      authorizedBy: 'warren',
      scope: { actions: ['site.publish', 'lead.capture'] },
    })
    const result = checkGogo(mission, manifest)
    expect(result.authorized).toBe(true)
  })

  it('accepts empty scope actions (no restriction)', () => {
    mission.gogo = createGogo({
      authorizedBy: 'warren',
      scope: { actions: [] },
    })
    const result = checkGogo(mission, manifest)
    expect(result.authorized).toBe(true)
  })

  it('rejects exceeded drift threshold', () => {
    mission.gogo = createGogo({
      authorizedBy: 'warren',
      scope: { maxDrift: 0.5 },
    })
    mission.driftThreshold = 1.0
    const result = checkGogo(mission, manifest)
    expect(result.authorized).toBe(false)
    expect(result.reason).toContain('exceeds')
  })
})

describe('scopeFromGogo', () => {
  it('detects deploy scope', () => {
    const scope = scopeFromGogo('gogo deploy')
    expect(scope?.actions).toContain('site.publish')
  })

  it('detects test scope', () => {
    const scope = scopeFromGogo('gogo test')
    expect(scope?.maxDrift).toBe(0.5)
  })

  it('returns undefined for generic gogo', () => {
    const scope = scopeFromGogo('gogo')
    expect(scope).toBeUndefined()
  })
})
