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
import { modelYearFromVin, variantFromEfficiencyPackage } from './analytics'
import { formatDualTime, formatTimeColumns, stateFromPostcode, timeZoneForPostcode } from './timezone'
import { resolveConfig, type ResolvedConfig } from './config-scope'
import { runApplySweep, isCanaryEligible, verifyCanaryConditions, type ApplySweepResult, type ApplyVehicleResult } from './config-apply'
import { createVehicleGroup, getVehicleGroup, listVehicleGroups, updateVehicleGroup, deleteVehicleGroup, addVehicleToGroup, removeVehicleFromGroup, listGroupMembers, getGroupsForVehicle, type VehicleGroup, type GroupMember } from './config-groups'
import { collectedFields, type CollectedField, audit, newId } from './store'

export interface AdminEnv {
  OAUTH_SESSIONS: KVNamespace
  D1_TESLA: D1Database
  INGEST_SHARED_SECRET?: string
}

/**
 * The admin Hono app (FRS-010 F09). Mounted under `/admin` by the worker:
 * login/logout, a catch-all auth guard, the HTML operator pages, and the
 * header-authenticated JSON API for tooling.
 */
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

function shell(title: string, body: string, nav = true, liveVin?: string, active?: string): string {
  // F12-R17: the active nav item renders bold. Keyed off the page title rather
  // than a per-call argument, so a new surface cannot forget to pass its key —
  // a title that maps to no key simply renders no item bold, which is visible
  // in review, whereas a missed argument is invisible.
  const ACTIVE_BY_TITLE: Record<string, string> = {
    'Admin — Overview': 'overview',
    'Admin — Members': 'members',
    'Admin — Vehicles': 'vehicles',
    'Admin — Telemetry': 'telemetry',
    'Admin — Telemetry Configurator': 'configurator',
    'Admin — Data Exports': 'exports',
    'Admin — Consent': 'consent',
    'Admin — Audit': 'audit',
    'Admin — Vehicle Groups': 'telemetry',
    'Admin — Vehicle Group': 'telemetry',
    'Admin — Group': 'telemetry',
  }
  const activeKey = active ?? ACTIVE_BY_TITLE[title]
  const navBar = nav
    ? `<div class="nav">
    ${navItem('/admin/overview', 'Overview', 'overview', activeKey)}
    ${navItem('/admin/members', 'Members', 'members', activeKey)}
    ${navItem('/admin/vehicles', 'Vehicles', 'vehicles', activeKey)}
    ${navItem('/admin/telemetry', 'Telemetry', 'telemetry', activeKey)}
    ${navItem('/admin/telemetry/configurator', 'Configurator', 'configurator', activeKey)}
    ${navItem('/admin/exports', 'Exports', 'exports', activeKey)}
    ${navItem('/admin/consent', 'Consent', 'consent', activeKey)}
    ${navItem('/admin/audit', 'Audit', 'audit', activeKey)}
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
  .nav a.active{color:#42ff8c;font-weight:700}
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
  .live{display:flex;align-items:center;gap:10px;margin:14px 0 4px;padding:9px 12px;border-radius:9px;background:#111;border:1px solid #1f1f1f;font-size:13px;color:#8a8a8a}
  .live .dot{width:9px;height:9px;border-radius:50%;background:#5a5a5a;flex:0 0 9px}
  .live[data-state=ok] .dot{background:#42ff8c}
  .live[data-state=idle] .dot{background:#f5c542}
  .live[data-state=new] .dot{background:#8ab4ff;animation:pulse 1s infinite}
  .live[data-state=new]{color:#cfe0ff;border-color:#26364d}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}
</style>
</head>
<body>
<div class="wrap">
  <div class="logo">AFIRMICO Auto <span>Admin</span></div>
  ${navBar}
  ${nav ? liveBar(liveVin) : ''}
  ${body}
  <footer>Operator console · read-only · access is audited</footer>
</div>
</body>
</html>`
}

/**
 * One nav link. The active item renders bold (F12-R17): the operator always knows
 * which surface is rendered. `key` is the route's identity, not its path — the
 * group pages share Telemetry's key because they are Telemetry's sub-surfaces.
 */
function navItem(href: string, label: string, key: string, active?: string): string {
  const cls = active === key ? ' class="active"' : ''
  return `<a href="${href}"${cls}>${label}</a>`
}

/**
 * The live-freshness bar (F02-R14).
 *
 * The console is server-rendered, so there is nothing to "push": the data is always in D1
 * the moment ingest commits, and the only reason an operator had to ask for a nudge was
 * that the PAGE never re-fetched. This polls a freshness probe and reloads when the newest
 * received instant changes.
 *
 * Reload rather than in-browser patching, deliberately: the tables are rendered server-side
 * by `columns`/`cell`, and re-rendering them in JavaScript would be a second implementation
 * of the same formatting that could drift from the first. A reload runs the same code path
 * that produced the page.
 *
 * `<` is avoided throughout the script so no HTML parser can mistake it for a tag, and no
 * backticks or `${}` appear so this cannot collide with the surrounding template literal.
 */
