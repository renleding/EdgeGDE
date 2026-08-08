import { describe, it, expect } from 'vitest'
import {
  artifactPrefix,
  artifactLatestKey,
  artifactVersionKey,
  tenantLayoutLatestKey,
  tenantLayoutStagingKey,
  tenantLayoutKey,
  tenantCompiledKey,
  hotLeadIndexKey,
  hotLeadKey,
  deadLetterIndexKey,
  deadLetterKey,
  canvasCacheGenKey,
  deployLockKey,
  compensateMarkerKey,
} from '../../../src/lib/kv-keys'

describe('artifactPrefix', () => {
  it('maps calculator to calc:', () => {
    expect(artifactPrefix('calculator')).toBe('calc:')
  })

  it('maps page to page:', () => {
    expect(artifactPrefix('page')).toBe('page:')
  })

  it('maps theme to theme:', () => {
    expect(artifactPrefix('theme')).toBe('theme:')
  })

  it('falls back to art: for unknown types', () => {
    expect(artifactPrefix('widget')).toBe('art:')
    expect(artifactPrefix('')).toBe('art:')
    expect(artifactPrefix('CALCULATOR')).toBe('art:') // case-sensitive switch
  })
})

describe('artifactLatestKey', () => {
  it('builds calc:<id>:latest', () => {
    expect(artifactLatestKey('calculator', 'loan-calc')).toBe('calc:loan-calc:latest')
  })

  it('uses the prefix of the given type', () => {
    expect(artifactLatestKey('theme', 'dark')).toBe('theme:dark:latest')
    expect(artifactLatestKey('unknown', 'x')).toBe('art:x:latest')
  })
})

describe('artifactVersionKey', () => {
  it('builds calc:<id>:<version>', () => {
    expect(artifactVersionKey('calculator', 'loan-calc', 'v3')).toBe('calc:loan-calc:v3')
  })

  it('uses the prefix of the given type', () => {
    expect(artifactVersionKey('page', 'home', '2')).toBe('page:home:2')
  })
})

describe('tenant layout keys', () => {
  it('builds tenantLayoutLatestKey', () => {
    expect(tenantLayoutLatestKey('acme')).toBe('tenant:acme:layout:latest')
  })

  it('builds tenantLayoutStagingKey', () => {
    expect(tenantLayoutStagingKey('acme')).toBe('tenant:acme:layout:staging')
  })

  it('builds tenantLayoutKey with arbitrary suffix', () => {
    expect(tenantLayoutKey('acme', 'v7')).toBe('tenant:acme:layout:v7')
    expect(tenantLayoutKey('acme', 'latest')).toBe('tenant:acme:layout:latest')
  })

  it('builds tenantCompiledKey with staging flag', () => {
    expect(tenantCompiledKey('acme', 'tool-a', true)).toBe('tenant:acme:compiled:tool-a:staging')
    expect(tenantCompiledKey('acme', 'tool-a', false)).toBe('tenant:acme:compiled:tool-a:prod')
  })
})

describe('hot lead keys', () => {
  it('builds hotLeadIndexKey', () => {
    expect(hotLeadIndexKey('acme')).toBe('tenant:acme:alerts:hot:index')
  })

  it('builds hotLeadKey', () => {
    expect(hotLeadKey('acme', 'sub-9')).toBe('tenant:acme:alert:hot:sub-9')
  })
})

describe('dead letter keys', () => {
  it('builds deadLetterIndexKey', () => {
    expect(deadLetterIndexKey('acme')).toBe('tenant:acme:deadletter:index')
  })

  it('builds deadLetterKey', () => {
    expect(deadLetterKey('acme', 'sub-1')).toBe('tenant:acme:deadletter:sub-1')
  })
})

describe('canvas cache / lock / compensate keys', () => {
  it('builds canvasCacheGenKey', () => {
    expect(canvasCacheGenKey('abc123')).toBe('cache:canvas:gen:abc123')
  })

  it('builds deployLockKey', () => {
    expect(deployLockKey('acme')).toBe('lock:acme:deploy')
  })

  it('builds compensateMarkerKey', () => {
    expect(compensateMarkerKey('mission-42')).toBe('compensate:mission-42')
  })
})
