import { describe, it, expect, vi } from 'vitest'
import { agentRouter } from '../src/routes/agent'

vi.mock('../src/index', () => ({ kv: { get: vi.fn(), put: vi.fn(), delete: vi.fn() } }))

describe('debug', () => {
  it('debug artifact publish', async () => {
    const env = {
      ARTIFACT_KV: { get: async () => null, put: async () => {}, delete: async () => {} },
      DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }), run: async () => ({}) }) }) },
      TENANT_KV: { get: async () => null, put: async () => {}, delete: async () => {} },
    }
    const res = await agentRouter.fetch(
      new Request('http://localhost/agent/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'artifact', id: 'test', type: 'calculator', layout: { type: 'page', children: [] } }),
      }),
      env,
    )
    const body = await res.text()
    console.log('Status:', res.status)
    console.log('Body:', body)
  })
  
  it('debug generate-layout', async () => {
    const env = {}
    const res = await agentRouter.fetch(
      new Request('http://localhost/agent/generate-layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout: { type: 'page', children: [{ type: 'heading', props: { text: 'Hello' } }] }, design: 'modern' }),
      }),
      env,
    )
    const body = await res.text()
    console.log('Gen Status:', res.status)
    console.log('Gen Body:', body)
  })
})