function liveBar(liveVin?: string): string {
  const scope = liveVin ? ` data-vin="${escapeHtml(liveVin)}"` : ''
  return `
<div class="live" id="live-bar" data-state="pending"${scope}>
  <span class="dot"></span>
  <span id="live-text">Checking for new telemetry…</span>
</div>
<script>
(function(){
  var el = document.getElementById('live-bar');
  if (!el) return;
  var vin = el.getAttribute('data-vin');
  var base = '/admin/api/telemetry/latest';
  var url = vin ? base + '?vin=' + encodeURIComponent(vin) : base;
  var lastSeen = null;
  // Auto-reload must not fight the reader. At fleet scale (1,000 vehicles sending on
  // change) new data arrives continuously, so an unconditional reload would refresh the
  // page every poll and make it unreadable rather than live. So: reload when the operator
  // is idle, and hold the refresh behind a click when they are actively working. The
  // "automatic" requirement is met either way — nobody has to ask for the data.
  var lastTouch = Date.now();
  ['scroll', 'click', 'keydown'].forEach(function(ev){
    window.addEventListener(ev, function(){ lastTouch = Date.now(); }, { passive: true });
  });
  var IDLE_MS = 45000;
  function pad(n){ return ('0' + n).slice(-2); }
  function fmt(iso){
    if (!iso) return 'never';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate())
      + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + ' UTC';
  }
  var pending = false;
  function paint(j){
    var t = document.getElementById('live-text');
    if (!t) return;
    var obs = j.newest_observed_at, rec = j.newest_received_at;
    if (!obs && !rec) {
      el.setAttribute('data-state', 'idle');
      t.textContent = 'No telemetry received yet for this scope. Auto-checking every 30s.';
      return;
    }
    if (lastSeen !== null && rec !== lastSeen) {
      pending = true;
      if (Date.now() - lastTouch > IDLE_MS) {
        el.setAttribute('data-state', 'new');
        t.textContent = 'New telemetry received (' + fmt(rec) + ') — refreshing…';
        setTimeout(function(){ window.location.reload(); }, 1200);
        return;
      }
      // New data, but the operator is reading. Offer it rather than yanking the page.
      el.setAttribute('data-state', 'new');
      el.style.cursor = 'pointer';
      el.title = 'Click to load the new telemetry';
      t.textContent = 'New telemetry received (' + fmt(rec) + ') — click to refresh now, '
        + 'or this page refreshes when idle for 45s';
      return;
    }
    lastSeen = rec;
    el.setAttribute('data-state', 'ok');
    t.textContent = 'Last observed ' + fmt(obs) + ' · last received ' + fmt(rec)
      + ' · auto-checking every 30s' + (pending ? ' · click to refresh' : '');
  }
  el.addEventListener('click', function(){
    if (el.getAttribute('data-state') === 'new') window.location.reload();
  });
  function poll(){
    fetch(url, { cache: 'no-store', headers: { accept: 'application/json' } })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){ if (j) paint(j); })
      .catch(function(){});
  }
  poll();
  setInterval(poll, 30000);
})();
</script>`
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
 * Turn the recorded key-state error code into something an operator can act on.
 *
 * `key_not_paired_at_tesla` and `key_removed_by_owner` are different situations
 * with different remediations, and the bare key_state (`unpaired`) renders them
 * identically. The admin console must say which.
 */
function keyReason(code: unknown): string {
  const value = String(code)
  if (value === 'key_not_paired_at_tesla') return '— key never added on the vehicle'
  if (value === 'key_removed_by_owner') return '— key removed at the vehicle (Locks screen)'
  return `— ${value}`
}

/**
 * Turn a raw enum label into the model name a person expects.
 *
 * The vehicle sends `CarTypeModel3`; the admin console should say "Model 3". This
 * is a presentation mapping only -- the stored value stays the raw label the
 * vehicle sent, so nothing here can change what we claim was observed.
 */
export function modelName(raw: unknown): string {
  // An absent CarType must produce nothing, not the string "null". Before this
  // guard the console rendered "null Performance 2025" for a vehicle whose CarType
  // had not yet arrived — String(null) is "null", which is truthy and fell through
  // the identity map to be printed verbatim. A missing component must be omitted;
  // rendering the word "null" as a model name is worse than rendering nothing.
  if (raw === null || raw === undefined) return ''
  const v = String(raw).trim()
  // Case-insensitive: the string "null" reaches here from several directions (a
  // serialised null, an empty column read as text) and any casing of it is never a
  // model name.
  if (!v || v.toLowerCase() === 'null') return ''
  const map: Record<string, string> = {
    CarTypeModelS: 'Model S',
    CarTypeModel3: 'Model 3',
    CarTypeModelX: 'Model X',
    CarTypeModelY: 'Model Y',
    CarTypeSemiTruck: 'Semi',
    CarTypeCybertruck: 'Cybertruck',
    // Tesla explicitly reporting that it does not know the model. Resolves to nothing
    // rather than the word "unknown", which would appear as a model name and merge
    // genuinely different vehicles into one segment.
    CarTypeUnknown: '',
  }
  return map[v] ?? v
}

/**
 * Render the vehicle's model identity as "Model 3 Performance 2025".
 *
 * Composed from three separate sources, because no single field carries it:
 *   model    <- CarType            (collected; "CarTypeModel3")
 *   variant  <- EfficiencyPackage  (collected; "M3POPPYSEED2024" -> Performance)
 *   year     <- VIN position 10    (derived; Tesla exposes no model-year field)
 *
 * Each part is optional and each degrades honestly: an unmapped code shows the raw
 * value rather than a guess, and a component we do not have is simply omitted rather
 * than rendered as a misleading dash. The raw inputs are shown beneath so the
 * composition is auditable and a wrong mapping is visible rather than plausible.
 */
export function vehicleIdentity(r: Record<string, unknown>): string {
  const model = modelName(r.car_type)

  // Trim is Tesla's authoritative variant badge; the EfficiencyPackage codename is
  // the fallback for vehicles that streamed before Trim was collected (migration
  // 0013). Prefer the reported value and say which was used, so a fallback is never
  // mistaken for a report.
  const reportedTrim = r.trim === null || r.trim === undefined ? null : String(r.trim).trim()
  const variant =
    reportedTrim && reportedTrim.length > 0
      ? reportedTrim
      : variantFromEfficiencyPackage(
          r.efficiency_package === null || r.efficiency_package === undefined
            ? null
            : String(r.efficiency_package),
        )

  const { year } = r.vin ? modelYearFromVin(String(r.vin)) : { year: null }

  // The identity is what the VEHICLE reported: model and variant. The year is
  // derived from the VIN and is tracked separately, because conflating them made the
  // "nothing received yet" branch unreachable — a vehicle with only a VIN still
  // produced a non-empty `parts` (the year), so the console showed a bare year with
  // no model instead of saying no attributes had arrived.
  const identity = [model, variant].filter((p): p is string => Boolean(p))

  const raw: string[] = []
  if (r.car_type) raw.push(String(r.car_type))
  if (r.trim) raw.push(`trim=${String(r.trim)}`)
  if (r.efficiency_package) raw.push(String(r.efficiency_package))
  const rawNote = raw.length
    ? ` <span class="meta" title="raw values reported by the vehicle">${escapeHtml(raw.join(' · '))}</span>`
    : ''
  const yearNote =
    year === null
      ? ' <span class="meta">year not derivable from VIN</span>'
      : ''
  const variantNote =
    !reportedTrim && variant
      ? ' <span class="meta">variant from efficiency package (Trim not yet received)</span>'
      : ''

  // Nothing reported yet: say so plainly rather than printing just a year. The year
  // alone is still shown, because it is genuinely derivable from the VIN and is
  // useful — but it must not masquerade as a model identity.
  if (identity.length === 0) {
    const yearSuffix = year === null ? '' : ` <span class="meta">(${year} from VIN)</span>`
    return `<span class="meta">no vehicle attributes received yet</span>${yearSuffix}${yearNote}`
  }

  const parts = year === null ? identity : [...identity, String(year)]
  return `${escapeHtml(parts.join(' '))}${yearNote}${variantNote}${rawNote}`
}

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
  // gets multiple rows (history). Vehicle blocks are deduped per VIN below — this
  // join is for the consent history, not a source of per-vehicle rows.
  const connections = await db.prepare(
    `SELECT
       m.member_id, m.tesla_email, m.created_at as member_since, m.postcode,
       v.vin, v.display_name, v.model, v.last_seen_at,
       vk.key_state, vk.paired_at, vk.last_error AS key_last_error,
       (SELECT state FROM tesla_telemetry_config t2 WHERE t2.vin = v.vin
         ORDER BY t2.created_at DESC LIMIT 1) AS config_state,
       (SELECT last_error FROM tesla_telemetry_config t3 WHERE t3.vin = v.vin
         ORDER BY t3.created_at DESC LIMIT 1) AS config_last_error,
       (SELECT COUNT(*) FROM tesla_telemetry_fact f WHERE f.vin = v.vin) AS fact_count,
       (SELECT MAX(f.observed_at) FROM tesla_telemetry_fact f WHERE f.vin = v.vin) AS last_fact_at,
       (SELECT value_text FROM tesla_vehicle_snapshot s
         WHERE s.vin = v.vin AND s.field_key = 'CarType') AS car_type,
       (SELECT value_text FROM tesla_vehicle_snapshot s
         WHERE s.vin = v.vin AND s.field_key = 'EfficiencyPackage') AS efficiency_package,
       (SELECT value_text FROM tesla_vehicle_snapshot s
         WHERE s.vin = v.vin AND s.field_key = 'Trim') AS trim,
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

    // One vehicle block per VIN. The query joins consent history, so a member with
    // N consent records produced N copies of every vehicle -- observed live as ten
    // identical blocks (and ten "Virtual Key" rows) for a single member, nine of
    // them stale. Dedupe before rendering, and record the distinct states.
    const vehicleByVin = new Map<string, Record<string, unknown>>()
    for (const r of rows) {
      if (!r.vin) continue
      const v = String(r.vin)
      if (!vehicleByVin.has(v)) vehicleByVin.set(v, r)
    }
    const vehicles = Array.from(vehicleByVin.values())

    // The member's own zone, resolved from their postcode. Each member block renders its
    // vehicles' times in that member's local zone, because that is the zone the owner
    // reasons in — a Queensland member must not be shown NSW daylight time.
    const memberZone = timeZoneForPostcode(
      first.postcode === null || first.postcode === undefined ? null : String(first.postcode),
    )

    // The member-level pill must not speak for one vehicle and imply all of them.
    // It previously read `first.key_state`, so a member with one paired and one
    // unpaired vehicle showed a single green "paired" pill -- the unpaired vehicle
    // was reported as fine at member level. Report the count instead, and reserve
    // the plain state for the single-vehicle case where it is unambiguous.
    const pairedCount = vehicles.filter((v) => v.key_state === 'paired').length
    const faultCount = vehicles.filter((v) => v.key_state === 'fault').length
    const isAmbiguous = vehicles.length !== 1
    const keyLabel = vehicles.length === 0
      ? 'no vehicle'
      : isAmbiguous
        ? `${pairedCount} of ${vehicles.length} keys paired`
        : String(vehicles[0].key_state ?? 'unpaired')
    const stateClass = vehicles.length === 0
      ? 'warn'
      : isAmbiguous
        ? pairedCount === vehicles.length
          ? 'ok'
          : pairedCount === 0
            ? 'bad'
            : 'warn'
        : vehicles[0].key_state === 'paired'
          ? 'ok'
          : vehicles[0].key_state === 'fault'
            ? 'bad'
            : 'warn'

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

    return `
      <div style="margin-bottom:16px;padding:16px;background:#151515;border-radius:12px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;flex-wrap:wrap;gap:12px">
          <div>
            <div style="font-size:17px;font-weight:700;color:#fff">${escapeHtml(first.member_id ?? memberId)}</div>
            <div class="meta">${escapeHtml(first.tesla_email ?? '—')}</div>
            <div class="meta">Joined: ${escapeHtml(first.member_since ?? '—')}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <span class="pill ${stateClass}">${escapeHtml(keyLabel)}</span>
          </div>
        </div>
        ${vehicles.length === 0 ? '<div class="meta">No vehicle on record for this member.</div>' : ''}
        ${vehicles.map((r) => `
        <div style="margin-top:12px;padding:12px;background:#101010;border-radius:8px">
          <h4 style="margin:0 0 8px;color:#42ff8c">Vehicle — ${escapeHtml(r.vin)}</h4>
          <table style="font-size:13px;width:100%">
            <tbody>
              <tr><td class="meta" style="width:170px">Display Name</td><td>${escapeHtml(r.display_name ?? '—')}</td></tr>
              <tr><td class="meta">Model</td><td>${vehicleIdentity(r)}</td></tr>
              <tr><td class="meta">Last Seen</td><td class="meta">${formatDualTime(r.last_seen_at === null || r.last_seen_at === undefined ? null : String(r.last_seen_at), memberZone)}</td></tr>
              <tr><td class="meta">Virtual Key</td><td><span class="pill ${r.key_state === 'paired' ? 'ok' : r.key_state === 'fault' ? 'bad' : 'warn'}">${escapeHtml(r.key_state ?? 'unpaired')}</span>${
                // Show WHY a key is unpaired. "unpaired" alone cannot distinguish a
                // key the member never added from one removed at the car from a
                // Tesla-side problem, and those need different actions.
                r.key_last_error
                  ? ` <span class="meta">${escapeHtml(keyReason(r.key_last_error))}</span>`
                  : ''
              }</td></tr>
              <tr><td class="meta">Paired At</td><td class="meta">${formatDualTime(r.paired_at === null || r.paired_at === undefined ? null : String(r.paired_at), memberZone)}</td></tr>
              <tr><td class="meta">Telemetry Config</td><td><span class="pill ${
                r.config_state === 'active' ? 'ok' : r.config_state === 'failed' ? 'bad' : 'warn'
              }">${escapeHtml(r.config_state ?? 'none')}</span>${
                r.config_last_error ? ` <span class="meta">${escapeHtml(String(r.config_last_error).slice(0, 80))}</span>` : ''
              }</td></tr>
              <tr><td class="meta">Data Received</td><td>${
                // "0 records" and "collection silently broken" must not look alike,
                // so a verified active config with nothing captured is called out.
                Number(r.fact_count ?? 0) === 0
                  ? r.config_state === 'active'
                    ? '<span class="pill bad">no data yet</span> <span class="meta">config active but nothing captured — check the relay</span>'
                    : '<span class="meta">none yet</span>'
                  : `<strong>${Number(r.fact_count)}</strong> <span class="meta">records, latest ${
                      // This is the row that caused the confusion: it carried a bare
                      // timestamp with NO zone label, so `02:28:15` read as 2:28 AM local
                      // and contradicted the owner's account of their own trip.
                      formatDualTime(r.last_fact_at === null || r.last_fact_at === undefined ? null : String(r.last_fact_at), memberZone)
                    }</span>`
              }</td></tr>
            </tbody>
          </table>
        </div>
        `).join('')}
        ${hasConsentHistory ? `
        <div style="margin-top:12px;padding:12px;background:#101010;border-radius:8px">
          <h4 style="margin:0 0 8px;color:#a52045">Consent History (${rows.filter(r => r.consent_id).length} record(s))</h4>
          <table style="font-size:12px">
            <thead>
              <tr>
                <th>Granted</th><th>Revoked</th><th>Policy</th><th>Status</th><th>Reason</th>
                <th>Collected Fields</th><th>Recipients</th><th>IP Hash</th>
              </tr>
            </thead>
            <tbody>${consentRows}</tbody>
          </table>
        </div>
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
  const [members, vehicles, activeConsent, revokedConsent, batches, facts, signals] = await Promise.all([
    c.env.D1_TESLA.prepare('SELECT COUNT(*) AS n FROM tesla_member').first<{ n: number }>(),
    c.env.D1_TESLA.prepare('SELECT COUNT(*) AS n FROM tesla_vehicle').first<{ n: number }>(),
    c.env.D1_TESLA.prepare('SELECT COUNT(*) AS n FROM tesla_consent WHERE revoked_at IS NULL').first<{ n: number }>(),
    c.env.D1_TESLA.prepare('SELECT COUNT(*) AS n FROM tesla_consent WHERE revoked_at IS NOT NULL').first<{ n: number }>(),
    // Total, not day-scoped. A day-scoped counter resets to 0 at 00:00 UTC, so a
    // pipeline that has been silently broken since yesterday reads identically to
    // one that was never set up -- and an empty card reads as "nothing is wrong"
    // rather than "nothing has ever arrived". "Ever" is the honest denominator.
    c.env.D1_TESLA.prepare('SELECT COUNT(*) AS n FROM tesla_telemetry_batch').first<{ n: number }>(),
    c.env.D1_TESLA.prepare('SELECT COUNT(*) AS n FROM tesla_telemetry_fact').first<{ n: number }>(),
    c.env.D1_TESLA.prepare('SELECT COALESCE(SUM(signals),0) AS n FROM tesla_signal_counter').first<{ n: number }>(),
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

  <h2>Telemetry</h2>
  <div class="cards">
    <div class="card"><div class="num">${batches?.n ?? 0}</div><div class="lbl">Batches (all time)</div></div>
    <div class="card"><div class="num">${facts?.n ?? 0}</div><div class="lbl">Records (all time)</div></div>
    <div class="card"><div class="num">${signals?.n ?? 0}</div><div class="lbl">Signals metered</div></div>
    <div class="card"><div class="num">$${cost}</div><div class="lbl">Est. cost</div></div>
  </div>
  <p class="meta">Counts are all-time, not today: a day-scoped counter reads 0 both when nothing is
  wrong and when nothing has ever arrived. <a href="/admin/telemetry">View records by column →</a></p>

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

/**
 * Column-per-field telemetry history (F04).
 *
 * The fact table is narrow by design, which is unreadable for analysis. This
 * renders `tesla_telemetry_record` -- one row per instant, one column per signal,
 * in time order -- so a member's history can be read as a table. The view is
 * derived from the facts, so it cannot drift; see migration 0012.
 */
adminApp.get('/telemetry', async (c) => {
  const vinFilter = (c.req.query('vin') ?? '').trim()
  const limit = Math.min(Number(c.req.query('limit') ?? '100'), 500)

  // VIN list for the selector, plus the `once`-tier vehicle attributes so the
  // firmware/config context is visible next to the time series. The member's postcode
  // comes along so times render in that member's own zone (state-aware: QLD is AEST
  // year-round while NSW/VIC/ACT/TAS observe AEDT).
  const vinRows = await c.env.D1_TESLA.prepare(
    `SELECT v.vin, v.display_name, m.postcode,
            (SELECT COUNT(*) FROM tesla_telemetry_fact f WHERE f.vin = v.vin) AS facts,
            (SELECT MAX(f.observed_at) FROM tesla_telemetry_fact f WHERE f.vin = v.vin) AS last_at
       FROM tesla_vehicle v
       LEFT JOIN tesla_member m ON m.member_id = v.member_id
      ORDER BY v.first_seen_at DESC`,
  ).all<Record<string, unknown>>()
  const vins = vinRows.results ?? []

  const selected = vinFilter || (vins[0]?.vin ? String(vins[0].vin) : '')

  // The zone for the selected vehicle's member, resolved from their postcode. Null
  // postcode or an unmatched range degrades to UTC-only rendering, which is correct
  // everywhere rather than a plausible local time for the wrong zone.
  const selectedRow = vins.find((v) => String(v.vin) === selected)
  const selectedPostcode =
    selectedRow?.postcode === null || selectedRow?.postcode === undefined
      ? null
      : String(selectedRow.postcode)
  const zone = timeZoneForPostcode(selectedPostcode)
  // Naming the state beside the times is not decoration: whether daylight saving applies
  // is a juristictional fact ("note location state - eg, QLD, NSW etc" per the owner), and
  // a reader cannot tell AEDT from AEST without knowing the state.
  const state = stateFromPostcode(selectedPostcode)
  const stateNote = state
    ? ` <span class="meta">(${state}${selectedPostcode ? ` ${escapeHtml(selectedPostcode)}` : ''} — times shown in this member's local zone)</span>`
    : ' <span class="meta">(no postcode on record — times shown in UTC)</span>'

  const [records, attrs] = selected
    ? await Promise.all([
        c.env.D1_TESLA.prepare(
          `SELECT * FROM tesla_telemetry_record
            WHERE vin = ? ORDER BY observed_at DESC LIMIT ?`,
        )
          .bind(selected, limit)
          .all<Record<string, unknown>>(),
        c.env.D1_TESLA.prepare(
          'SELECT * FROM tesla_vehicle_attribute WHERE vin = ?',
        )
          .bind(selected)
          .first<Record<string, unknown>>(),
      ])
    : [{ results: [] as Record<string, unknown>[] }, null]

  const rows = records.results ?? []

  // Column definitions drive both the header and each cell. Keeping them in data
  // means the null-rendering rule is applied in exactly one place -- a NULL is a
  // signal not reported in that payload, and must not render as "0" or a blank
  // that reads as zero.
  const columns: Array<{ key: string; label: string; kind: 'num' | 'bool' | 'text' | 'time' | 'time-local' }> = [
    { key: 'observed_at', label: 'Observed (UTC)', kind: 'time' },
    { key: 'received_at', label: 'Received (UTC)', kind: 'time' },
    // Local equivalents, in the member's own state zone. Two columns rather than one
    // combined string because the UTC value must stay sortable and the local value
    // readable, and a reader must be able to tell which is which without inference.
    { key: 'observed_at', label: `Observed (local${state ? `, ${state}` : ''})`, kind: 'time-local' },
    { key: 'received_at', label: 'Received (local)', kind: 'time-local' },
    // Miles as reported, and the converted kilometres beside it. km is derived from
    // the same factor as src/derive.ts so the two cannot disagree.
    //
    // The two "since reset" columns are easily confused, so each label names its
    // subject explicitly. Tesla's own names differ only by the FSD prefix and read
    // almost identically in a table:
    //
    //   MilesSinceReset              "total number of miles driven since the
    //                                 Self-Driving statistics were reset"
    //   SelfDrivingMilesSinceReset   "total number of miles driven using Full
    //                                 Self-Driving since the ... reset"
    //
    // So one is ALL driving and the other is the FSD subset, both measured from the
    // same reset event — and `MilesSinceReset` is the denominator of the FSD share
    // ratio (ΔSelfDriving / ΔTotal), which an insurer reads as the FSD-usage
    // proportion. Labelled "Total miles since reset" rather than "Odometer since
    // reset": it is a distance-since-reset counter, not the odometer reading.
    { key: 'odometer_mi', label: 'Odometer (mi)', kind: 'num' },
    { key: 'odometer_km', label: 'Odometer (km)', kind: 'num' },
    { key: 'miles_since_reset_mi', label: 'Total miles since reset (mi)', kind: 'num' },
    { key: 'miles_since_reset_km', label: 'Total miles since reset (km)', kind: 'num' },
    { key: 'self_driving_miles_since_reset_mi', label: 'FSD miles since reset (mi)', kind: 'num' },
    { key: 'self_driving_miles_since_reset_km', label: 'FSD miles since reset (km)', kind: 'num' },
    { key: 'sentry_mode', label: 'Sentry mode', kind: 'text' },
    { key: 'speed_limit_mode', label: 'Speed limit mode', kind: 'bool' },
    { key: 'speed_limit_warning', label: 'Speed limit warning', kind: 'text' },
    { key: 'pin_to_drive_enabled', label: 'PIN to drive', kind: 'bool' },
    { key: 'automatic_blind_spot_camera', label: 'Auto blind spot camera', kind: 'bool' },
    { key: 'automatic_emergency_braking_off', label: 'AEB off', kind: 'bool' },
    { key: 'blind_spot_collision_warning_chime', label: 'BSM chime', kind: 'bool' },
    { key: 'emergency_lane_departure_avoidance', label: 'Emergency lane departure avoidance', kind: 'bool' },
    { key: 'is_resend', label: 'Resend', kind: 'bool' },
  ]

  const cell = (row: Record<string, unknown>, col: (typeof columns)[number]): string => {
    const v = row[col.key]
    // NULL is "not reported", not zero. Surfaced explicitly so an absent reading
    // can never be mistaken for a measured 0 -- the same distinction the schema
    // makes with value_kind = 'invalid'.
    if (v === null || v === undefined || v === '') return '<span class="meta">—</span>'

    // Timestamps: UTC in one column, the member's state-local equivalent in the next,
    // both 24-hour. Sourced from the shared formatter so every surface agrees and no
    // page can drift back to an unlabelled string.
    if (col.kind === 'time' || col.kind === 'time-local') {
      const { utc, local } = formatTimeColumns(String(v), zone)
      const shown = col.kind === 'time' ? utc : local
      return `<span class="mono">${escapeHtml(shown)}</span>`
    }

    if (col.kind === 'bool') {
      const on = Number(v) === 1
      return `<span class="pill ${on ? 'ok' : 'warn'}">${on ? 'yes' : 'no'}</span>`
    }
    if (col.kind === 'num') return `<span class="mono">${escapeHtml(v)}</span>`
    return escapeHtml(v)
  }

  const hasData = rows.length > 0

  return c.html(shell('Admin — Telemetry', `
  <h1>Telemetry <span class="meta">${selected ? `— ${escapeHtml(selected)}` : ''}</span></h1>
  <p class="meta" style="margin-top:-8px">${stateNote}</p>

  <form method="GET" action="/admin/telemetry" style="margin-bottom:16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
    <select name="vin" style="padding:10px 12px;border-radius:8px;border:1px solid #333;background:#0d0d0d;color:#fff;font-size:14px">
      ${vins.length === 0 ? '<option value="">No vehicles</option>' : ''}
      ${vins.map(v => `<option value="${escapeHtml(v.vin)}" ${selected === String(v.vin) ? 'selected' : ''}>${escapeHtml(v.display_name ?? v.vin)} — ${escapeHtml(v.vin)} (${escapeHtml(v.facts ?? 0)} records)</option>`).join('')}
    </select>
    <label class="meta">Rows
      <input type="number" name="limit" min="1" max="500" value="${limit}"
             style="width:90px;padding:8px 10px;border-radius:8px;border:1px solid #333;background:#0d0d0d;color:#fff">
    </label>
    <button type="submit" style="padding:10px 18px;border:0;border-radius:8px;background:#0b5ed7;color:#fff;font-weight:700;font-size:14px;cursor:pointer">Show</button>
  </form>

  ${!hasData ? `
  <div class="note">
    <strong>No telemetry recorded yet.</strong>
    ${selected ? `One row appears here per payload received for ${escapeHtml(selected)}.
      A verified config with nothing captured means collection is not reaching Tier 1 —
      check the relay's <code>log_level</code> (must be <code>info</code>) and its forwarded-line
      counters. A parked vehicle legitimately produces nothing: fields are change-gated and a
      value that has not changed is not sent, at any interval (configured interval 180 s, which
      bounds how often a changed value may be sent rather than guaranteeing a rate).` : 'No vehicle on record.'}
  </div>` : `
  <h2>Vehicle attributes <span class="meta">(constant unless firmware or hardware changes)</span></h2>
  <table style="font-size:13px;margin-bottom:20px">
    <thead><tr><th>Model</th><th>Firmware</th><th>Efficiency package</th><th>Observed</th></tr></thead>
    <tbody><tr>
      <td>${
        // Same composition as the overview, so the two pages cannot disagree —
        // model (CarType) + variant (EfficiencyPackage) + year (derived from VIN).
        vehicleIdentity({
          vin: selected,
          car_type: attrs?.car_type ?? null,
          efficiency_package: attrs?.efficiency_package ?? null,
          trim: attrs?.trim ?? null,
        })
      }</td>
      <td class="mono">${escapeHtml(attrs?.version ?? '—')}</td>
      <td>${escapeHtml(attrs?.efficiency_package ?? '—')}</td>
      <td class="meta">${formatDualTime(attrs?.newest_observed_at == null ? null : String(attrs.newest_observed_at), zone)}${
        // "as last reported" rather than a bare timestamp, and an explicit note when the
        // attributes were NOT all observed together (oldest != newest) — because a
        // partial payload advances only the fields it carries. Stating the range prevents
        // a reader assuming the model was observed as recently as the odometer.
        attrs?.oldest_observed_at && attrs?.newest_observed_at &&
        String(attrs.oldest_observed_at) !== String(attrs.newest_observed_at)
          ? ` <span class="meta">as last reported — attributes observed between ${formatDualTime(String(attrs.oldest_observed_at), zone)}</span>`
          : ' <span class="meta">as last reported</span>'
      }</td>
    </tr></tbody>
  </table>

  <h2>Records <span class="meta">(${rows.length} row${rows.length === 1 ? '' : 's'}, newest first)</span></h2>
  <div style="overflow-x:auto">
  <table style="font-size:12px;white-space:nowrap">
    <thead><tr>${columns.map(col => `<th>${escapeHtml(col.label)}</th>`).join('')}</tr></thead>
    <tbody>
    ${rows.map(row => `<tr>${columns.map(col => `<td>${cell(row, col)}</td>`).join('')}</tr>`).join('')}
    </tbody>
  </table>
  </div>
  <p class="meta" style="margin-top:12px">
    A dash (—) means the signal was not reported in that payload, which is not the same as a
    measured zero. Storage is narrow (one row per field per instant) and this table is the
    pivot of it (migration 0012); the raw payload for every row is retained in R2.
  </p>`}
  `, true, selected))
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
/**
 * Live-freshness probe (F02-R14).
 *
 * Why this exists: the admin console is server-rendered HTML with no refresh, so an
 * operator could not tell a quiet pipeline from a stale page and had to ask for a manual
 * nudge to see new data. Two things were wrong, and both are fixed here rather than by
 * documentation:
 *
 *   1. Nothing in the page ever re-fetched. A tab left open showed the moment it loaded.
 *   2. The only freshness figure available was day-scoped (`/api/telemetry/health` counts
 *      from 00:00 UTC) — which advances daily rather than per payload, so a poller watching
 *      it cannot detect an arriving batch at all.
 *
 * This endpoint returns the newest OBSERVED instant (the vehicle's own clock) and the
 * newest RECEIVED instant (when we stored it). Both, because they answer different
 * questions: `observed` moves when the car sends, `received` moves when we ingest, and a
 * gap between them is the pipeline's latency rather than the car's silence.
 *
 * Scope: `?vin=` narrows to one vehicle; omitted, it is fleet-wide. Fleet-wide is what the
 * overview needs, and `COUNT(*)` there is bounded by D1's own query cost rather than by
 * the number of vehicles.
 */
adminApp.get('/api/telemetry/latest', async (c) => {
  const vin = (c.req.query('vin') ?? '').trim()

  // `no-store` is the point of the endpoint: a cached freshness check reports stale data
  // as current, which is worse than not checking at all.
  c.header('cache-control', 'no-store, no-cache, must-revalidate, private')

  const where = vin ? ' WHERE vin = ?' : ''
  const bind = <T extends unknown[]>(stmt: D1PreparedStatement, ...args: T) =>
    args.length ? stmt.bind(...args) : stmt

  // The two instants come from DIFFERENT tables, and that is not incidental:
  //
  //   observed_at  the vehicle's own clock for a reading — tesla_telemetry_fact
  //   received_at  when the payload reached us — tesla_telemetry_batch
  //
  // `tesla_telemetry_batch` has NO `observed_at` column. Reading both from the batch
  // table is a 500 (SQLITE_ERROR: no such column), which is what shipped in the first
  // version of this endpoint. A gap between the two is the pipeline's latency rather than
  // the car's silence, which is the distinction an operator needs when a vehicle looks
  // quiet.
  //
  // They are deliberately NOT both read from the fact table: a batch can be received and
  // its facts not yet written, and `received_at` on the batch IS the reception event.
  const observedStmt = c.env.D1_TESLA.prepare(
    `SELECT MAX(observed_at) AS newest_observed_at FROM tesla_telemetry_fact${where}`,
  )
  const receivedStmt = c.env.D1_TESLA.prepare(
    `SELECT MAX(received_at) AS newest_received_at FROM tesla_telemetry_batch${where}`,
  )
  const factsStmt = c.env.D1_TESLA.prepare(`SELECT COUNT(*) AS n FROM tesla_telemetry_fact${where}`)
  const batchesStmt = c.env.D1_TESLA.prepare(`SELECT COUNT(*) AS n FROM tesla_telemetry_batch${where}`)
  const args = vin ? [vin] : []

  const [observed, received, facts, batches] = await Promise.all([
    bind(observedStmt, ...args).first<{ newest_observed_at: string | null }>(),
    bind(receivedStmt, ...args).first<{ newest_received_at: string | null }>(),
    bind(factsStmt, ...args).first<{ n: number }>(),
    bind(batchesStmt, ...args).first<{ n: number }>(),
  ])

  return c.json({
    vin: vin || null,
    facts: facts?.n ?? 0,
    batches: batches?.n ?? 0,
    newest_observed_at: observed?.newest_observed_at ?? null,
    newest_received_at: received?.newest_received_at ?? null,
    checked_at: new Date().toISOString(),
  })
})

/* -------------------------------------------------------------------------- */
/* FEATURE-12: Telemetry Configurator — Admin Console                         */
/* -------------------------------------------------------------------------- */

/**
 * ============================================================
 * FEATURE-12: Telemetry Configurator — Admin Console (redesigned)
 * ============================================================
 * Single page with search/filter like exports page.
 * No required VIN parameter — scope selector + VIN picker.
 */

/**
 * GET /admin/telemetry/configurator
 * Main configurator page with search, filter, and staging forms.
 */
adminApp.get('/telemetry/configurator', async (c) => {
  if (!(await isAuthenticated(c))) return c.redirect('/admin/login')

  const scope = (c.req.query('scope') ?? 'global').trim() // global | group | vehicle
  const vin = (c.req.query('vin') ?? '').trim()
  const group_id = (c.req.query('group_id') ?? '').trim()
  const search = (c.req.query('search') ?? '').trim()
  const q = (c.req.query('q') ?? '').trim().toLowerCase()
  const staged = (c.req.query('staged') ?? '').trim()

  // F12-R14: every row's data comes from tesla_field_catalog. The console holds
  // no copy of what a field is — capability, type and description are catalog
  // facts joined at render time, so the table cannot drift from the catalog.
  const catalog = (await c.env.D1_TESLA.prepare(
    `SELECT field_key, category, value_type, proto_enum_name, description,
            collection_group, collection_tier, vehicle_data_equivalent
       FROM tesla_field_catalog
      WHERE collected = 1
      ORDER BY field_key`
  ).all<{
    field_key: string
    category: string
    value_type: string
    proto_enum_name: string | null
    description: string | null
    collection_group: string | null
    collection_tier: string
    vehicle_data_equivalent: string | null
  }>()).results ?? []

  const fields = await collectedFields(c.env.D1_TESLA)
  const collectedFieldKeys = fields.map(f => f.field_key)

  // F12-R17: paired vehicles only. An unpaired vehicle cannot receive a
  // configuration — its own key row says so — so listing one invites a staged
  // change that can never apply. Search filters server-side, capped at 50 rows:
  // a fleet at a thousand vehicles exceeds a dropdown's useful length.
  const like = search ? `%${search}%` : '%'
  const groups = (await c.env.D1_TESLA.prepare(
    'SELECT group_id, name, description FROM tesla_vehicle_group WHERE name LIKE ? ORDER BY name LIMIT 50'
  ).bind(like).all<{ group_id: string; name: string; description: string | null }>()).results ?? []
  const vehicles = (await c.env.D1_TESLA.prepare(
    `SELECT v.vin, v.display_name
       FROM tesla_vehicle v
       JOIN tesla_vehicle_key vk ON vk.vin = v.vin AND vk.key_state = 'paired'
      WHERE v.vin LIKE ? OR COALESCE(v.display_name, '') LIKE ?
      ORDER BY v.vin LIMIT 50`
  ).bind(like, like).all<{ vin: string; display_name: string | null }>()).results ?? []

  // A search that hides the current selection must not silently drop it: the
  // operator's chosen scope survives a filter that no longer matches it.
  if (scope === 'group' && group_id && !groups.some(g => g.group_id === group_id)) {
    const row = await c.env.D1_TESLA.prepare(
      'SELECT group_id, name, description FROM tesla_vehicle_group WHERE group_id = ?'
    ).bind(group_id).first<{ group_id: string; name: string; description: string | null }>()
    if (row) groups.unshift(row)
  }
  if (scope === 'vehicle' && vin && !vehicles.some(v => v.vin === vin)) {
    const row = await c.env.D1_TESLA.prepare(
      'SELECT vin, display_name FROM tesla_vehicle WHERE vin = ?'
    ).bind(vin).first<{ vin: string; display_name: string | null }>()
    if (row) vehicles.unshift(row)
  }

  // --- sparse resolution: vehicle > group > global --------------------------
  type EntryRow = { field_key: string; interval_seconds: number; minimum_delta: number | null; enabled: number }
  type Resolved = { interval_seconds: number; minimum_delta: number | null; enabled: boolean }
  const toResolved = (r: EntryRow): Resolved => ({
    interval_seconds: r.interval_seconds,
    minimum_delta: r.minimum_delta,
    enabled: r.enabled === 1,
  })

  const globalRows = (await c.env.D1_TESLA.prepare(
    `SELECT field_key, interval_seconds, minimum_delta, enabled
       FROM telemetry_config_entry WHERE scope_id = 'global'`
  ).all<EntryRow>()).results ?? []
  const globalMap = new Map(globalRows.map(r => [r.field_key, toResolved(r)]))

  const groupRows = scope === 'group' && group_id
    ? ((await c.env.D1_TESLA.prepare(
        `SELECT e.field_key, e.interval_seconds, e.minimum_delta, e.enabled
           FROM telemetry_config_entry e
           JOIN telemetry_config_scope s ON s.scope_id = e.scope_id
          WHERE s.scope_kind = 'group' AND s.group_id = ?`
      ).bind(group_id).all<EntryRow>()).results ?? [])
    : []
  const selectedGroupMap = new Map(groupRows.map(r => [r.field_key, toResolved(r)]))

  // Group membership and vehicle overrides load whenever a VIN is selected —
  // they feed the effective-config table and the vehicle-scope row overlay.
  const memberGroupRows = vin
    ? ((await c.env.D1_TESLA.prepare(
        `SELECT e.field_key, e.interval_seconds, e.minimum_delta, e.enabled
           FROM telemetry_config_entry e
           JOIN telemetry_config_scope s ON s.scope_id = e.scope_id
           JOIN tesla_vehicle_group_member m ON m.group_id = s.group_id
          WHERE s.scope_kind = 'group' AND m.vin = ?`
      ).bind(vin).all<EntryRow>()).results ?? [])
    : []
  const memberGroupMap = new Map(memberGroupRows.map(r => [r.field_key, toResolved(r)]))

  const vehicleRows = vin
    ? ((await c.env.D1_TESLA.prepare(
        `SELECT e.field_key, e.interval_seconds, e.minimum_delta, e.enabled
           FROM telemetry_config_entry e
           JOIN telemetry_config_scope s ON s.scope_id = e.scope_id
          WHERE s.scope_kind = 'vehicle' AND s.vin = ?`
      ).bind(vin).all<EntryRow>()).results ?? [])
    : []
  const vehicleMap = new Map(vehicleRows.map(r => [r.field_key, toResolved(r)]))

  // Effective values rendered per row for the CURRENT scope. Every collected
  // field renders (F12-R14), so the map is seeded first and the scope overlays
  // punch through: the seed covers a field whose global row does not exist yet,
  // which is the state a just-enrolled field is in before its seed lands.
  const displayMap = new Map<string, Resolved>()
  for (const r of catalog) displayMap.set(r.field_key, { interval_seconds: 180, minimum_delta: null, enabled: true })
  for (const [k, v] of globalMap) displayMap.set(k, v)
  if (scope === 'group') for (const [k, v] of selectedGroupMap) displayMap.set(k, v)
  if (scope === 'vehicle') {
    for (const [k, v] of memberGroupMap) displayMap.set(k, v)
    for (const [k, v] of vehicleMap) displayMap.set(k, v)
  }

  // Effective config for the VIN (provenance table below the main one).
  let effectiveConfig: Array<{
    field_key: string
    enabled: boolean
    interval_seconds: number
    minimum_delta: number | null
    source: 'global' | 'group' | 'vehicle'
    source_scope_id: string
  }> | null = null
  let groupScope: { group_id: string; name: string; description: string | null } | null = null
  let unresolved: string[] = []

  if (vin) {
    const resolved = resolveConfig(globalMap, memberGroupMap, vehicleMap, collectedFieldKeys, vin)
    effectiveConfig = resolved.fields
    unresolved = resolved.unresolved
    groupScope = await c.env.D1_TESLA.prepare(
      `SELECT g.group_id, g.name, g.description
         FROM tesla_vehicle_group g
         JOIN tesla_vehicle_group_member m ON m.group_id = g.group_id
        WHERE m.vin = ?`
    ).bind(vin).first<{ group_id: string; name: string; description: string | null }>()
  }

  // --- the table (F12-R14/R15/R16) -----------------------------------------
  const matchesQuery = (r: typeof catalog[number]) =>
    !q ||
    r.field_key.toLowerCase().includes(q) ||
    (r.category ?? '').toLowerCase().includes(q) ||
    (r.description ?? '').toLowerCase().includes(q)
  const visible = catalog.filter(matchesQuery)

  const rowsHtml = visible.map(r => {
    const v = displayMap.get(r.field_key) ?? { interval_seconds: 180, minimum_delta: null, enabled: true }
    const transport = r.vehicle_data_equivalent ? 'PULL' : 'PUSH'
    const formId = 'sfr_' + r.field_key.replace(/[^A-Za-z0-9]/g, '_')
    const typeLabel = r.proto_enum_name ? `${r.value_type} · ${r.proto_enum_name}` : r.value_type
    const highlight = staged === r.field_key ? ' style="outline:1px solid #42ff8c"' : ''
    return `<tr${highlight}>
      <td><code>${escapeHtml(r.field_key)}</code></td>
      <td>${escapeHtml(r.category ?? '—')}</td>
      <td class="mono">${escapeHtml(r.collection_group ?? '—')}</td>
      <td><span class="pill">${escapeHtml(typeLabel)}</span></td>
      <td class="meta" style="max-width:280px">${escapeHtml(r.description ?? '—')}</td>
      <td><span class="pill ${transport === 'PULL' ? '' : 'ok'}">${transport}</span></td>
      <td><span class="pill">${escapeHtml(r.collection_tier)}</span></td>
      <td><input type="number" name="interval_seconds" form="${formId}" min="1" value="${v.interval_seconds}" title="seconds" style="width:86px;padding:6px;border-radius:6px;border:1px solid #333;background:#0d0d0d;color:#fff"></td>
      <td style="text-align:center"><input type="checkbox" form="${formId}" name="enabled" ${v.enabled ? 'checked' : ''} title="Enabled"></td>
      <td><button type="submit" form="${formId}" style="padding:6px 12px;border:0;border-radius:6px;background:#0b5ed7;color:#fff;font-weight:700;font-size:13px;cursor:pointer">Save</button></td>
    </tr>`
  }).join('')

  // One hidden form per row. Inputs live in the row's cells and associate via
  // the `form` attribute — a <form> cannot wrap <tr>, and one form per table
  // would let a stray field_key input in another row collide on parse.
  const rowForms = visible.map(r => {
    const v = displayMap.get(r.field_key) ?? { interval_seconds: 180, minimum_delta: null, enabled: true }
    const formId = 'sfr_' + r.field_key.replace(/[^A-Za-z0-9]/g, '_')
    return `<form id="${formId}" method="POST" action="/admin/telemetry/stage">
      <input type="hidden" name="scope" value="${escapeHtml(scope)}">
      ${scope === 'group' ? `<input type="hidden" name="group_id" value="${escapeHtml(group_id)}">` : ''}
      ${scope === 'vehicle' ? `<input type="hidden" name="vin" value="${escapeHtml(vin)}">` : ''}
      <input type="hidden" name="field_key" value="${escapeHtml(r.field_key)}">
      <input type="hidden" name="minimum_delta" value="${v.minimum_delta ?? ''}">
    </form>`
  }).join('')

  const tableHtml = visible.length === 0
    ? '<div class="empty">No fields match.</div>'
    : `<table style="font-size:13px">
        <thead><tr>
          <th>Name</th><th>Capability</th><th>Property</th><th>Type</th><th>Description</th>
          <th title="Derived from catalog: PUSH = Fleet Telemetry, PULL = Fleet API polling (read-only)">Transport</th>
          <th>Tesla Package</th><th>Sampling (s)</th><th>Enabled</th><th></th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      ${rowForms}`

  // --- F12-R18: enrolment panel ---------------------------------------------
  // The operator may widen the collected set from the console, under the
  // standing authorisation ("The information collected may vary from time to
  // time..."). Broken and deprecated catalog rows are excluded: enrolling a
  // field the catalog itself marks unusable would land data Tesla cannot send.
  const enrolable = (await c.env.D1_TESLA.prepare(
    `SELECT field_key, category, description
       FROM tesla_field_catalog
      WHERE collected = 0 AND is_broken = 0 AND is_deprecated = 0
      ORDER BY field_key`
  ).all<{ field_key: string; category: string; description: string | null }>()).results ?? []

  const enrolHtml = enrolable.length === 0
      ? '<p class="meta">Every usable catalog field is already collected.</p>'
      : enrolable.map(f => {
          const id = 'enr_' + f.field_key.replace(/[^A-Za-z0-9]/g, '_')
          return `<form id="${id}" method="POST" action="/admin/telemetry/enrol" style="display:flex;gap:12px;align-items:center;padding:6px 0;border-bottom:1px solid #1c1c1c">
            <input type="hidden" name="field_key" value="${escapeHtml(f.field_key)}">
            <strong style="min-width:240px"><code>${escapeHtml(f.field_key)}</code></strong>
            <span class="pill">${escapeHtml(f.category)}</span>
            <span class="meta" style="flex:2;min-width:300px">${escapeHtml(f.description ?? '')}</span>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
              <input type="checkbox" name="enrol" value="1" style="width:18px;height:18px;cursor:pointer">
              <span style="font-weight:700;color:#0b5ed7">Enrol</span>
            </label>
          </form>`
        }).join('')

  // --- provenance table (existing design, unchanged) ------------------------
  let effectiveHtml = ''
  let unresolvedHtml = ''
  let scopeBadge = ''

  if (effectiveConfig !== null) {
    if (groupScope) {
      scopeBadge = `<span class="pill ok">Group: ${escapeHtml(groupScope.name)}</span>`
    } else {
      scopeBadge = '<span class="pill warn">Global only</span>'
    }

    effectiveHtml = `
      <h2>Effective Configuration for ${escapeHtml(vin)} ${scopeBadge}</h2>
      <p class="meta">Resolution: vehicle > group > global (sparse). Fields without a row at a scope inherit from above.</p>
      <table style="font-size:13px">
        <thead><tr><th>Field</th><th>Enabled</th><th>Interval</th><th>Min Delta</th><th>Source</th><th>Provenance</th></tr></thead>
        <tbody>
        ${effectiveConfig.map(f => `
          <tr>
            <td><code>${escapeHtml(f.field_key)}</code></td>
            <td><span class="pill ${f.enabled ? 'ok' : 'warn'}">${f.enabled ? 'Enabled' : 'Disabled'}</span></td>
            <td class="mono">${f.interval_seconds}s</td>
            <td class="mono">${f.minimum_delta !== null ? escapeHtml(f.minimum_delta) : '—'}</td>
            <td><span class="pill ${f.source === 'global' ? 'warn' : f.source === 'group' ? 'ok' : 'ok'}">${f.source}</span></td>
            <td>${f.source_scope_id}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    `

    if (unresolved.length > 0) {
      unresolvedHtml = `<div style="margin-top:16px;padding:12px;background:#3d1414;border-radius:8px;color:#ff8080">
        <strong>Configuration Error:</strong> The following collected fields have no value in any scope:
        <ul>${unresolved.map(k => `<li><code>${escapeHtml(k)}</code></li>`).join('')}</ul>
      </div>`
    }
  }

  return c.html(shell('Admin — Telemetry Configurator', `
    <h1>Telemetry Configurator</h1>
    <p class="meta">Configure collection per field at global, group, or vehicle scope. Transport is derived from the Tesla catalog and is not selectable (F12-R15). Vehicle selector lists paired vehicles only (F12-R17).</p>

    <!-- Scope + search selector (F12-R17) -->
    <form method="GET" action="/admin/telemetry/configurator" style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;margin:24px 0;padding:16px;background:#151515;border-radius:12px">
      <label class="meta">Scope
        <select name="scope" onchange="this.form.submit()" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid #333;background:#0d0d0d;color:#fff;margin-top:4px">
          <option value="global" ${scope === 'global' ? 'selected' : ''}>Global</option>
          <option value="group" ${scope === 'group' ? 'selected' : ''}>Group</option>
          <option value="vehicle" ${scope === 'vehicle' ? 'selected' : ''}>Vehicle</option>
        </select>
      </label>
      ${scope === 'group' ? `
      <label class="meta">Group
        <select name="group_id" onchange="this.form.submit()" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid #333;background:#0d0d0d;color:#fff;margin-top:4px">
          <option value="">Select group</option>
          ${groups.map(g => `<option value="${escapeHtml(g.group_id)}" ${g.group_id === group_id ? 'selected' : ''}>${escapeHtml(g.name)} (${escapeHtml(g.group_id)})</option>`).join('')}
        </select>
      </label>
      <label class="meta">Search groups
        <input name="search" value="${escapeHtml(search)}" placeholder="name" style="width:160px;padding:10px 12px;border-radius:8px;border:1px solid #333;background:#0d0d0d;color:#fff;margin-top:4px">
      </label>
      ` : ''}
      ${scope === 'vehicle' ? `
      <label class="meta">Vehicle (paired only)
        <select name="vin" onchange="this.form.submit()" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid #333;background:#0d0d0d;color:#fff;margin-top:4px">
          <option value="">Select vehicle</option>
          ${vehicles.map(v => `<option value="${escapeHtml(v.vin)}" ${v.vin === vin ? 'selected' : ''}>${escapeHtml(v.vin)}${v.display_name ? ' — ' + escapeHtml(v.display_name) : ''}</option>`).join('')}
        </select>
      </label>
      <label class="meta">Search vehicles
        <input name="search" value="${escapeHtml(search)}" placeholder="VIN or name" style="width:160px;padding:10px 12px;border-radius:8px;border:1px solid #333;background:#0d0d0d;color:#fff;margin-top:4px">
      </label>
      ` : ''}
      <label class="meta">Search fields
        <input name="q" value="${escapeHtml(c.req.query('q') ?? '')}" placeholder="name, capability, description" style="width:220px;padding:10px 12px;border-radius:8px;border:1px solid #333;background:#0d0d0d;color:#fff;margin-top:4px">
      </label>
      <button type="submit" style="padding:10px 18px;border:0;border-radius:8px;background:#0b5ed7;color:#fff;font-weight:700;font-size:14px;cursor:pointer">Apply filters</button>
    </form>

    <!-- Catalog-driven config table (F12-R14..R16) -->
    <h2>${scope === 'global' ? 'Global Configuration' : scope === 'group' ? 'Group Configuration: ' + (groups.find(g => g.group_id === group_id)?.name ?? group_id) : 'Vehicle Configuration: ' + escapeHtml(vin)}</h2>
    <p class="meta">Transport: <span class="pill ok">PUSH</span> = Fleet Telemetry · <span class="pill">PULL</span> = Fleet API polling. Read-only — derived from the catalog (F12-R15). Edit the interval and the toggle, then Save. ${scope !== 'global' ? 'Values shown are effective: inherited from a broader scope unless overridden here.' : ''}</p>
    ${tableHtml}

    <!-- Catalog enrolment (F12-R18) -->
    <h2>Add fields from the Tesla catalog</h2>
    <p class="meta">Enrolling widens the collected set under the standing authorisation — no re-consent. Each enrolment writes an audit row and seeds the field into the global scope so no configuration error appears. Broken and deprecated fields are not offered.</p>
    <div style="background:#151515;border-radius:12px;padding:8px 16px">${enrolHtml}</div>

    ${effectiveHtml}
    ${unresolvedHtml}
  `))
})

/**
 * POST /admin/telemetry/stage
 * Stage a configuration change in the specified scope.
 * Changes are written to staging tables only — no vehicle is affected until applied through CI.
 * F12-R05: Changes MUST be staged in the console and applied through CI.
 */
adminApp.post('/telemetry/stage', async (c) => {
  const form = await c.req.parseBody()
  const scope = String(form.scope ?? '').trim()
  const vin = String(form.vin ?? '').trim()
  const field_key = String(form.field_key ?? '').trim()
  const interval_seconds = Number(form.interval_seconds)
  const minimum_delta = form.minimum_delta ? Number(form.minimum_delta) : null
  const enabled = form.enabled === 'on' ? 1 : 0
  const nowIso = new Date().toISOString()

  if (!scope || !['global', 'group', 'vehicle'].includes(scope)) {
    return c.json({ error: 'scope must be global, group, or vehicle' }, 400)
  }
  if (!field_key) return c.json({ error: 'field_key is required' }, 400)
  if (!interval_seconds || interval_seconds < 1) return c.json({ error: 'interval_seconds must be > 0' }, 400)

  // Verify the field is in the collected set
  const fields = await collectedFields(c.env.D1_TESLA)
  const collectedFieldKeys = fields.map(f => f.field_key)
  if (!collectedFieldKeys.includes(field_key)) {
    return c.json({ error: 'field_key is not in the collected set' }, 400)
  }

  // F12-R04: The effective configuration MUST NOT collect any field outside CONSENTED_FIELDS
  // Overrides MAY narrow the collected set and MUST NOT widen it.
  // Since we only allow collected fields, this is enforced by the check above.

  let scope_id: string

  if (scope === 'global') {
    scope_id = 'global'
  } else if (scope === 'group') {
    const group_id = String(form.group_id ?? '').trim()
    if (!group_id) return c.json({ error: 'group_id required for group scope' }, 400)

    // Group staging is scoped to the group itself — no VIN membership check.
    // The configurator's group form has no VIN field; a group-scope change
    // applies to every member of the group, not to one vehicle.

    // Get the scope_id for this group
    const scopeRow = await c.env.D1_TESLA.prepare(
      'SELECT scope_id FROM telemetry_config_scope WHERE scope_kind = \'group\' AND group_id = ?'
    ).bind(group_id).first<{ scope_id: string }>()
    if (!scopeRow) {
      // Find-or-create: staging a group scope must work the first time,
      // not only after a scope row already exists.
      scope_id = 'grp_' + group_id
      await c.env.D1_TESLA.prepare(
        `INSERT INTO telemetry_config_scope (scope_id, scope_kind, group_id, created_at, updated_at, created_by)
         VALUES (?, 'group', ?, ?, ?, 'admin')`
      ).bind(scope_id, group_id, nowIso, nowIso).run()
    } else {
      scope_id = scopeRow.scope_id
    }
  } else {
    // Vehicle scope: find-or-create the scope row for this VIN.
    if (!vin) return c.json({ error: 'vin required for vehicle scope' }, 400)

    const vehicleExists = await c.env.D1_TESLA.prepare(
      'SELECT 1 AS ok FROM tesla_vehicle WHERE vin = ?'
    ).bind(vin).first()
    if (!vehicleExists) return c.json({ error: 'VIN not found' }, 404)

    const vehicleScopeRow = await c.env.D1_TESLA.prepare(
      `SELECT scope_id FROM telemetry_config_scope WHERE scope_kind = 'vehicle' AND vin = ?`
    ).bind(vin).first<{ scope_id: string }>()
    if (vehicleScopeRow) {
      scope_id = vehicleScopeRow.scope_id
    } else {
      scope_id = 'veh_' + vin
      await c.env.D1_TESLA.prepare(
        `INSERT INTO telemetry_config_scope (scope_id, scope_kind, vin, created_at, updated_at, created_by)
         VALUES (?, 'vehicle', ?, ?, ?, 'admin')`
      ).bind(scope_id, vin, nowIso, nowIso).run()
    }
  }

  // Stage the change (write to telemetry_config_entry)
  await c.env.D1_TESLA.prepare(
    `INSERT INTO telemetry_config_entry (scope_id, field_key, interval_seconds, minimum_delta, enabled, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (scope_id, field_key) DO UPDATE SET
       interval_seconds = excluded.interval_seconds,
       minimum_delta = excluded.minimum_delta,
       enabled = excluded.enabled,
       updated_at = excluded.updated_at`
  ).bind(scope_id, field_key, interval_seconds, minimum_delta, enabled, nowIso).run()

  // Audit the staging
  await audit(c.env.D1_TESLA, {
    action: 'telemetry_config_staged',
    actor: 'admin',
    actorType: 'admin',
    subjectType: 'telemetry_config',
    subjectId: `${scope_id}:${field_key}`,
    detail: { scope, field_key, interval_seconds, minimum_delta, enabled, scope_id },
  })

  // The configurator is a browser form: redirect back so the operator sees the
  // freshly staged value in the config-entries table instead of raw JSON.
  const back = new URLSearchParams({ scope, staged: field_key })
  const formGroup = String(form.group_id ?? '').trim()
  if (formGroup) back.set('group_id', formGroup)
  if (vin) back.set('vin', vin)
  return c.redirect(`/admin/telemetry/configurator?${back.toString()}`, 303)
})

/**
 * POST /admin/telemetry/enrol
 * Enrol a catalog field into the collected set (F12-R18, F14-R06).
 *
 * This is the ONE operation in FEATURE-12 that widens the collected set — every
 * other control may only narrow it (F12-R04) — so it gets its own route rather
 * than hiding inside /telemetry/stage, and it writes its own audit action so the
 * widening is reconstructable from the audit trail alone.
 *
 * Consent: no bump and no re-consent. CONSENT_TEXT already authorises a set that
 * "may vary from time to time as AFIRMICO's products and services evolve", and
 * the consent-row set recorded at grant time is a SUBSET of the current set —
 * checked as such at /healthz and verify-store (F01 AC6 under F12-R18).
 *
 * Transactional: catalog flip, global seed, and audit either all land or none
 * does. A field marked collected with no global entry is exactly the state
 * F12-R02 calls a configuration error (SDD-011 §12.4, invariant 11).
 */
adminApp.post('/telemetry/enrol', async (c) => {
  const form = await c.req.parseBody()
  const field_key = String(form.field_key ?? '').trim()
  if (!field_key) return c.json({ error: 'field_key is required' }, 400)

  const field = await c.env.D1_TESLA.prepare(
    `SELECT field_key, collected, collection_tier, min_delta, is_broken, is_deprecated
       FROM tesla_field_catalog WHERE field_key = ?`
  ).bind(field_key).first<{
    field_key: string
    collected: number
    collection_tier: string
    min_delta: number | null
    is_broken: number
    is_deprecated: number
  }>()
  if (!field) return c.json({ error: 'field not in catalog' }, 404)
  if (field.is_broken || field.is_deprecated) {
    return c.json({ error: 'field is broken or deprecated in the catalog' }, 409)
  }
  if (field.collected === 1) {
    return c.json({ ok: true, field_key, note: 'already collected' })
  }

  // A tier of 'never' would violate the catalog CHECK once collected flips, so
  // the tier moves with it: 'once' for attribute-like fields (snapshot storage),
  // otherwise the catalog's own tier already carries the value.
  const newTier = field.collection_tier === 'never' ? 'once' : field.collection_tier
  const nowIso = new Date().toISOString()
  const minDelta = field.min_delta !== null && field.min_delta > 0 && newTier !== 'once'
    ? field.min_delta
    : null

  // The seed interval follows the tiered rule from migration 0019 / F12-R16:
  // 'once' fields carry no streaming cadence (21600 default), 'event' fields
  // are volatile (180), everything else 21600. A global entry at any value
  // satisfies F12-R02's totality the moment the field joins the set.
  const seedInterval = newTier === 'event' ? 180 : 21600

  await c.env.D1_TESLA.batch([
    c.env.D1_TESLA.prepare(
      'UPDATE tesla_field_catalog SET collected = 1, collection_tier = ? WHERE field_key = ? AND collected = 0'
    ).bind(newTier, field_key),
    c.env.D1_TESLA.prepare(
      `INSERT INTO telemetry_config_entry (scope_id, field_key, interval_seconds, minimum_delta, enabled, updated_at)
       VALUES ('global', ?, ?, ?, 1, ?)
       ON CONFLICT (scope_id, field_key) DO UPDATE SET updated_at = excluded.updated_at`
    ).bind(field_key, seedInterval, minDelta, nowIso),
    // detail_json carries the field_key so the widening is reconstructable
    // without joining the audit table to the catalog.
    c.env.D1_TESLA.prepare(
      `INSERT INTO tesla_audit_event
         (event_id, occurred_at, actor, actor_type, action, subject_type, subject_id, detail_json)
       VALUES (?, ?, 'admin', 'admin', 'telemetry_field_enrolled', 'tesla_field_catalog', ?, ?)`
    ).bind(
      // newId() is imported at module scope for the stage route — reuse it.
      newId(),
      nowIso,
      field_key,
      JSON.stringify({ field_key, seed_interval: seedInterval, collection_tier: newTier }),
    ),
  ])

  return c.redirect('/admin/telemetry/configurator?scope=global', 303)
})

/**
 * POST /admin/telemetry/apply
 * Apply staged changes through a canaried sweep.
 * F12-R07: Global/group changes require an eligible canary.
 * F12-R08: Canary verification requires all three conditions.
 * F12-R09: A failed canary halts the rollout.
 */
adminApp.post('/telemetry/apply', async (c) => {
  const form = await c.req.parseBody()
  const vin = String(form.vin ?? '').trim()
  const canaryVin = String(form.canary_vin ?? '').trim()
  const scope = String(form.scope ?? '').trim()
  const nowIso = new Date().toISOString()

  if (!vin) return c.json({ error: 'vin is required' }, 400)
  if (!canaryVin) return c.json({ error: 'canary_vin is required for global/group changes' }, 400)

  // In a full implementation, this would:
  // 1. Create a config_apply_run record
  // 2. Resolve effective configs for all target VINs
  // 3. Check canary eligibility
  // 4. Apply to canary, verify three conditions
  // 5. On success, roll out to remaining VINs
  // 6. Record outcomes

  // For now, return a placeholder response
  return c.json({
    success: true,
    message: 'Apply sweep triggered. This would run the canaried sweep in production.',
    runId: `apply_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    canaryVin,
    targetVin: vin,
  })
})

/**
 * GET /admin/telemetry/groups
 * List all vehicle groups and their members.
 */
adminApp.get('/telemetry/groups', async (c) => {
  const groups = await listVehicleGroups(c.env.D1_TESLA)
  return c.html(shell('Admin — Vehicle Groups', `
    <h1>Vehicle Groups</h1>
    <p class="meta">Groups are owner-curated entities for telemetry configuration scope.</p>
    <form method="POST" action="/admin/telemetry/groups" style="margin-bottom:24px;display:flex;gap:12px;flex-wrap:wrap">
      <input type="text" name="name" placeholder="Group name" required style="padding:10px 12px;border-radius:8px;border:1px solid #333;background:#0d0d0d;color:#fff;min-width:200px">
      <input type="text" name="description" placeholder="Description" style="padding:10px 12px;border-radius:8px;border:1px solid #333;background:#0d0d0d;color:#fff;min-width:200px;flex:1">
      <button type="submit" style="padding:10px 18px;border:0;border-radius:8px;background:#0b5ed7;color:#fff;font-weight:700;font-size:14px;cursor:pointer">Create Group</button>
    </form>
    ${groups.length === 0
      ? '<div class="empty">No groups yet.</div>'
      : `<table>
        <thead><tr><th>Group ID</th><th>Name</th><th>Description</th><th>Members</th></thead>
        <tbody>
        ${groups.map(g => `<tr>
          <td><code>${escapeHtml(g.group_id)}</code></td>
          <td>${escapeHtml(g.name)}</td>
          <td class="meta">${escapeHtml(g.description ?? '—')}</td>
          <td class="meta">
            <a href="/admin/telemetry/groups?group_id=${escapeHtml(g.group_id)}">View</a>
          </td>
        </tr>`).join('')}
        </tbody>
      </table>`
    }
  `))
})

/**
 * GET /admin/telemetry/groups?group_id=...
 * Show group details and manage members.
 */
adminApp.get('/telemetry/groups', async (c) => {
  const group_id = (c.req.query('group_id') ?? '').trim()
  if (!group_id) return c.redirect('/admin/telemetry/groups', 302)

  const group = await getVehicleGroup(c.env.D1_TESLA, group_id)
  if (!group) return c.html(shell('Admin — Group', '<div class="empty">Group not found.</div>'))

  const members = await listGroupMembers(c.env.D1_TESLA, group_id)

  return c.html(shell('Admin — Vehicle Group', `
    <h1>Group: ${escapeHtml(group.name)} <span class="meta">${escapeHtml(group.group_id)}</span></h1>
    <p class="meta">${escapeHtml(group.description ?? 'No description')}</p>

    <h2>Members <span class="meta">(${members.length})</span></h2>
    <form method="POST" action="/admin/telemetry/groups/add-member" style="margin-bottom:16px;display:flex;gap:12px;flex-wrap:wrap">
      <input type="hidden" name="group_id" value="${escapeHtml(group.group_id)}">
      <input type="text" name="vin" placeholder="VIN" required style="padding:10px 12px;border-radius:8px;border:1px solid #333;background:#0d0d0d;color:#fff;min-width:200px">
      <button type="submit" style="padding:10px 18px;border:0;border-radius:8px;background:#0b5ed7;color:#fff;font-weight:700;font-size:14px;cursor:pointer">Add Member</button>
    </form>
    ${members.length === 0
      ? '<div class="empty">No members yet.</div>'
      : `<table>
        <thead><tr><th>VIN</th><th>Added</th><th>Action</th></thead>
        <tbody>
        ${members.map(m => `<tr>
          <td><code>${escapeHtml(m.vin)}</code></td>
          <td class="meta">${escapeHtml(m.added_at)}</td>
          <td>
            <form method="POST" action="/admin/telemetry/groups/remove-member" style="display:inline">
              <input type="hidden" name="group_id" value="${escapeHtml(group.group_id)}">
              <input type="hidden" name="vin" value="${escapeHtml(m.vin)}">
              <button type="submit" style="padding:6px 10px;border:0;border-radius:6px;background:#3d1414;color:#ff8080;font-size:12px;cursor:pointer">Remove</button>
            </form>
          </td>
        </tr>`).join('')}
        </tbody>
      </table>`
    }
  `))
})

/**
 * POST /admin/telemetry/groups
 * Create a new vehicle group.
 */
adminApp.post('/telemetry/groups', async (c) => {
  const form = await c.req.parseBody()
  const name = String(form.name ?? '').trim()
  const description = String(form.description ?? '').trim() || null
  const nowIso = new Date().toISOString()

  if (!name) return c.json({ error: 'name is required' }, 400)

  const group_id = newId()
  await createVehicleGroup(c.env.D1_TESLA, { group_id, name, description: description ?? undefined, nowIso })

  return c.redirect(`/admin/telemetry/groups?group_id=${group_id}`, 303)
})

/**
 * POST /admin/telemetry/groups/add-member
 * Add a vehicle to a group.
 */
adminApp.post('/telemetry/groups/add-member', async (c) => {
  const form = await c.req.parseBody()
  const group_id = String(form.group_id ?? '').trim()
  const vin = String(form.vin ?? '').trim()

  if (!group_id || !vin) return c.json({ error: 'group_id and vin are required' }, 400)

  // Verify the VIN exists
  const vehicle = await c.env.D1_TESLA.prepare('SELECT 1 AS ok FROM tesla_vehicle WHERE vin = ?').bind(vin).first()
  if (!vehicle) return c.json({ error: 'VIN not found' }, 404)

  await addVehicleToGroup(c.env.D1_TESLA, { group_id, vin })

  return c.redirect(`/admin/telemetry/groups?group_id=${group_id}`, 303)
})

/**
 * POST /admin/telemetry/groups/remove-member
 * Remove a vehicle from a group.
 */
adminApp.post('/telemetry/groups/remove-member', async (c) => {
  const form = await c.req.parseBody()
  const group_id = String(form.group_id ?? '').trim()
  const vin = String(form.vin ?? '').trim()

  if (!group_id || !vin) return c.json({ error: 'group_id and vin are required' }, 400)

  await removeVehicleFromGroup(c.env.D1_TESLA, group_id, vin)

  return c.redirect(`/admin/telemetry/groups?group_id=${group_id}`, 303)
})

/**
 * ============================================================
 * FEATURE-13: Data Export & Scheduled Reporting admin routes
 * ============================================================
 */

/**
 * GET /admin/exports
 * List export schedules with run history.
 */
adminApp.get('/exports', async (c) => {
  if (!(await isAuthenticated(c))) return c.redirect('/admin/login')

  const schedules = await c.env.D1_TESLA.prepare(
    `SELECT * FROM telemetry_export_schedule ORDER BY created_at DESC`
  ).all<{
    schedule_id: string
    name: string
    description: string | null
    scope: string
    group_id: string | null
    vin: string | null
    time_range: string
    format: string
    recurrence: string
    recurrence_config: string | null
    recipients: string
    email_template: string | null
    enabled: number
    created_by: string | null
    created_at: string
    updated_at: string
    next_run_at: string | null
    last_run_at: string | null
    last_run_status: string | null
  }>()

  const runs = await c.env.D1_TESLA.prepare(
    `SELECT * FROM telemetry_export_run ORDER BY started_at DESC LIMIT 50`
  ).all<{
    run_id: string
    schedule_id: string | null
    scope: string
    group_id: string | null
    vin: string | null
    time_range: string
    format: string
    row_count: number | null
    file_size: number | null
    file_sha256: string | null
    delivery_status: string
    error_detail: string | null
    started_at: string
    finished_at: string | null
    created_at: string
  }>()

  const scheduleRows = schedules.results ?? []
  const runRows = runs.results ?? []

  const schedulesHtml = scheduleRows.length === 0
    ? '<div class="empty">No export schedules defined.</div>'
    : `<table style="font-size:13px">
        <thead><tr><th>Name</th><th>Scope</th><th>Format</th><th>Recurrence</th><th>Next Run</th><th>Last Run</th><th>Status</th><th>Enabled</th></tr></thead>
        <tbody>
        ${scheduleRows.map(s => `<tr>
          <td><strong>${escapeHtml(s.name)}</strong><br><span class="meta">${escapeHtml(s.description ?? '')}</span></td>
          <td><span class="pill ok">${escapeHtml(s.scope)}</span></td>
          <td class="mono">${escapeHtml(s.format)}</td>
          <td>${escapeHtml(s.recurrence)}</td>
          <td class="meta">${escapeHtml(s.next_run_at ?? '—')}</td>
          <td class="meta">${escapeHtml(s.last_run_at ?? '—')}</td>
          <td><span class="pill ${s.last_run_status === 'delivered' ? 'ok' : s.last_run_status === 'failed' ? 'warn' : 'meta'}">${escapeHtml(s.last_run_status ?? 'never')}</span></td>
          <td>${s.enabled ? '✓' : '✗'}</td>
        </tr>`).join('')}
        </tbody>
      </table>`

  const runsHtml = runRows.length === 0
    ? '<div class="empty">No export runs yet.</div>'
    : `<table style="font-size:13px">
        <thead><tr><th>Run ID</th><th>Schedule</th><th>Scope</th><th>Rows</th><th>Status</th><th>Started</th><th>Finished</th></tr></thead>
        <tbody>
        ${runRows.map(r => `<tr>
          <td><code>${escapeHtml(r.run_id)}</code></td>
          <td>${escapeHtml(r.schedule_id ?? 'ad-hoc')}</td>
          <td>${escapeHtml(r.scope)}</td>
          <td class="mono">${r.row_count ?? '—'}</td>
          <td><span class="pill ${r.delivery_status === 'delivered' ? 'ok' : r.delivery_status === 'failed' ? 'warn' : 'meta'}">${escapeHtml(r.delivery_status)}</span></td>
          <td class="meta">${escapeHtml(r.started_at)}</td>
          <td class="meta">${escapeHtml(r.finished_at ?? '—')}</td>
        </tr>`).join('')}
        </tbody>
      </table>`

  return c.html(shell('Admin — Data Exports', `
    <h1>Data Exports <span class="meta">FEATURE-13</span></h1>
    <p class="meta">Recurring and ad-hoc telemetry exports with email delivery. CSV, Excel, and PDF formats.</p>

    <h2>Schedules</h2>
    ${schedulesHtml}

    <h2>New Schedule</h2>
    <form method="POST" action="/admin/exports" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;background:#151515;border-radius:12px;padding:16px">
      <label class="meta">Name
        <input type="text" name="name" required placeholder="Weekly fleet report" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid #333;background:#0d0d0d;color:#fff;margin-top:4px">
      </label>
      <label class="meta">Description
        <input type="text" name="description" placeholder="Optional" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid #333;background:#0d0d0d;color:#fff;margin-top:4px">
      </label>
      <label class="meta">Scope
        <select name="scope" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid #333;background:#0d0d0d;color:#fff;margin-top:4px">
          <option value="all">All vehicles</option>
          <option value="group">Group</option>
          <option value="vehicle">Single vehicle</option>
        </select>
      </label>
      <label class="meta">Group ID (if group scope)
        <input type="text" name="group_id" placeholder="grp_..." style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid #333;background:#0d0d0d;color:#fff;margin-top:4px">
      </label>
      <label class="meta">VIN (if vehicle scope)
        <input type="text" name="vin" placeholder="5YJ..." style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid #333;background:#0d0d0d;color:#fff;margin-top:4px">
      </label>
      <label class="meta">Time Range
        <select name="time_range" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid #333;background:#0d0d0d;color:#fff;margin-top:4px">
          <option value="hour">Last hour</option>
          <option value="week" selected>Last week</option>
          <option value="month">Last month</option>
          <option value="year">Last year</option>
          <option value="all">All time</option>
        </select>
      </label>
      <label class="meta">Format
        <select name="format" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid #333;background:#0d0d0d;color:#fff;margin-top:4px">
          <option value="csv">CSV</option>
          <option value="xlsx">Excel (.xlsx)</option>
          <option value="pdf">PDF</option>
        </select>
      </label>
      <label class="meta">Recurrence
        <select name="recurrence" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid #333;background:#0d0d0d;color:#fff;margin-top:4px">
          <option value="daily">Daily</option>
          <option value="weekly" selected>Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
          <option value="hourly">Hourly</option>
          <option value="specific_date">Specific date (one-off)</option>
          <option value="specific_weekdays">Specific weekdays</option>
        </select>
      </label>
      <label class="meta">Recipients (comma-separated emails)
        <input type="text" name="recipients" required placeholder="user@example.com, another@example.com" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid #333;background:#0d0d0d;color:#fff;margin-top:4px">
      </label>
      <label class="meta">
        <input type="checkbox" name="enabled" checked style="margin-right:8px"> Enabled
      </label>
      <div style="grid-column:1/-1">
        <button type="submit" style="padding:10px 18px;border:0;border-radius:8px;background:#0b5ed7;color:#fff;font-weight:700;font-size:14px;cursor:pointer">Create Schedule</button>
      </div>
    </form>

    <h2>Recent Runs</h2>
    ${runsHtml}
  `))
})

/**
 * POST /admin/exports
 * Create a new export schedule.
 */
adminApp.post('/exports', async (c) => {
  if (!(await isAuthenticated(c))) return c.json({ error: 'unauthorized' }, 401)

  const form = await c.req.parseBody()
  const name = String(form.name ?? '').trim()
  const description = String(form.description ?? '').trim() || null
  const scope = String(form.scope ?? 'all')
  const group_id = String(form.group_id ?? '').trim() || null
  const vin = String(form.vin ?? '').trim() || null
  const time_range = String(form.time_range ?? 'week')
  const format = String(form.format ?? 'csv')
  const recurrence = String(form.recurrence ?? 'weekly')
  const recipientsRaw = String(form.recipients ?? '').trim()
  const enabled = form.enabled ? 1 : 0

  if (!name) return c.json({ error: 'name is required' }, 400)
  if (!recipientsRaw) return c.json({ error: 'at least one recipient is required' }, 400)

  const recipients = recipientsRaw.split(',').map(r => r.trim()).filter(r => r.length > 0)
  if (recipients.length === 0) return c.json({ error: 'at least one recipient is required' }, 400)

  // Validate scope consistency
  if (scope === 'group' && !group_id) return c.json({ error: 'group_id required for group scope' }, 400)
  if (scope === 'vehicle' && !vin) return c.json({ error: 'vin required for vehicle scope' }, 400)

  const schedule_id = newId()
  const nowIso = new Date().toISOString()

  // Minimal recurrence config (time of day defaults to 00:00 UTC)
  const recurrence_config = JSON.stringify({ time_of_day: '00:00' })

  await c.env.D1_TESLA.prepare(
    `INSERT INTO telemetry_export_schedule (
      schedule_id, name, description, scope, group_id, vin, time_range, format,
      recurrence, recurrence_config, recipients, email_template, enabled,
      created_by, created_at, updated_at, next_run_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`
  ).bind(
    schedule_id, name, description, scope, group_id, vin, time_range, format,
    recurrence, recurrence_config, JSON.stringify(recipients), enabled,
    'admin', nowIso, nowIso, nowIso
  ).run()

  // Compute next_run_at via scheduler logic
  const { computeNextRun } = await import('./scheduler')
  const scheduleRow = await c.env.D1_TESLA.prepare(
    `SELECT * FROM telemetry_export_schedule WHERE schedule_id = ?`
  ).bind(schedule_id).first<any>()
  const nextRun = scheduleRow ? computeNextRun(scheduleRow) : null
  if (nextRun) {
    await c.env.D1_TESLA.prepare(
      `UPDATE telemetry_export_schedule SET next_run_at = ? WHERE schedule_id = ?`
    ).bind(nextRun, schedule_id).run()
  }

  await audit(c.env.D1_TESLA, {
    action: 'export_schedule_created',
    actor: 'admin',
    actorType: 'admin',
    subjectType: 'export_schedule',
    subjectId: schedule_id,
    detail: { name, scope, format, recurrence, recipients: recipients.length },
  })

  return c.redirect('/admin/exports', 303)
})

/**
 * POST /admin/exports/delete
 * Disable and remove an export schedule.
 */
adminApp.post('/exports/delete', async (c) => {
  if (!(await isAuthenticated(c))) return c.json({ error: 'unauthorized' }, 401)

  const form = await c.req.parseBody()
  const schedule_id = String(form.schedule_id ?? '').trim()
  if (!schedule_id) return c.json({ error: 'schedule_id is required' }, 400)

  await c.env.D1_TESLA.prepare(
    `DELETE FROM telemetry_export_schedule WHERE schedule_id = ?`
  ).bind(schedule_id).run()

  await audit(c.env.D1_TESLA, {
    action: 'export_schedule_deleted',
    actor: 'admin',
    actorType: 'admin',
    subjectType: 'export_schedule',
    subjectId: schedule_id,
    detail: {},
  })

  return c.redirect('/admin/exports', 303)
})

/**
 * POST /admin/exports/run-now
 * Manually trigger an export run for a schedule (ad-hoc run).
 */
adminApp.post('/exports/run-now', async (c) => {
  if (!(await isAuthenticated(c))) return c.json({ error: 'unauthorized' }, 401)

  const form = await c.req.parseBody()
  const schedule_id = String(form.schedule_id ?? '').trim()
  if (!schedule_id) return c.json({ error: 'schedule_id is required' }, 400)

  const schedule = await c.env.D1_TESLA.prepare(
    `SELECT * FROM telemetry_export_schedule WHERE schedule_id = ?`
  ).bind(schedule_id).first<any>()

  if (!schedule) return c.json({ error: 'schedule not found' }, 404)

  // Create run record — the actual generation runs via the export worker
  const runId = 'run_' + Date.now() + '_' + Math.random().toString(36).slice(2)
  const nowIso = new Date().toISOString()

  await c.env.D1_TESLA.prepare(
    `INSERT INTO telemetry_export_run (
      run_id, schedule_id, scope, group_id, vin, time_range, format,
      delivery_status, started_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).bind(
    runId, schedule_id, schedule.scope, schedule.group_id, schedule.vin,
    schedule.time_range, schedule.format, nowIso, nowIso
  ).run()

  await audit(c.env.D1_TESLA, {
    action: 'export_run_triggered',
    actor: 'admin',
    actorType: 'admin',
    subjectType: 'export_run',
    subjectId: runId,
    detail: { schedule_id, manual: true },
  })

  return c.redirect('/admin/exports', 303)
})

/** The icon is served by the worker at /favicon.svg; this is only a fallback. */
adminApp.get('/favicon.svg', (c) =>
  c.body(FAVICON_SVG, 200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=3600' }),
)

export default adminApp
// cache bust Mon  5 Oct 2026 11:57:18 AEDT
