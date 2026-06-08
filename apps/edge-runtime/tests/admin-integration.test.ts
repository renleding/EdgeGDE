/**
 * EdgeGDE — Admin Pages Integration Tests
 * HTTP-only tests against the deployed worker.
 *
 * Usage:
 *   npx tsx tests/admin-integration.test.ts
 *
 * Environment variables:
 *   WORKER_URL  (default: https://edgegde-calculator.renleding.workers.dev)
 *   TOKEN       (default: 858ea106ba9379472dfa634b1c630c2e46b525f6)
 *   TENANT      (default: au-mortgage-broker-afirmico)
 */

const WORKER = process.env.WORKER_URL || 'https://edgegde-calculator.renleding.workers.dev'
const TOKEN = process.env.TOKEN || '858ea106ba9379472dfa634b1c630c2e46b525f6'
const TENANT = process.env.TENANT || 'au-mortgage-broker-afirmico'

let pass = 0
let fail = 0

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    pass++
    console.log(`  ✓ ${name}`)
  } catch (e: any) {
    fail++
    console.log(`  ✗ ${name}: ${e.message}`)
  }
}

async function get(path: string) {
  const url = `${WORKER}${path}${path.includes('?') ? '&' : '?'}_t=${Date.now()}`
  const r = await fetch(url, { headers: { 'User-Agent': 'edgegde-test/1.0' } })
  return r.text()
}

async function post(path: string, data?: Record<string, string>) {
  const url = `${WORKER}${path}${path.includes('?') ? '&' : '?'}_t=${Date.now()}`
  const fd = new URLSearchParams()
  if (data) for (const [k, v] of Object.entries(data)) fd.append(k, v)
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'edgegde-test/1.0' },
    body: fd.toString(),
  })
  return r.text()
}

function has(body: string, text: string) {
  if (!body.includes(text)) throw new Error(`Expected "${text}" in response`)
}

function no(body: string, text: string) {
  if (body.includes(text)) throw new Error(`Expected NOT "${text}" in response`)
}

// ═══════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════

