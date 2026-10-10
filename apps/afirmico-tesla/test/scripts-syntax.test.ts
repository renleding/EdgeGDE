import { describe, it, expect, beforeEach } from 'vitest'
import app from '../src/index'
import { createSqliteD1, assertRejectsInvalidSql } from './helpers/sqlite-d1'

const SECRET = 'test-admin-secret'

function makeEnv() {
  const kv = new Map<string, string>()
  const d1 = createSqliteD1()
  assertRejectsInvalidSql(d1)
  return {
    OAUTH_SESSIONS: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => { kv.set(k, v) },
      delete: async (k: string) => { kv.delete(k) },
    },
    D1_TESLA: d1,
    RAW_PAYLOADS: { put: async () => {}, get: async () => null },
    TESLA_CLIENT_ID: 'test-client-id',
    TESLA_CLIENT_SECRET: 'test-client-secret',
    TESLA_AUDIENCE: 'https://fleet-api.prd.na.vn.cloud.tesla.com',
    TESLA_BILLING_LIMIT_USD: '100',
    INGEST_SHARED_SECRET: SECRET,
  }
}

async function login(env: ReturnType<typeof makeEnv>): Promise<string> {
  const res = await app.fetch(
    new Request('https://auto.afirmi.co/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `secret=${SECRET}`,
    }),
    env,
  )
  expect(res.status).toBe(303)
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]
  expect(cookie).toContain('afirmico_admin=')
  return cookie
}

const ADMIN_ROUTES = [
  '/admin/overview',
  '/admin/telemetry/configurator?scope=global',
  '/admin/exports',
  '/admin/members',
  '/admin/vehicles',
  '/admin/telemetry',
  '/admin/consent',
  '/admin/audit',
]

async function checkScriptSyntax(content: string): Promise<{ success: boolean; error?: string }> {
  const fs = await import('fs/promises')
  const path = await import('path')
  const os = await import('os')
  const { spawn } = await import('child_process')

  const tempFile = path.join(os.tmpdir(), `script-check-${Date.now()}-${Math.random().toString(36).slice(2)}.js`)

  try {
    await fs.writeFile(tempFile, content)
    return await runNodeCheck(tempFile)
  } finally {
    try {
      await fs.unlink(tempFile)
    } catch {
      // ignore cleanup errors
    }
  }
}

async function runNodeCheck(filePath: string): Promise<{ success: boolean; error?: string }> {
  const { spawn } = await import('child_process')

  return new Promise((resolve) => {
    const proc = spawn('node', ['--check', filePath], {
      timeout: 5000,
    })

    let stderr = ''
    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true })
      } else {
        resolve({ success: false, error: stderr })
      }
    })

    proc.on('error', (err) => {
      resolve({ success: false, error: err.message })
    })
  })
}

describe('Admin inline script syntax validation (F15-R06)', () => {
  let env: ReturnType<typeof makeEnv>
  let sessionCookie: string

  beforeEach(async () => {
    env = makeEnv()
    sessionCookie = await login(env)
  })

  for (const route of ADMIN_ROUTES) {
    it(`renders ${route} without syntax errors in inline scripts`, async () => {
      const res = await app.fetch(
        new Request(`http://localhost${route}`, {
          headers: { Cookie: sessionCookie },
        }),
        env,
      )
      expect(res.status).toBe(200)

      const html = await res.text()

      // Extract all inline <script> blocks (not <script src=...>)
      const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi
      let match
      const scripts: Array<{ content: string; index: number }> = []
      let index = 0

      while ((match = scriptRegex.exec(html)) !== null) {
        const scriptContent = match[1].trim()
        if (scriptContent.length > 0) {
          scripts.push({ content: scriptContent, index: index++ })
        }
      }

      // Syntax-check each script with node --check
      for (const script of scripts) {
        const result = await checkScriptSyntax(script.content)
        if (!result.success) {
          console.error(`\n=== SYNTAX ERROR in ${route}, script #${script.index} ===`)
          console.error(script.content)
          console.error(`Error: ${result.error}`)
          console.error('=== END SCRIPT ===\n')
        }
        expect(result.success, `Inline script #${script.index} in ${route} has syntax error: ${result.error}`).toBe(true)
      }

      // Every admin page should have at least some inline script
      if (scripts.length === 0) {
        console.warn(`No inline scripts found in ${route}`)
      }
    })
  }
})