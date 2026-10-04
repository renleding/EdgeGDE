/**
 * Operator console (FRS-010 F09 groundwork).
 *
 * Not built upstream at the time of writing: the platform had member-facing
 * pages and JSON endpoints but no way for an operator to see who had connected,
 * what they had consented to, or whether telemetry was flowing. That is the gap
 * this closes. Read-only by design — every mutation path already exists on the
 * member side, and an admin surface that can silently revoke or release on a
 * member's behalf is a different, larger decision.
 *
 * Authentication
 * --------------
 * The shared secret is never rendered into a page and never placed in a URL.
 * The login form POSTs it and the server exchanges it for an opaque KV session
 * id, so the secret stays out of browser history and referrer headers. Machine
 * callers may present it directly as `x-admin-secret`.
 *
 * Reads only. There is no route here that writes.
 */
import { Hono } from 'hono'
import type { Context, Next } from 'hono'
import { timingSafeEqual } from './store'

export interface AdminEnv {
  OAUTH_SESSIONS: KVNamespace
  D1_TESLA: D1Database
  INGEST_SHARED_SECRET?: string
}

export const adminApp = new Hono<{ Bindings: AdminEnv }>()

const ADMIN_SESSION_COOKIE = 'afirmico_admin'
const ADMIN_SESSION_TTL = 60 * 60 * 8 // 8 hours

/** Inline SVG icon, matching the worker's own favicon definition. */
const FAVICON_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='#0b5ed7'/><text x='16' y='24' font-size='24' text-anchor='middle' fill='white' font-family='Arial' font-weight='bold'>A</text></svg>"

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function parseCookies(header: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 1) continue
    const name = part.slice(0, eq).trim()
    if (name) out[name] = part.slice(eq + 1).trim()
  }
  return out
}

async function isAuthenticated(c: Context<{ Bindings: AdminEnv }>): Promise<boolean> {
  const expected = c.env.INGEST_SHARED_SECRET
  if (!expected) return false

  const header = (c.req.header('x-admin-secret') ?? '').trim()
  if (header && timingSafeEqual(header, expected)) return true

  const sessionId = parseCookies(c.req.header('cookie'))[ADMIN_SESSION_COOKIE]
  if (!sessionId) return false
  return (await c.env.OAUTH_SESSIONS.get(`admin:${sessionId}`)) === 'ok'
}

