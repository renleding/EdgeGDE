/**
 * EdgeGDE — Admin Pages Diagnostic Test
 * Quick check that Hono routing works for the admin routers
 */
import { Hono } from 'hono'
import { adminRouter } from '../src/api/admin-views'

async function main() {
  // Simplest possible Hono app
  const app = new Hono()
  app.route('/', adminRouter)
  
  const req = new Request('http://localhost/admin/kb?tenant=au-mortgage-broker-afirmico')
  
  // Add minimal middleware via app-level use
  const app2 = new Hono()
  app2.use('*', async (c, next) => {
    c.env = {
      TENANT_KV: {
        get: async () => null,
        put: async () => {},
        delete: async () => {},
      },
      DB: {
        prepare: () => ({
          bind: () => ({ all: async () => ({ results: [] }), first: async () => null, run: async () => ({}) }),
        }),
      },
      LEAD_SCORING_QUEUE: { send: async () => {} },
    } as any
    await next()
  })
  app2.route('/', adminRouter)

  try {
    const res = await app2.fetch(req)
    console.log('Status:', res.status)
    const text = await res.text()
    console.log('Body length:', text.length)
    console.log('First 500 chars:', text.substring(0, 500))
    console.log('Has Knowledge Base:', text.includes('Knowledge Base'))
    console.log('Has AFIRMICO Admin:', text.includes('AFIRMICO Admin'))
  } catch (err: any) {
    console.error('Error:', err.message)
    console.error(err.stack)
  }
}

main()