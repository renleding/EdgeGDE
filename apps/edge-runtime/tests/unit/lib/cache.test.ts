import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  setLRU,
  getCachedTenant,
  setCachedTenant,
  clearTenant,
  getCachedLayout,
  setCachedLayout,
  clearLayout,
  getCachedDesign,
  setCachedDesign,
  clearDesign,
} from '../../../src/lib/cache'

afterEach(() => {
  vi.useRealTimers()
})

describe('setLRU', () => {
  it('inserts into an empty map', () => {
    const m = new Map<string, number>()
    setLRU(m, 'a', 1, 10)
    expect(m.get('a')).toBe(1)
    expect(m.size).toBe(1)
  })

  it('re-inserting an existing key moves it to the newest position', () => {
    const m = new Map<string, number>()
    setLRU(m, 'a', 1, 3)
    setLRU(m, 'b', 2, 3)
    setLRU(m, 'c', 3, 3)
    setLRU(m, 'a', 10, 3) // touch 'a' → order b, c, a
    setLRU(m, 'd', 4, 3) // evicts oldest = 'b'
    expect(m.has('b')).toBe(false)
    expect(m.get('a')).toBe(10)
    expect(m.get('c')).toBe(3)
    expect(m.get('d')).toBe(4)
  })

  it('evicts the oldest entry when exceeding maxSize', () => {
    const m = new Map<string, number>()
    setLRU(m, 'a', 1, 2)
    setLRU(m, 'b', 2, 2)
    setLRU(m, 'c', 3, 2)
    expect(m.size).toBe(2)
    expect(m.has('a')).toBe(false)
    expect(m.has('b')).toBe(true)
    expect(m.has('c')).toBe(true)
  })

  it('does not evict when at or under maxSize', () => {
    const m = new Map<string, number>()
    setLRU(m, 'a', 1, 2)
    setLRU(m, 'b', 2, 2)
    expect(m.size).toBe(2)
    expect(m.has('a')).toBe(true)
  })

  it('evicts immediately when maxSize is 0', () => {
    const m = new Map<string, number>()
    setLRU(m, 'a', 1, 0)
    expect(m.size).toBe(0)
  })
})

describe('tenant cache (no TTL, max 200)', () => {
  // Must run before any other tenantCache inserts so eviction is deterministic.
  it('evicts the oldest tenant past 200 entries', () => {
    for (let i = 0; i < 201; i++) {
      setCachedTenant(`tc-evict-${i}`, { slug: `tc-evict-${i}` } as never)
    }
    expect(getCachedTenant('tc-evict-0')).toBeUndefined()
    expect(getCachedTenant('tc-evict-200')).toEqual({ slug: 'tc-evict-200' })
  })

  it('returns undefined for an unknown slug', () => {
    expect(getCachedTenant('never-set')).toBeUndefined()
  })

  it('stores and retrieves a tenant config', () => {
    const tenant = { slug: 'acme', name: 'Acme' }
    setCachedTenant('acme', tenant as never)
    expect(getCachedTenant('acme')).toBe(tenant)
  })

  it('overwrites an existing entry', () => {
    setCachedTenant('acme', { slug: 'acme', v: 1 } as never)
    setCachedTenant('acme', { slug: 'acme', v: 2 } as never)
    expect(getCachedTenant('acme')).toEqual({ slug: 'acme', v: 2 })
  })

  it('clears a single tenant', () => {
    setCachedTenant('clear-me', { slug: 'clear-me' } as never)
    clearTenant('clear-me')
    expect(getCachedTenant('clear-me')).toBeUndefined()
  })
})

describe('layout cache (120s TTL, max 100)', () => {
  // Must run before other layoutCache inserts so eviction is deterministic.
  it('evicts the oldest layout past 100 entries', () => {
    for (let i = 0; i < 101; i++) {
      setCachedLayout(`lc-evict-${i}`, { id: i })
    }
    expect(getCachedLayout('lc-evict-0')).toBeUndefined()
    expect(getCachedLayout('lc-evict-100')).toEqual({ id: 100 })
  })

  it('returns undefined when nothing is cached', () => {
    expect(getCachedLayout('lc-missing')).toBeUndefined()
  })

  it('stores and retrieves a fresh layout', () => {
    setCachedLayout('lc-1', { title: 'My Layout' })
    expect(getCachedLayout('lc-1')).toEqual({ title: 'My Layout' })
  })

  it('returns the value while fresh, then undefined after the TTL expires', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    setCachedLayout('lc-ttl', { v: 1 })

    vi.advanceTimersByTime(119_999)
    expect(getCachedLayout('lc-ttl')).toEqual({ v: 1 })

    vi.advanceTimersByTime(2) // crosses 120_000
    expect(getCachedLayout('lc-ttl')).toBeUndefined()
  })

  it('deletes the expired entry so it does not resurrect', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    setCachedLayout('lc-ttl2', { v: 2 })
    vi.advanceTimersByTime(120_001)
    expect(getCachedLayout('lc-ttl2')).toBeUndefined()
    expect(getCachedLayout('lc-ttl2')).toBeUndefined()
  })

  it('clears a single layout', () => {
    setCachedLayout('lc-clear', { v: 1 })
    clearLayout('lc-clear')
    expect(getCachedLayout('lc-clear')).toBeUndefined()
  })
})

describe('design cache (300s TTL, max 200)', () => {
  // Must run before other designCache inserts so eviction is deterministic.
  it('evicts the oldest design past 200 entries', () => {
    for (let i = 0; i < 201; i++) {
      setCachedDesign(`dc-evict-${i}`, { colors: { primary: `#${i}` } } as never)
    }
    expect(getCachedDesign('dc-evict-0')).toBeUndefined()
    expect(getCachedDesign('dc-evict-200')).toEqual({ colors: { primary: '#200' } })
  })

  it('returns undefined when nothing is cached', () => {
    expect(getCachedDesign('dc-missing')).toBeUndefined()
  })

  it('stores and retrieves a fresh design', () => {
    const design = { colors: { primary: '#58a6ff' } }
    setCachedDesign('dc-1', design as never)
    expect(getCachedDesign('dc-1')).toBe(design)
  })

  it('expires after 300 seconds', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    setCachedDesign('dc-ttl', { colors: {} } as never)

    vi.advanceTimersByTime(299_999)
    expect(getCachedDesign('dc-ttl')).toEqual({ colors: {} })

    vi.advanceTimersByTime(2)
    expect(getCachedDesign('dc-ttl')).toBeUndefined()
  })

  it('clears a single design', () => {
    setCachedDesign('dc-clear', { colors: {} } as never)
    clearDesign('dc-clear')
    expect(getCachedDesign('dc-clear')).toBeUndefined()
  })
})
