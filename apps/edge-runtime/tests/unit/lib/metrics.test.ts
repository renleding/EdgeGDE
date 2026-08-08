import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import {
  incrementRequest,
  flushMetrics,
  getMetrics,
  getEdgeMetrics,
} from '../../../src/lib/metrics'

type Kv = {
  get: (k: string, t: 'json') => Promise<any>
  put: (k: string, v: string) => Promise<void>
}

function stubKv(overrides: Partial<Kv> = {}): Kv & { puts: Array<{ k: string; v: string }>; gets: string[] } {
  const puts: Array<{ k: string; v: string }> = []
  const gets: string[] = []
  return {
    puts,
    gets,
    get: async (k: string) => {
      gets.push(k)
      return null
    },
    put: async (k: string, v: string) => {
      puts.push({ k, v })
    },
    ...overrides,
  }
}

// The module installs a real setInterval for periodic flushing — stub it so
// vitest doesn't hang on an open timer. Invoking the callback immediately also
// exercises the scheduler's flushAll body (which early-returns on empty
// pending), and the truthy flushTimer covers the ensureFlushScheduler guard.
beforeAll(() => {
  vi.spyOn(globalThis, 'setInterval').mockImplementation(((
    cb: () => void,
  ) => {
    cb()
    return 123
  }) as unknown as typeof setInterval)
})

afterAll(() => {
  vi.restoreAllMocks()
})

// Pending metrics are module-level state — drain after every test.
afterEach(async () => {
  await flushMetrics(stubKv())
})