async function main() {
  console.log(`EdgeGDE Admin Integration Tests`)
  console.log(`  Worker: ${WORKER}`)
  console.log(`  Tenant: ${TENANT}`)

  // ── 1. Knowledge Base ──────────────────────────────────────────────
  console.log('\n── KB Admin ──')

  await test('1.1 main page loads', async () => {
    const body = await get(`/admin/kb?tenant=${TENANT}&token=${TOKEN}`)
    has(body, 'Knowledge Base')
    has(body, 'AFIRMICO Admin')
    has(body, 'Ingest URL')
    has(body, 'Upload File')
  })

  await test('1.2 nav links have tenant + token params', async () => {
    const body = await get(`/admin/kb?tenant=${TENANT}&token=${TOKEN}`)
    // Links now carry both tenant AND token for auth-preserving navigation
    const kbMatch = body.match(/href="\/admin\/kb\?tenant=[^&"]+&token=[^"]+"/)
    const rulesMatch = body.match(/href="\/admin\/rules\?tenant=[^&"]+&token=[^"]+"/)
    const siteMatch = body.match(/href="\/admin\/site\?tenant=[^&"]+&token=[^"]+"/)
    if (!kbMatch) throw new Error('KB nav link missing tenant+token')
    if (!rulesMatch) throw new Error('Rules nav link missing tenant+token')
    if (!siteMatch) throw new Error('Site nav link missing tenant+token')
  })

  await test('1.3 empty state renders when no pending entries exist', async () => {
    // This test may find pending entries if a prior upload test created them
    const body = await get(`/admin/kb?tenant=${TENANT}&token=${TOKEN}`)
    // Page should always render — check for core elements
    has(body, 'Knowledge Base')
    has(body, 'Pending')
    has(body, 'Approved')
  })

  await test('1.4 pending tab responds correctly', async () => {
    const body = await get(`/admin/kb/pending?tenant=${TENANT}&token=${TOKEN}`)
    // Should return either pending entries or empty state — both are valid
    if (body.includes('No pending entries') || body.includes('rate') || body.includes('interest') || body.includes('entry') || body.includes('card')) {
      // Any of these responses are fine
    } else {
      throw new Error(`Unexpected pending tab response: ${body.substring(0, 80)}`)
    }
  })

  await test('1.5 approved tab responds correctly', async () => {
    const body = await get(`/admin/kb/list?tenant=${TENANT}&token=${TOKEN}`)
    // May have approved entries from prior runs or be empty
    if (body.includes('No approved entries') || body.includes('rates') || body.includes('Interest')) {
      // Both are valid responses
    } else {
      throw new Error(`Unexpected approved tab response: ${body.substring(0, 80)}`)
    }
  })

  await test('1.6 rejected tab empty', async () => {
    const body = await get(`/admin/kb/rejected?tenant=${TENANT}&token=${TOKEN}`)
    has(body, 'No rejected entries')
  })

  await test('1.7 ingest empty URL fails', async () => {
    const body = await post(`/admin/kb/ingest-url?tenant=${TENANT}&token=${TOKEN}`, { url: '', topic: 'rates' })
    has(body, 'URL required')
  })

  await test('1.8 ingest valid URL queues', async () => {
    const body = await post(`/admin/kb/ingest-url?tenant=${TENANT}&token=${TOKEN}`,
      { url: 'https://example.com/rates', topic: 'rates' })
    const ok = body.includes('Queued') || body.includes('Processing')
    if (!ok) throw new Error(`Expected Queued/Processing, got: ${body.substring(0, 120)}`)
  })

  await test('1.9 approve missing topic', async () => {
    const body = await post(`/admin/kb/approve?tenant=${TENANT}&token=${TOKEN}`)
    has(body, 'Missing topic')
  })

  await test('1.10 reject missing topic', async () => {
    const body = await post(`/admin/kb/reject?tenant=${TENANT}&token=${TOKEN}`)
    has(body, 'Missing topic')
  })

  await test('1.11 unauthorized', async () => {
    const body = await get(`/admin/kb?tenant=${TENANT}`)
    has(body, 'Unauthorized')
  })

  // ── File Upload ────────────────────────────────────────────────────
  console.log('\n── File Upload ──')

  await test('6.1 upload section visible on main page', async () => {
    const body = await get(`/admin/kb?tenant=${TENANT}&token=${TOKEN}`)
    has(body, 'Upload File')
    has(body, 'Ingest URL')
    has(body, 'type="file"')
    has(body, 'accept=".html,.htm,.txt,.pdf"')
  })

  await test('6.2 upload with no file fails', async () => {
    const body = await post(`/admin/kb/upload-file?tenant=${TENANT}&token=${TOKEN}`)
    has(body, 'File required')
  })

  await test('6.3 upload a text file works', async () => {
    const url = `${WORKER}/admin/kb/upload-file?tenant=${TENANT}&token=${TOKEN}`
    const boundary = '----TestBoundary' + Date.now()
    const fileContent = 'Interest rates: 6.15% p.a. for new customers. Minimum deposit 20%.'
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="test-rates.txt"',
      'Content-Type: text/plain', '', fileContent,
      `--${boundary}`,
      'Content-Disposition: form-data; name="topic"', '', 'rates',
      `--${boundary}--`,
    ].join('\r\n')
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'User-Agent': 'edgegde-test/1.0' },
      body: body,
    })
    const text = await res.text()
    const ok = text.includes('uploaded') || text.includes('Processing')
    if (!ok) throw new Error(`Expected upload success, got: ${text.substring(0, 120)}`)
  })

  // ── Delete Endpoints ───────────────────────────────────────────────
  console.log('\n── Delete ──')

  await test('7.1 delete-entry with no params fails', async () => {
    const body = await post(`/admin/kb/delete-entry?tenant=${TENANT}&token=${TOKEN}`)
    has(body, 'Missing topic')
  })

  await test('7.2 delete-entry with nonexistent id handles gracefully', async () => {
    const body = await post(`/admin/kb/delete-entry?tenant=${TENANT}&token=${TOKEN}&topic=rates&entryId=nonexistent&state=pending`)
    // Should return success (nothing to delete is not an error)
    // If no data exists, it returns 'Data not found'; if data exists it deletes and returns ''
    const ok = body === '' || body.includes('Data not found') || body.includes('deleted') || body.includes('Deleted')
    if (!ok) throw new Error(`Unexpected response: ${body.substring(0, 80)}`)
  })

  await test('7.3 delete-topic with no params fails', async () => {
    const body = await post(`/admin/kb/delete-topic?tenant=${TENANT}&token=${TOKEN}`)
    has(body, 'Missing topic')
  })

  await test('7.4 KB page references approve/reject endpoints', async () => {
    const body = await get(`/admin/kb?tenant=${TENANT}&token=${TOKEN}`)
    // The main page always has approve/reject endpoints in the HTMX actions
    has(body, '/admin/kb/approve')
    has(body, '/admin/kb/reject')
  })

  await test('7.5 delete-topic on empty pending returns deleted', async () => {
    const body = await post(`/admin/kb/delete-topic?tenant=${TENANT}&token=${TOKEN}&topic=nonexistent&state=pending`)
    has(body, 'Deleted')
  })

  await test('7.6 delete-entry buttons visible in pending HTML', async () => {
    const body = await get(`/admin/kb/pending?tenant=${TENANT}&token=${TOKEN}`)
    has(body, '/admin/kb/delete-entry')
  })

  // ── HTMX Auth (verify approve/reject/delete buttons have token) ──
  console.log('\n── HTMX Auth ──')

  await test('8.1 approve button has token param', async () => {
    const body = await get(`/admin/kb/pending?tenant=${TENANT}&token=${TOKEN}`)
    const approveMatch = body.match(/hx-post="\/admin\/kb\/approve\?[^"]+"/)
    if (!approveMatch) throw new Error('No approve button found')
    const href = approveMatch[0]
    if (!href.includes('token=')) throw new Error(`Approve button missing token: ${href}`)
  })

  await test('8.2 reject button has token param', async () => {
    const body = await get(`/admin/kb/pending?tenant=${TENANT}&token=${TOKEN}`)
    const rejectMatch = body.match(/hx-post="\/admin\/kb\/reject\?[^"]+"/)
    if (!rejectMatch) throw new Error('No reject button found')
    const href = rejectMatch[0]
    if (!href.includes('token=')) throw new Error(`Reject button missing token: ${href}`)
  })

  await test('8.3 delete-entry button has token param', async () => {
    const body = await get(`/admin/kb/pending?tenant=${TENANT}&token=${TOKEN}`)
    const deleteMatch = body.match(/hx-post="\/admin\/kb\/delete-entry\?[^"]+"/)
    if (!deleteMatch) throw new Error('No delete-entry button found')
    const href = deleteMatch[0]
    if (!href.includes('token=')) throw new Error(`Delete button missing token: ${href}`)
  })

  await test('8.4 tab URLs include token param', async () => {
    const body = await get(`/admin/kb?tenant=${TENANT}&token=${TOKEN}`)
    const tabMatches = body.match(/hx-get="\/admin\/kb\/(pending|list|rejected)\?[^"]+"/g) || []
    if (tabMatches.length === 0) throw new Error('No tab hx-get found')
    for (const href of tabMatches) {
      if (!href.includes('token=')) throw new Error(`Tab ${href} missing token`)
    }
  })

  await test('8.5 ingest URL form has token param', async () => {
    const body = await get(`/admin/kb?tenant=${TENANT}&token=${TOKEN}`)
    const formMatch = body.match(/hx-post="\/admin\/kb\/ingest-url\?[^"]+"/)
    if (!formMatch) throw new Error('No ingest form found')
    const href = formMatch[0]
    if (!href.includes('token=')) throw new Error(`Ingest form missing token: ${href}`)
  })

  await test('8.6 upload file form has token param', async () => {
    const body = await get(`/admin/kb?tenant=${TENANT}&token=${TOKEN}`)
    const formMatch = body.match(/hx-post="\/admin\/kb\/upload-file\?[^"]+"/)
    if (!formMatch) throw new Error('No upload form found')
    const href = formMatch[0]
    if (!href.includes('token=')) throw new Error(`Upload form missing token: ${href}`)
  })

  // ── 2. Rules ───────────────────────────────────────────────────────
  console.log('\n── Rules Admin ──')

  await test('2.1 main page loads', async () => {
    const body = await get(`/admin/rules?tenant=${TENANT}&token=${TOKEN}`)
    has(body, 'Policy Rules')
    has(body, 'Create Rule')
    has(body, 'Test Conditions')
  })

  await test('2.2 nav links have tenant + token', async () => {
    const body = await get(`/admin/rules?tenant=${TENANT}&token=${TOKEN}`)
    const kbMatch = body.match(/href="\/admin\/kb\?tenant=[^&"]+&token=[^"]+"/)
    const rulesMatch = body.match(/href="\/admin\/rules\?tenant=[^&"]+&token=[^"]+"/)
    const siteMatch = body.match(/href="\/admin\/site\?tenant=[^&"]+&token=[^"]+"/)
    if (!kbMatch) throw new Error('KB nav link missing tenant+token')
    if (!rulesMatch) throw new Error('Rules nav link missing tenant+token')
    if (!siteMatch) throw new Error('Site nav link missing tenant+token')
  })

  await test('2.3 empty state', async () => {
    const body = await get(`/admin/rules?tenant=${TENANT}&token=${TOKEN}`)
    has(body, 'No rules yet')
  })

  await test('2.4 unauthorized', async () => {
    const body = await get(`/admin/rules?tenant=${TENANT}`)
    has(body, 'Unauthorized')
  })

  // ── 3. Site ────────────────────────────────────────────────────────
  console.log('\n── Site Admin ──')

  await test('3.1 main page loads', async () => {
    const body = await get(`/admin/site?tenant=${TENANT}&token=${TOKEN}`)
    has(body, 'AFIRMICO Admin')
    has(body, 'Staging')
    has(body, 'Production')
    has(body, 'Save Version')
    has(body, 'Widget Embed')
  })

  await test('3.2 nav links have tenant + token', async () => {
    const body = await get(`/admin/site?tenant=${TENANT}&token=${TOKEN}`)
    const kbMatch = body.match(/href="\/admin\/kb\?tenant=[^&"]+&token=[^"]+"/)
    const rulesMatch = body.match(/href="\/admin\/rules\?tenant=[^&"]+&token=[^"]+"/)
    const siteMatch = body.match(/href="\/admin\/site\?tenant=[^&"]+&token=[^"]+"/)
    if (!kbMatch) throw new Error('KB nav link missing tenant+token')
    if (!rulesMatch) throw new Error('Rules nav link missing tenant+token')
    if (!siteMatch) throw new Error('Site nav link missing tenant+token')
  })

  await test('3.3 empty staging/production', async () => {
    const body = await get(`/admin/site?tenant=${TENANT}&token=${TOKEN}`)
    has(body, 'No staging layout')
    has(body, 'No production layout')
  })

  await test('3.4 widget embed section', async () => {
    const body = await get(`/admin/site?tenant=${TENANT}&token=${TOKEN}`)
    has(body, `data-tenant="${TENANT}"`)
    has(body, 'widget.v1.0.0.js')
    has(body, 'Preview Widget')
    has(body, 'Open Site')
  })

  await test('3.5 promote no staging', async () => {
    const body = await post(`/admin/site/promote?tenant=${TENANT}&token=${TOKEN}`)
    has(body, 'No staging layout to promote')
  })

  await test('3.6 save version no staging', async () => {
    const body = await post(`/admin/site/save-version?tenant=${TENANT}&token=${TOKEN}`, { label: 'test' })
    has(body, 'No staging layout to save')
  })

  await test('3.7 unauthorized', async () => {
    const body = await get(`/admin/site?tenant=${TENANT}`)
    has(body, 'Unauthorized')
  })

  // ── 4. Cross-Cutting ───────────────────────────────────────────────
  console.log('\n── Cross-Cutting ──')

  await test('4.1 dashboard loads', async () => {
    const body = await get('/dashboard')
    has(body, 'EdgeGDE')
    has(body, 'Master Dashboard')
  })

  await test('4.2 healthz returns ok', async () => {
    const body = await get('/healthz')
    has(body, 'ok')
  })

  // ── Nav Link Auth (from updated KB page with new sections) ──
  console.log('\n── Nav Link Auth ──')

  await test('5.1 KB nav links include token', async () => {
    const body = await get(`/admin/kb?tenant=${TENANT}&token=${TOKEN}`)
    // Extract all nav link hrefs
    const links = body.match(/href="\/admin\/[^"]*"/g) || []
    for (const link of links) {
      const href = link.replace('href="', '').replace('"', '')
      // Verify each nav link has both tenant AND token
      if (!href.includes('token=')) {
        throw new Error(`Nav link ${href} is missing token param`)
      }
      if (!href.includes('tenant=')) {
        throw new Error(`Nav link ${href} is missing tenant param`)
      }
      // Actually fetch the link and verify it returns 200
      const res = await fetch(`${WORKER}${href}`, {
        headers: { 'User-Agent': 'edgegde-test/1.0' },
      })
      const linkBody = await res.text()
      if (linkBody.includes('Unauthorized')) {
        throw new Error(`Nav link ${href} returned Unauthorized`)
      }
      if (linkBody.includes('Tenant not found')) {
        throw new Error(`Nav link ${href} returned Tenant not found`)
      }
    }
  })

  await test('5.2 Rules nav links include token', async () => {
    const body = await get(`/admin/rules?tenant=${TENANT}&token=${TOKEN}`)
    const links = body.match(/href="\/admin\/[^"]*"/g) || []
    for (const link of links) {
      const href = link.replace('href="', '').replace('"', '')
      if (!href.includes('token=')) {
        throw new Error(`Nav link ${href} is missing token param`)
      }
      if (!href.includes('tenant=')) {
        throw new Error(`Nav link ${href} is missing tenant param`)
      }
      const res = await fetch(`${WORKER}${href}`, {
        headers: { 'User-Agent': 'edgegde-test/1.0' },
      })
      const linkBody = await res.text()
      if (linkBody.includes('Unauthorized')) {
        throw new Error(`Nav link ${href} returned Unauthorized`)
      }
      if (linkBody.includes('Tenant not found')) {
        throw new Error(`Nav link ${href} returned Tenant not found`)
      }
    }
  })

  await test('5.3 Site nav links include token', async () => {
    const body = await get(`/admin/site?tenant=${TENANT}&token=${TOKEN}`)
    const links = body.match(/href="\/admin\/[^"]*"/g) || []
    for (const link of links) {
      const href = link.replace('href="', '').replace('"', '')
      if (!href.includes('token=')) {
        throw new Error(`Nav link ${href} is missing token param`)
      }
      if (!href.includes('tenant=')) {
        throw new Error(`Nav link ${href} is missing tenant param`)
      }
      const res = await fetch(`${WORKER}${href}`, {
        headers: { 'User-Agent': 'edgegde-test/1.0' },
      })
      const linkBody = await res.text()
      if (linkBody.includes('Unauthorized')) {
        throw new Error(`Nav link ${href} returned Unauthorized`)
      }
      if (linkBody.includes('Tenant not found')) {
        throw new Error(`Nav link ${href} returned Tenant not found`)
      }
    }
  })

  // ── Results ────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`)
  console.log(`Results: ${pass} passed, ${fail} failed, ${pass + fail} total`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })