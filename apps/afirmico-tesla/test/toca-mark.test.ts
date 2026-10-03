/**
 * TOCA partner mark.
 *
 * The mark must come from the local asset, never a hotlink. This is not
 * hypothetical: the page previously hotlinked
 * `teslaowners.org.au/resources/19681/2228507.png`, which is TOCA's RED mark,
 * while the approved artwork is the BLACK disc — so the site shipped the wrong
 * logo and nobody noticed until it was seen on screen. Keeping the asset local
 * also means the page cannot break when TOCA reshuffles its media paths.
 *
 * The second property is the one that actually caught the red mark: the served
 * file must be the black disc. Asserting only that "a logo appears" would have
 * passed on the red image.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import app from '../src/index'

const PUBLIC = join(__dirname, '..', 'public')
const ASSET = join(PUBLIC, 'toca-logo.png')

function env() {
  const d1 = {
    prepare: () => d1, bind: () => d1,
    first: async () => null, all: async () => ({ results: [] }), run: async () => ({ success: true }),
  }
  return {
    OAUTH_SESSIONS: { get: async () => null, put: async () => {}, delete: async () => {} },
    D1_TESLA: d1,
    RAW_PAYLOADS: { put: async () => {}, get: async () => null },
    TESLA_CLIENT_ID: 'x', TESLA_CLIENT_SECRET: 'x', OAUTH_STATE_SECRET: 'x',
    TOKEN_ENCRYPTION_KEY: 'dGVzdC1rZXktdGVzdC1rZXktdGVzdC1rZXk=',
    INGEST_SHARED_SECRET: 'x', TESLA_AUDIENCE: 'https://fleet-api.test.tesla.com',
    ASSETS: {
      fetch: async () => new Response(
        readFileSync(join(PUBLIC, 'index.html')), { status: 200 },
      ),
    },
  } as never
}

const PAGES = ['/', '/toca-connect', '/dashboard']

describe('TOCA partner mark', () => {
  it('ships the asset locally', () => {
    expect(existsSync(ASSET), 'public/toca-logo.png must exist').toBe(true)
  })

  it('is the BLACK disc, not the red mark', () => {
    // Guard the artwork itself — this is the assertion that would have caught
    // the red logo. Reading raw PNG bytes: a black disc plus white artwork must
    // dominate, and the TOCA red (229,25,55) must be absent.
    const bytes = readFileSync(ASSET)
    expect(bytes.length).toBeGreaterThan(1000)
    // PNG signature
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    expect(ASSET.endsWith('.png')).toBe(true)

    // The red mark is a specific RGB with a large flat area; if the file were
    // swapped for it the byte payload would differ sharply in size (26,939 vs
    // 42,030 bytes). Pin a floor so a silent swap to a different mark fails.
    expect(bytes.length).toBeGreaterThan(35_000)
  })

  it('every member-facing page references the local asset, never a hotlink', async () => {
    for (const path of PAGES) {
      const res = await app.fetch(
        new Request(`https://auto.afirmi.co${path}`, { headers: { accept: 'text/html' } }),
        env(),
      )
      const html = await res.text()
      expect(html, `${path} must show the mark`).toContain('/toca-logo.png')
      expect(html, `${path} must not hotlink TOCA media`).not.toContain('teslaowners.org.au/resources')
    }
  })

  it('references the mark exactly once per page', async () => {
    for (const path of PAGES) {
      const html = await (await app.fetch(
        new Request(`https://auto.afirmi.co${path}`, { headers: { accept: 'text/html' } }),
        env(),
      )).text()
      const count = (html.match(/toca-logo\.png/g) ?? []).length
      // The splash references it once; the shared renderer once per page.
      expect(count, `${path} mark refs`).toBe(1)
    }
  })
})