describe('incrementRequest', () => {
  it('accumulates a request and records lastSeen', async () => {
    const kv = stubKv()
    await incrementRequest(kv, 'acme', 'default', false)
    await flushMetrics(kv)

    expect(kv.puts).toHaveLength(1)
    expect(kv.puts[0].k).toBe('metrics:acme:default')
    const payload = JSON.parse(kv.puts[0].v)
    expect(payload.requests).toBe(1)
    expect(payload.errors).toBe(0)
    expect(payload.lastSeen).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('increments the error counter when isError is true', async () => {
    const kv = stubKv()
    await incrementRequest(kv, 'acme', 'default', true)
    await incrementRequest(kv, 'acme', 'default', true)
    await flushMetrics(kv)

    const payload = JSON.parse(kv.puts[0].v)
    expect(payload.requests).toBe(2)
    expect(payload.errors).toBe(2)
  })

  it('keeps separate accumulators per tenant/tool', async () => {
    const kv = stubKv()
    await incrementRequest(kv, 'acme', 'default', false)
    await incrementRequest(kv, 'beta', 'gallery', true)
    await flushMetrics(kv)

    expect(kv.puts).toHaveLength(2)
    const byKey = Object.fromEntries(kv.puts.map(p => [p.k, JSON.parse(p.v)]))
    expect(byKey['metrics:acme:default'].requests).toBe(1)
    expect(byKey['metrics:beta:gallery'].errors).toBe(1)
  })

  it('merges flushed counters with existing KV state', async () => {
    const kv = stubKv({
      get: async (k: string) => (k === 'metrics:acme:default' ? { requests: 5, errors: 1, lastSeen: 'old' } : null),
    })
    await incrementRequest(kv, 'acme', 'default', true)
    await flushMetrics(kv)

    const payload = JSON.parse(kv.puts[0].v)
    expect(payload.requests).toBe(6)
    expect(payload.errors).toBe(2)
    expect(payload.lastSeen).not.toBe('old')
  })

  it('installs the flush scheduler only once', async () => {
    const kv = stubKv()
    await incrementRequest(kv, 'acme', 'default', false)
    await incrementRequest(kv, 'acme', 'default', false)
    expect(globalThis.setInterval).toHaveBeenCalledTimes(1)
    await flushMetrics(kv)
  })
})

describe('flushMetrics', () => {
  it('is a no-op when nothing is pending', async () => {
    const kv = stubKv()
    await flushMetrics(kv)
    expect(kv.gets).toHaveLength(0)
    expect(kv.puts).toHaveLength(0)
  })

  it('survives kv.get failures (non-blocking)', async () => {
    const kv = stubKv({
      get: async () => {
        throw new Error('kv down')
      },
    })
    await incrementRequest(kv, 'acme', 'default', false)
    await expect(flushMetrics(kv)).resolves.toBeUndefined()
    expect(kv.puts).toHaveLength(0)
  })

  it('survives kv.put failures (non-blocking)', async () => {
    const kv = stubKv({
      put: async () => {
        throw new Error('put down')
      },
    })
    await incrementRequest(kv, 'acme', 'default', false)
    await expect(flushMetrics(kv)).resolves.toBeUndefined()
  })

  it('clears pending after a successful flush', async () => {
    const kv = stubKv()
    await incrementRequest(kv, 'acme', 'default', false)
    await flushMetrics(kv)
    expect(kv.puts).toHaveLength(1)

    await flushMetrics(kv)
    expect(kv.puts).toHaveLength(1) // no second write — pending was drained
  })
})

describe('getMetrics — tenant + tool fast path', () => {
  it('returns an empty array when the key is missing', async () => {
    const kv = stubKv()
    await expect(getMetrics(kv, 'acme', 'default')).resolves.toEqual([])
  })

  it('returns a snapshot when data exists', async () => {
    const kv = stubKv({
      get: async () => ({ requests: 3, errors: 1, lastSeen: '2026-08-09T00:00:00.000Z' }),
    })
    await expect(getMetrics(kv, 'acme', 'default')).resolves.toEqual([
      { tenant: 'acme', tool: 'default', requests: 3, errors: 1, lastSeen: '2026-08-09T00:00:00.000Z' },
    ])
  })

  it('applies defaults for incomplete stored data', async () => {
    const kv = stubKv({
      get: async () => ({}),
    })
    await expect(getMetrics(kv, 'acme', 'default')).resolves.toEqual([
      { tenant: 'acme', tool: 'default', requests: 0, errors: 0, lastSeen: '' },
    ])
  })

  it('propagates kv.get errors in the fast path (no try/catch there)', async () => {
    const kv = stubKv({
      get: async () => {
        throw new Error('kv down')
      },
    })
    await expect(getMetrics(kv, 'acme', 'default')).rejects.toThrow('kv down')
  })
})

describe('getMetrics — known-tenant enumeration', () => {
  it('returns [] when no known tenant has data', async () => {
    const kv = stubKv()
    await expect(getMetrics(kv)).resolves.toEqual([])
  })

  it('collects snapshots for known tenant/tool combos', async () => {
    const kv = stubKv({
      get: async (k: string) => {
        if (k === 'metrics:au-mortgage-broker-afirmico:default') return { requests: 7, errors: 2, lastSeen: 'now' }
        return null
      },
    })
    await expect(getMetrics(kv)).resolves.toEqual([
      { tenant: 'au-mortgage-broker-afirmico', tool: 'default', requests: 7, errors: 2, lastSeen: 'now' },
    ])
  })

  it('applies defaults for incomplete data in the enumeration path', async () => {
    const kv = stubKv({
      get: async (k: string) => (k === 'metrics:au-mortgage-broker-afirmico:default' ? { errors: 3 } : null),
    })
    const r = await getMetrics(kv)
    expect(r).toEqual([
      { tenant: 'au-mortgage-broker-afirmico', tool: 'default', requests: 0, errors: 3, lastSeen: '' },
    ])
  })

  it('sorts results by requests descending', async () => {
    const kv = stubKv({
      get: async (k: string) => {
        if (k.endsWith(':default')) return { requests: 10, errors: 0, lastSeen: '' }
        if (k.endsWith(':gallery')) return { requests: 99, errors: 1, lastSeen: '' }
        return null
      },
    })
    const r = await getMetrics(kv)
    expect(r[0].requests).toBe(99)
    expect(r[0].tool).toBe('gallery')
    expect(r[1].requests).toBe(10)
    expect(r[1].tool).toBe('default')
  })

  it('skips combos whose kv.get throws', async () => {
    const kv = stubKv({
      get: async (k: string) => {
        if (k === 'metrics:au-mortgage-broker-afirmico:default') throw new Error('missing')
        if (k.endsWith(':budget')) return { requests: 1, errors: 0, lastSeen: '' }
        return null
      },
    })
    const r = await getMetrics(kv)
    expect(r).toHaveLength(1)
    expect(r[0].tool).toBe('budget')
  })

  it('ignores the tenant argument when tool is omitted (falls through to enumeration)', async () => {
    const kv = stubKv({
      get: async (k: string) => {
        if (k === 'metrics:au-mortgage-broker-afirmico:default') return { requests: 2, errors: 0, lastSeen: '' }
        return null
      },
    })
    // Actual behavior: the tenant-only path still enumerates the hardcoded
    // known tenants rather than filtering by the requested tenant.
    const r = await getMetrics(kv, 'some-other-tenant')
    expect(r).toEqual([
      { tenant: 'au-mortgage-broker-afirmico', tool: 'default', requests: 2, errors: 0, lastSeen: '' },
    ])
  })
})

describe('getEdgeMetrics', () => {
  it('delegates to getMetrics with the tenant KV', async () => {
    const kv = stubKv()
    await expect(getEdgeMetrics({}, {}, {}, kv)).resolves.toEqual([])
  })

  it('returns the same snapshots as getMetrics', async () => {
    const kv = stubKv({
      get: async (k: string) => (k === 'metrics:au-mortgage-broker-afirmico:metrics' ? { requests: 4, errors: 0, lastSeen: 'x' } : null),
    })
    await expect(getEdgeMetrics({}, {}, {}, kv)).resolves.toEqual([
      { tenant: 'au-mortgage-broker-afirmico', tool: 'metrics', requests: 4, errors: 0, lastSeen: 'x' },
    ])
  })
})