function shell(title: string, body: string, nav = true): string {
  const navBar = nav
    ? `<div class="nav">
    <a href="/admin/overview">Overview</a>
    <a href="/admin/members">Members</a>
    <a href="/admin/vehicles">Vehicles</a>
    <a href="/admin/consent">Consent</a>
    <a href="/admin/audit">Audit</a>
    <a href="/admin/logout" class="right">Sign out</a>
  </div>`
    : ''
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<title>${escapeHtml(title)}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#090909;color:#fff;font-family:Arial,Helvetica,sans-serif;line-height:1.6}
  .wrap{max-width:1100px;margin:0 auto;padding:32px 24px}
  .logo{font-size:22px;font-weight:700;letter-spacing:1px;margin-bottom:4px}
  .logo span{color:#42ff8c}
  h1{font-size:32px;margin:24px 0 16px}
  h2{font-size:19px;margin:28px 0 10px;color:#d5d5d5}
  a{color:#8ab4ff}
  .nav{display:flex;gap:18px;flex-wrap:wrap;padding:12px 0;border-bottom:1px solid #222;margin-bottom:8px;font-size:15px}
  .nav a{text-decoration:none;color:#9ecbff}
  .nav a.right{margin-left:auto;color:#ff9a9a}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin:18px 0}
  .card{background:#151515;border-radius:12px;padding:16px}
  .card .num{font-size:30px;font-weight:700;color:#42ff8c}
  .card .lbl{color:#8a8a8a;font-size:13px;text-transform:uppercase;letter-spacing:.5px}
  table{width:100%;border-collapse:collapse;margin-top:12px;font-size:14px}
  th,td{text-align:left;padding:9px 10px;border-bottom:1px solid #1e1e1e;vertical-align:top}
  th{color:#8a8a8a;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.5px}
  tr:hover td{background:#121212}
  code,.mono{font-family:ui-monospace,Menlo,monospace;font-size:13px;background:#1d1d1d;padding:2px 6px;border-radius:4px}
  .pill{display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700}
  .pill.ok{background:#0f3d24;color:#42ff8c}
  .pill.warn{background:#3d330f;color:#f5c542}
  .pill.bad{background:#3d1414;color:#ff8080}
  .empty{color:#7a7a7a;padding:24px 0}
  form.login{background:#151515;border-radius:14px;padding:24px;max-width:400px;margin-top:24px}
  input[type=password]{width:100%;padding:12px;border-radius:8px;border:1px solid #333;background:#0d0d0d;color:#fff;font-size:15px;margin:8px 0 16px}
  button{padding:12px 20px;border:0;border-radius:8px;background:#0b5ed7;color:#fff;font-weight:700;font-size:15px;cursor:pointer;width:100%}
  .err{background:#1a0808;border-left:3px solid #ff5c5c;color:#ffb3b3;padding:12px;border-radius:8px;margin-bottom:16px}
  .meta{color:#8a8a8a;font-size:13px}
  footer{margin-top:40px;color:#666;font-size:13px;border-top:1px solid #1e1e1e;padding-top:16px}
</style>
</head>
<body>
<div class="wrap">
  <div class="logo">AFIRMICO Auto <span>Admin</span></div>
  ${navBar}
  ${body}
  <footer>Operator console · read-only · access is audited</footer>
</div>
</body>
</html>`
}

function loginPage(error: string | null): string {
  return shell('Admin — sign in', `
  <h1>Sign in</h1>
  ${error ? `<div class="err">${escapeHtml(error)}</div>` : ''}
  <form class="login" method="POST" action="/admin/login">
    <label for="secret">Operator secret</label>
    <input id="secret" name="secret" type="password" autocomplete="current-password" autofocus required>
    <button type="submit">Sign in</button>
  </form>
  <p class="meta" style="margin-top:16px">The secret is the ingest shared secret. It is exchanged for a short-lived
  browser session and is never stored in the page or the URL.</p>
  `, false)
}

/* -------------------------------------------------------------------------- */
/* Login / logout                                                             */
/* -------------------------------------------------------------------------- */

adminApp.get('/', async (c) => {
  if (!(await isAuthenticated(c))) return c.html(loginPage(null))
  return c.redirect('/admin/overview', 302)
})

adminApp.post('/login', async (c) => {
  const expected = c.env.INGEST_SHARED_SECRET
  if (!expected) return c.html(loginPage('Admin console is not configured.'), 503)

  const form = await c.req.parseBody()
  const secret = (typeof form.secret === 'string' ? form.secret : '').trim()
  if (!secret || !timingSafeEqual(secret, expected)) {
    return c.html(loginPage('That secret is not correct.'), 401)
  }

  const sessionId = crypto.randomUUID()
  await c.env.OAUTH_SESSIONS.put(`admin:${sessionId}`, 'ok', { expirationTtl: ADMIN_SESSION_TTL })

  return new Response(null, {
    status: 303,
    headers: {
      location: '/admin/overview',
      'set-cookie': `${ADMIN_SESSION_COOKIE}=${sessionId}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${ADMIN_SESSION_TTL}`,
      'cache-control': 'no-store',
    },
  })
})

adminApp.get('/logout', async (c) => {
  const sessionId = parseCookies(c.req.header('cookie'))[ADMIN_SESSION_COOKIE]
  if (sessionId) await c.env.OAUTH_SESSIONS.delete(`admin:${sessionId}`)
  return new Response(null, {
    status: 303,
    headers: {
      location: '/admin',
      'set-cookie': `${ADMIN_SESSION_COOKIE}=; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
      'cache-control': 'no-store',
    },
  })
})

/* -------------------------------------------------------------------------- */
/* Guard — declared after login so the form itself is reachable               */
/* -------------------------------------------------------------------------- */

adminApp.use('/*', async (c: Context<{ Bindings: AdminEnv }>, next: Next) => {
  if (!(await isAuthenticated(c))) {
    const wantsHtml = (c.req.header('accept') ?? '').includes('text/html')
    if (wantsHtml && c.req.method === 'GET') return c.html(loginPage('Sign in to continue.'), 401)
    return c.json({ error: 'unauthorized' }, 401)
  }
  return next()
})

/* -------------------------------------------------------------------------- */
/* HTML pages                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Renders the connections table showing per-member Tesla connections
 * with their vehicle details, virtual key pairing status, and consent history.
 * Supports filtering by status (active/inactive/all) and search.
 */
async function renderActiveConnections(
  db: D1Database,
  search?: string,
  status?: 'active' | 'inactive' | 'all'
): Promise<string> {
  const conditions: string[] = []
  const params: unknown[] = []

  // Search condition
  if (search) {
    const term = `%${search}%`
    conditions.push(
      `(m.member_id LIKE ? OR m.tesla_email LIKE ? OR v.vin LIKE ? OR v.display_name LIKE ? OR v.model LIKE ? OR vk.key_state LIKE ?)`
    )
    const termParam = `%${search}%`
    params.push(termParam, termParam, termParam, termParam, termParam, termParam)
  }

  // Status filter
  if (status === 'active') {
    conditions.push(`(c.revoked_at IS NULL)`)
  } else if (status === 'inactive') {
    conditions.push(`(c.revoked_at IS NOT NULL OR c.consent_id IS NULL)`)
  }
  // 'all' = no status filter

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''

  // Main query: member + vehicle + key + consent history
  // This returns one row per consent record, so a member with multiple consents
  // gets multiple rows (history)
  const connections = await db.prepare(
    `SELECT 
       m.member_id, m.tesla_email, m.created_at as member_since,
       v.vin, v.display_name, v.model, v.last_seen_at,
       vk.key_state, vk.paired_at,
       c.consent_id, c.policy_version, c.granted_at, c.revoked_at, c.revoke_reason,
       c.collected_fields, c.recipients, c.ip_hash, c.user_agent
     FROM tesla_member m
     LEFT JOIN tesla_vehicle v ON v.member_id = m.member_id
     LEFT JOIN tesla_vehicle_key vk ON vk.vin = v.vin
     LEFT JOIN tesla_consent c ON c.member_id = m.member_id
     ${whereClause}
     ORDER BY m.created_at DESC, c.granted_at DESC`
  ).bind(...params).all<Record<string, unknown>>()

  if (connections.results?.length === 0) {
    return '<div class="empty">No connections found.</div>'
  }

  // Group by member_id to show consent history per member
  const memberGroups = new Map<string, typeof connections.results>()
  for (const row of connections.results!) {
    const key = row.member_id as string
    if (!memberGroups.has(key)) memberGroups.set(key, [])
    memberGroups.get(key)!.push(row)
  }

  // Status filter UI
  const statusOptions = ['all', 'active', 'inactive']
  const statusLabels = { all: 'All', active: 'Active', inactive: 'Inactive' }
  const statusFilter = `
    <form method="GET" action="/admin/overview" style="margin-bottom:16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
      <input type="text" name="search" placeholder="Search member_id, email, VIN, vehicle, model, key state…"
             value="${escapeHtml(search ?? '')}"
             style="flex:1;min-width:280px;padding:10px 12px;border-radius:8px;border:1px solid #333;background:#0d0d0d;color:#fff;font-size:14px">
      <select name="status" style="padding:10px 12px;border-radius:8px;border:1px solid #333;background:#0d0d0d;color:#fff;font-size:14px">
        ${['all', 'active', 'inactive'].map(s => `<option value="${s}" ${status === s || (!status && s === 'all') ? 'selected' : ''}>${{all: 'All', active: 'Active', inactive: 'Inactive'}[s]}</option>`).join('')}
      </select>
      <button type="submit" style="padding:10px 18px;border:0;border-radius:8px;background:#0b5ed7;color:#fff;font-weight:700;font-size:14px;cursor:pointer">Filter</button>
      ${search || status ? `<a href="/admin/overview" style="padding:10px 18px;border:1px solid #444;border-radius:8px;color:#9ecbff;text-decoration:none;font-size:14px">Clear</a>` : ''}
    </form>
  `

  const memberHtml = Array.from(memberGroups.entries()).map(([memberId, rows]) => {
    const first = rows[0]
    const keyState = first.key_state ?? 'no vehicle'
    const stateClass = first.key_state === 'paired' ? 'ok' : first.key_state === 'fault' ? 'bad' : 'warn'
    
    // Build consent history table
    const consentRows = rows.filter(r => r.consent_id).map((r) => `
      <tr>
        <td class="meta">${escapeHtml(r.granted_at ?? '—')}</td>
        <td class="meta">${escapeHtml(r.revoked_at ?? 'active')}</td>
        <td>${escapeHtml(r.policy_version ?? '—')}</td>
        <td><span class="pill ${r.revoked_at ? 'bad' : 'ok'}">${r.revoked_at ? 'Revoked' : 'Active'}</span></td>
        <td class="meta">${escapeHtml(r.revoke_reason ?? '—')}</td>
        <td class="mono" style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.collected_fields ?? '—')}</td>
        <td class="mono" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.recipients ?? '—')}</td>
        <td class="meta">${escapeHtml(r.ip_hash ?? '—')}</td>
      </tr>
    `).join('')

    const hasConsentHistory = rows.some(r => r.consent_id)
    const consentTable = `
      <div style="margin-top:12px;padding:12px;background:#101010;border-radius:8px">
        <h4 style="margin:0 0 8px;color:#a52045">Consent History (${rows.filter(r=>r.consent_id).length} record(s))</h4>
        ${rows.some(r => r.consent_id) ? `
        <table style="font-size:12px">
          <thead>
            <tr>
              <th>Granted</th><th>Revoked</th><th>Policy</th><th>Status</th><th>Reason</th>
              <th>Collected Fields</th><th>Recipients</th><th>IP Hash</th>
            </tr>
          </thead>
          <tbody>
            ${rows.filter(r => r.consent_id).map((r) => `
              <tr>
                <td class="meta">${escapeHtml(r.granted_at ?? '—')}</td>
                <td class="meta">${escapeHtml(r.revoked_at ?? 'active')}</td>
                <td>${escapeHtml(r.policy_version ?? '—')}</td>
                <td><span class="pill ${r.revoked_at ? 'bad' : 'ok'}">${r.revoked_at ? 'Revoked' : 'Active'}</span></td>
                <td class="meta">${escapeHtml(r.revoke_reason ?? '—')}</td>
                <td class="mono" style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.collected_fields ?? '—')}</td>
                <td class="mono" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.recipients ?? '—')}</td>
                <td class="meta">${escapeHtml(r.ip_hash ?? '—')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ` : '<div class="meta" style="margin-top:12px">No consent records</div>'}
      </div>
    `


}).join('')

  const searchForm = `
    <form method="GET" action="/admin/overview" style="margin-bottom:16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
      <input type="text" name="search" placeholder="Search member_id, email, VIN, vehicle, model, key state..."
             value="${escapeHtml(search ?? '')}"
             style="flex:1;min-width:280px;padding:10px 12px;border-radius:8px;border:1px solid #333;background:#0d0d0d;color:#fff;font-size:14px">
      <select name="status" style="padding:10px 12px;border-radius:8px;border:1px solid #333;background:#0d0d0d;color:#fff;font-size:14px">
        <option value="all" ${status === 'all' || !status ? 'selected' : ''}>All</option>
        <option value="active" ${status === 'active' ? 'selected' : ''}>Active</option>
        <option value="inactive" ${status === 'inactive' ? 'selected' : ''}>Inactive</option>
      </select>
      <button type="submit" style="padding:10px 18px;border:0;border-radius:8px;background:#0b5ed7;color:#fff;font-weight:700;font-size:14px;cursor:pointer">Filter</button>
      ${search || status ? `<a href="/admin/overview" style="padding:10px 18px;border:1px solid #444;border-radius:8px;color:#9ecbff;text-decoration:none;font-size:14px">Clear</a>` : ''}
    </form>
  `;

  return `${searchForm}
  <div style="display:flex;flex-direction:column;gap:16px">
    ${memberHtml || '<div class="empty">No connections found.</div>'}
  </div>`;
}
/* -------------------------------------------------------------------------- */
/* HTML pages                                                                 */
/* -------------------------------------------------------------------------- */

adminApp.get('/overview', async (c) => {
  const dayStart = new Date().toISOString().slice(0, 10)
  const [members, vehicles, activeConsent, revokedConsent, batches, facts, signals] = await Promise.all([
    c.env.D1_TESLA.prepare('SELECT COUNT(*) AS n FROM tesla_member').first<{ n: number }>(),
    c.env.D1_TESLA.prepare('SELECT COUNT(*) AS n FROM tesla_vehicle').first<{ n: number }>(),
    c.env.D1_TESLA.prepare('SELECT COUNT(*) AS n FROM tesla_consent WHERE revoked_at IS NULL').first<{ n: number }>(),
    c.env.D1_TESLA.prepare('SELECT COUNT(*) AS n FROM tesla_consent WHERE revoked_at IS NOT NULL').first<{ n: number }>(),
    c.env.D1_TESLA.prepare('SELECT COUNT(*) AS n FROM tesla_telemetry_batch WHERE received_at >= ?').bind(dayStart).first<{ n: number }>(),
    c.env.D1_TESLA.prepare('SELECT COUNT(*) AS n FROM tesla_telemetry_fact WHERE observed_at >= ?').bind(dayStart).first<{ n: number }>(),
    c.env.D1_TESLA.prepare('SELECT COALESCE(SUM(signals),0) AS n FROM tesla_signal_counter WHERE period_start = ?').bind(dayStart).first<{ n: number }>(),
  ])

  const paired = await c.env.D1_TESLA.prepare(
    "SELECT COUNT(*) AS n FROM tesla_vehicle_key WHERE key_state = 'paired'",
  ).first<{ n: number }>()

  const cost = ((signals?.n ?? 0) / 150_000).toFixed(4)

  return c.html(shell('Admin — Overview', `
  <h1>Overview</h1>
  <div class="cards">
    <div class="card"><div class="num">${members?.n ?? 0}</div><div class="lbl">Members</div></div>
    <div class="card"><div class="num">${vehicles?.n ?? 0}</div><div class="lbl">Vehicles</div></div>
    <div class="card"><div class="num">${paired?.n ?? 0}</div><div class="lbl">Keys paired</div></div>
    <div class="card"><div class="num">${activeConsent?.n ?? 0}</div><div class="lbl">Active consent</div></div>
    <div class="card"><div class="num">${revokedConsent?.n ?? 0}</div><div class="lbl">Revoked</div></div>
  </div>

  <h2>Telemetry today (${escapeHtml(dayStart)})</h2>
  <div class="cards">
    <div class="card"><div class="num">${batches?.n ?? 0}</div><div class="lbl">Batches</div></div>
    <div class="card"><div class="num">${facts?.n ?? 0}</div><div class="lbl">Facts</div></div>
    <div class="card"><div class="num">${signals?.n ?? 0}</div><div class="lbl">Signals</div></div>
    <div class="card"><div class="num">$${cost}</div><div class="lbl">Est. cost</div></div>
  </div>

  <h2>Active Connections (per member)</h2>
  ${await renderActiveConnections(c.env.D1_TESLA, c.req.query('search'), c.req.query('status') as 'active' | 'inactive' | 'all' | undefined)}
  `))
})

adminApp.get('/members', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? '50'), 200)
  const offset = Number(c.req.query('offset') ?? '0')
  const rows = await c.env.D1_TESLA.prepare(
    `SELECT m.member_id, m.toca_status, m.email, m.display_name, m.tesla_email, m.created_at,
            (SELECT COUNT(*) FROM tesla_vehicle v WHERE v.member_id = m.member_id) AS vehicles,
            (SELECT COUNT(*) FROM tesla_consent c WHERE c.member_id = m.member_id AND c.revoked_at IS NULL) AS active_consent
       FROM tesla_member m ORDER BY m.created_at DESC LIMIT ? OFFSET ?`,
  ).bind(limit, offset).all<Record<string, unknown>>()

  return c.html(shell('Admin — Members', `
  <h1>Members <span class="meta">(${rows.results?.length ?? 0})</span></h1>
  ${(rows.results?.length ?? 0) === 0
    ? '<div class="empty">No members yet.</div>'
    : `<table>
      <thead><tr><th>Member</th><th>TOCA</th><th>Email</th><th>Vehicles</th><th>Consent</th><th>Joined</th></tr></thead>
      <tbody>
      ${rows.results!.map((m: Record<string, unknown>) => `<tr>
        <td><code>${escapeHtml(m.member_id)}</code><br><span class="meta">${escapeHtml(m.display_name ?? '')}</span></td>
        <td><span class="pill ${m.toca_status === 'verified_toca' ? 'ok' : 'warn'}">${escapeHtml(m.toca_status)}</span></td>
        <td>${escapeHtml(m.email ?? m.tesla_email ?? '—')}</td>
        <td>${escapeHtml(m.vehicles)}</td>
        <td>${Number(m.active_consent) > 0 ? '<span class="pill ok">active</span>' : '<span class="pill bad">none</span>'}</td>
        <td class="meta">${escapeHtml(m.created_at)}</td>
      </tr>`).join('')}
      </tbody></table>`}
  `))
})

adminApp.get('/vehicles', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? '50'), 200)
  const rows = await c.env.D1_TESLA.prepare(
    `SELECT v.vin, v.display_name, v.model, v.first_seen_at, v.last_seen_at,
            m.member_id, m.email,
            COALESCE(vk.key_state, 'unpaired') AS key_state, vk.paired_at
       FROM tesla_vehicle v
       JOIN tesla_member m ON m.member_id = v.member_id
       LEFT JOIN tesla_vehicle_key vk ON vk.vin = v.vin
       ORDER BY v.first_seen_at DESC LIMIT ?`,
  ).bind(limit).all<Record<string, unknown>>()

  return c.html(shell('Admin — Vehicles', `
  <h1>Vehicles <span class="meta">(${rows.results?.length ?? 0})</span></h1>
  ${(rows.results?.length ?? 0) === 0
    ? '<div class="empty">No vehicles yet.</div>'
    : `<table>
      <thead><tr><th>VIN</th><th>Vehicle</th><th>Member</th><th>Key</th><th>Last seen</th></tr></thead>
      <tbody>
      ${rows.results!.map((v: Record<string, unknown>) => `<tr>
        <td><code>${escapeHtml(v.vin)}</code></td>
        <td>${escapeHtml(v.display_name ?? '—')}<br><span class="meta">${escapeHtml(v.model ?? '')}</span></td>
        <td><code>${escapeHtml(v.member_id)}</code><br><span class="meta">${escapeHtml(v.email ?? '')}</span></td>
        <td><span class="pill ${v.key_state === 'paired' ? 'ok' : v.key_state === 'fault' ? 'bad' : 'warn'}">${escapeHtml(v.key_state)}</span></td>
        <td class="meta">${escapeHtml(v.last_seen_at ?? 'never')}</td>
      </tr>`).join('')}
      </tbody></table>`}
  `))
})

adminApp.get('/consent', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? '50'), 200)
  const rows = await c.env.D1_TESLA.prepare(
    `SELECT c.consent_id, c.member_id, c.policy_version, c.granted_at, c.revoked_at, c.revoke_reason,
            m.email
       FROM tesla_consent c
       JOIN tesla_member m ON m.member_id = c.member_id
       ORDER BY c.granted_at DESC LIMIT ?`,
  ).bind(limit).all<Record<string, unknown>>()

  return c.html(shell('Admin — Consent', `
  <h1>Consent <span class="meta">(${rows.results?.length ?? 0})</span></h1>
  ${(rows.results?.length ?? 0) === 0
    ? '<div class="empty">No consent records yet.</div>'
    : `<table>
      <thead><tr><th>Consent</th><th>Member</th><th>Policy</th><th>Status</th><th>Granted</th></tr></thead>
      <tbody>
      ${rows.results!.map((r: Record<string, unknown>) => `<tr>
        <td><code>${escapeHtml(r.consent_id)}</code></td>
        <td><code>${escapeHtml(r.member_id)}</code></td>
        <td class="mono">${escapeHtml(r.policy_version)}</td>
        <td>${r.revoked_at
          ? `<span class="pill bad">revoked</span><br><span class="meta">${escapeHtml(r.revoke_reason ?? '')}</span>`
          : '<span class="pill ok">active</span>'}</td>
        <td class="meta">${escapeHtml(r.granted_at)}</td>
      </tr>`).join('')}
      </tbody></table>`}
  `))
})

adminApp.get('/audit', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? '50'), 200)
  const rows = await c.env.D1_TESLA.prepare(
    `SELECT event_id, occurred_at, actor, actor_type, action, subject_type, subject_id
       FROM tesla_audit_event ORDER BY occurred_at DESC LIMIT ?`,
  ).bind(limit).all<Record<string, unknown>>()

  return c.html(shell('Admin — Audit', `
  <h1>Audit log <span class="meta">(${rows.results?.length ?? 0})</span></h1>
  ${(rows.results?.length ?? 0) === 0
    ? '<div class="empty">No audit events yet.</div>'
    : `<table>
      <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Subject</th></tr></thead>
      <tbody>
      ${rows.results!.map((e: Record<string, unknown>) => `<tr>
        <td class="meta">${escapeHtml(e.occurred_at)}</td>
        <td>${escapeHtml(e.actor ?? '—')}<br><span class="meta">${escapeHtml(e.actor_type ?? '')}</span></td>
        <td><code>${escapeHtml(e.action)}</code></td>
        <td>${escapeHtml(e.subject_type ?? '')}<br><span class="meta">${escapeHtml(e.subject_id ?? '')}</span></td>
      </tr>`).join('')}
      </tbody></table>`}
  `))
})

/* -------------------------------------------------------------------------- */
/* JSON API (header-authenticated, for tooling)                               */
/* -------------------------------------------------------------------------- */

adminApp.get('/api/members', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? '50'), 200)
  const offset = Number(c.req.query('offset') ?? '0')
  const rows = await c.env.D1_TESLA.prepare(
    `SELECT member_id, toca_status, email, display_name, tesla_email, created_at, updated_at
       FROM tesla_member ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  ).bind(limit, offset).all()
  return c.json({ members: rows.results ?? [], limit, offset })
})

adminApp.get('/api/telemetry/health', async (c) => {
  const dayStart = new Date().toISOString().slice(0, 10)
  const [batches, facts, signals, config, vehicles] = await Promise.all([
    c.env.D1_TESLA.prepare(
      `SELECT COUNT(*) as total, SUM(CASE WHEN processed_at IS NULL THEN 1 ELSE 0 END) as unprocessed,
              MAX(received_at) as last_received FROM tesla_telemetry_batch WHERE received_at >= ?`,
    ).bind(dayStart).first(),
    c.env.D1_TESLA.prepare('SELECT COUNT(*) as total FROM tesla_telemetry_fact WHERE observed_at >= ?').bind(dayStart).first(),
    c.env.D1_TESLA.prepare('SELECT SUM(signals) as signals, SUM(data_requests) as requests, SUM(wakes) as wakes FROM tesla_signal_counter WHERE period_start = ?').bind(dayStart).first(),
    c.env.D1_TESLA.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN state = 'active' THEN 1 ELSE 0 END) as active FROM tesla_telemetry_config").first(),
    c.env.D1_TESLA.prepare('SELECT COUNT(*) as total FROM tesla_vehicle').first(),
  ])
  return c.json({
    date: dayStart,
    batches: batches ?? { total: 0, unprocessed: 0, last_received: null },
    facts: facts ?? { total: 0 },
    signals: signals ?? { signals: 0, requests: 0, wakes: 0 },
    config: config ?? { total: 0, active: 0 },
    vehicles: vehicles ?? { total: 0 },
  })
})

/** The icon is served by the worker at /favicon.svg; this is only a fallback. */
adminApp.get('/favicon.svg', (c) =>
  c.body(FAVICON_SVG, 200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=3600' }),
)

export default adminApp
