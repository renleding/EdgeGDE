import { describe, it, expect, vi, afterEach } from 'vitest'
import { Hono } from 'hono'
import { securityHeaders } from '../../../src/middleware/security-headers'

function makeApp(routeHandler?: (c: any) => Response) {
  const app = new Hono()
  app.use('*', securityHeaders)
  app.get('/test', (c) => {
    if (routeHandler) return routeHandler(c)
    return c.text('ok')
  })
  return app
}

describe('securityHeaders middleware', () => {
  afterEach(() => vi.restoreAllMocks())

  it('sets CSP, HSTS, X-Content-Type-Options, and X-Frame-Options defaults', async () => {
    const app = makeApp()
    const res = await app.request('/test')
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'self'")
    expect(res.headers.get('Content-Security-Policy')).toContain("script-src 'self'")
    expect(res.headers.get('Content-Security-Policy')).toContain('frame-ancestors')
    expect(res.headers.get('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN')
  })

  it('does not override route-set CSP', async () => {
    const app = makeApp((c) => {
      c.header('Content-Security-Policy', "default-src 'none'")
      return c.text('ok')
    })
    const res = await app.request('/test')
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'")
    // Other headers still defaulted
    expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN')
  })

  it('does not override route-set HSTS', async () => {
    const app = makeApp((c) => {
      c.header('Strict-Transport-Security', 'max-age=0')
      return c.text('ok')
    })
    const res = await app.request('/test')
    expect(res.headers.get('Strict-Transport-Security')).toBe('max-age=0')
  })

  it('does not override route-set X-Content-Type-Options', async () => {
    const app = makeApp((c) => {
      c.header('X-Content-Type-Options', 'sniff-on')
      return c.text('ok')
    })
    const res = await app.request('/test')
    expect(res.headers.get('X-Content-Type-Options')).toBe('sniff-on')
  })

  it('does not override route-set X-Frame-Options', async () => {
    const app = makeApp((c) => {
      c.header('X-Frame-Options', 'DENY')
      return c.text('ok')
    })
    const res = await app.request('/test')
    expect(res.headers.get('X-Frame-Options')).toBe('DENY')
  })

  it('passes through the response body', async () => {
    const app = makeApp()
    const res = await app.request('/test')
    expect(await res.text()).toBe('ok')
  })
})
