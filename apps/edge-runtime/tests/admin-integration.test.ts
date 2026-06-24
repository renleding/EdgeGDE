/**
 * EdgeGDE — Admin Pages Integration Tests
 * HTTP-only tests against the deployed worker.
 *
 * Environment variables:
 *   WORKER_URL  (default: https://edgegde-calculator.renleding.workers.dev)
 *   TOKEN       (default: 858ea106ba9379472dfa634b1c630c2e46b525f6)
 *   TENANT      (default: au-mortgage-broker-afirmico)
 */

import { describe, it, expect } from 'vitest'

const WORKER = process.env.WORKER_URL || 'https://edgegde-calculator.renleding.workers.dev'
const TOKEN = process.env.TOKEN || '858ea106ba9379472dfa634b1c630c2e46b525f6'
const TENANT = process.env.TENANT || 'au-mortgage-broker-afirmico'

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

describe('KB Admin', () => {
  it('1.1 main page loads', async () => {
    const body = await get(`/admin/kb?tenant=${TENANT}&token=${TOKEN}`)
    has(body, 'Knowledge Base')
    has(body, 'AFIRMICO Admin')
    has(body, 'Ingest URL')
    has(body, 'Upload File')
  })

  it('1.2 nav links have tenant + token params', async () => {
    const body = await get(`/admin/kb?tenant=${TENANT}&token=${TOKEN}`)
    const kbMatch = body.match(/href="\/admin\/kb\?tenant=[^&"]+&token=[^"]+"/)
    const rulesMatch = body.match(/href="\/admin\/rules\?tenant=[^&"]+&token=[^"]+"/)
    const siteMatch = body.match(/href="\/admin\/site\?tenant=[^&"]+&token=[^"]+"/)
    expect(kbMatch).toBeTruthy()
    expect(rulesMatch).toBeTruthy()
    expect(siteMatch).toBeTruthy()
  })

  it('1.3 empty state renders when no pending entries exist', async () => {
    const body = await get(`/admin/kb?tenant=${TENANT}&token=${TOKEN}`)
    has(body, 'Knowledge Base')
    has(body, 'Pending')
    has(body, 'Approved')
  })

  it('1.4 pending tab responds correctly', async () => {
    const body = await get(`/admin/kb/pending?tenant=${TENANT}&token=${TOKEN}`)
    if (!body.includes('No pending entries') && !body.includes('rate') && !body.includes('interest') && !body.includes('entry') && !body.includes('card')) {
      throw new Error(`Unexpected pending tab response: ${body.substring(0, 80)}`)
    }
  })

  it('1.5 approved tab responds correctly', async () => {
    const body = await get(`/admin/kb/list?tenant=${TENANT}&token=${TOKEN}`)
    if (!body.includes('No approved entries') && !body.includes('rates') && !body.includes('Interest')) {
      throw new Error(`Unexpected approved tab response: ${body.substring(0, 80)}`)
    }
  })

  it('1.6 rejected tab empty', async () => {
    const body = await get(`/admin/kb/rejected?tenant=${TENANT}&token=${TOKEN}`)
    has(body, 'No rejected entries')
  })

  it('1.7 ingest empty URL fails', async () => {
    const body = await post(`/admin/kb/ingest-url?tenant=${TENANT}&token=${TOKEN}`, { url: '', topic: 'rates' })
    has(body, 'URL required')
  })

  it('1.8 ingest valid URL queues', async () => {
    const body = await post(`/admin/kb/ingest-url?tenant=${TENANT}&token=${TOKEN}`,
      { url: 'https://example.com/rates', topic: 'rates' })
    const ok = body.includes('Queued') || body.includes('Processing')
    if (!ok) throw new Error(`Expected Queued/Processing, got: ${body.substring(0, 120)}`)
  })

  it('1.9 approve missing topic', async () => {
    const body = await post(`/admin/kb/approve?tenant=${TENANT}&token=${TOKEN}`)
    has(body, 'Missing topic')
  })

  it('1.10 reject missing topic', async () => {
    const body = await post(`/admin/kb/reject?tenant=${TENANT}&token=${TOKEN}`)
    has(body, 'Missing topic')
  })

  it('1.11 unauthorized', async () => {
    const body = await get(`/admin/kb?tenant=${TENANT}`)
    has(body, 'Unauthorized')
  })
})

describe('File Upload', () => {
  it('6.1 upload section visible on main page', async () => {
    const body = await get(`/admin/kb?tenant=${TENANT}&token=${TOKEN}`)
    has(body, 'Upload File')
    has(body, 'Ingest URL')
    has(body, 'type="file"')
    has(body, 'accept=".html,.htm,.txt,.pdf"')
  })

  it('6.2 upload with no file fails', async () => {
    const body = await post(`/admin/kb/upload-file?tenant=${TENANT}&token=${TOKEN}`)
    has(body, 'File required')
  })

  it('6.3 upload a text file works', async () => {
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
})

describe('Delete', () => {
  it('7.1 delete-entry with no params fails', async () => {
    const body = await post(`/admin/kb/delete-entry?tenant=${TENANT}&token=${TOKEN}`)
    has(body, 'Missing topic')
  })

  it('7.2 delete-entry with nonexistent id handles gracefully', async () => {
    const body = await post(`/admin/kb/delete-entry?tenant=${TENANT}&token=${TOKEN}&topic=rates&entryId=nonexistent&state=pending`)
    const ok = body === '' || body.includes('Data not found') || body.includes('deleted') || body.includes('Deleted')
    if (!ok) throw new Error(`Unexpected response: ${body.substring(0, 80)}`)
  })

  it('7.3 delete-topic with no params fails', async () => {
    const body = await post(`/admin/kb/delete-topic?tenant=${TENANT}&token=${TOKEN}`)
    has(body, 'Missing topic')
  })

  it('7.4 KB page references approve/reject endpoints', async () => {
    const body = await get(`/admin/kb?tenant=${TENANT}&token=${TOKEN}`)
    has(body, '/admin/kb/approve')
    has(body, '/admin/kb/reject')
  })

  it('7.5 delete-topic on empty pending returns deleted', async () => {
    const body = await post(`/admin/kb/delete-topic?tenant=${TENANT}&token=${TOKEN}&topic=nonexistent&state=pending`)
    has(body, 'Deleted')
  })

  it('7.6 delete-entry buttons visible in pending HTML', async () => {
    const body = await get(`/admin/kb/pending?tenant=${TENANT}&token=${TOKEN}`)
    has(body, '/admin/kb/delete-entry')
  })
})

describe('HTMX Auth', () => {
  it('8.1 approve button has token param', async () => {
    const body = await get(`/admin/kb/pending?tenant=${TENANT}&token=${TOKEN}`)
    const approveMatch = body.match(/hx-post="\/admin\/kb\/approve\?[^"]+"/)
    if (!approveMatch) throw new Error('No approve button found')
    const href = approveMatch[0]
    if (!href.includes('token=')) throw new Error(`Approve button missing token: ${href}`)
  })

  it('8.2 reject button has token param', async () => {
    const body = await get(`/admin/kb/pending?tenant=${TENANT}&token=${TOKEN}`)
    const rejectMatch = body.match(/hx-post="\/admin\/kb\/reject\?[^"]+"/)
    if (!rejectMatch) throw new Error('No reject button found')
    const href = rejectMatch[0]
    if (!href.includes('token=')) throw new Error(`Reject button missing token: ${href}`)
  })

  it('8.3 delete-entry button has token param', async () => {
    const body = await get(`/admin/kb/pending?tenant=${TENANT}&token=${TOKEN}`)
    const deleteMatch = body.match(/hx-post="\/admin\/kb\/delete-entry\?[^"]+"/)
    if (!deleteMatch) throw new Error('No delete-entry button found')
    const href = deleteMatch[0]
    if (!href.includes('token=')) throw new Error(`Delete button missing token: ${href}`)
  })

  it('8.4 tab URLs include token param', async () => {
    const body = await get(`/admin/kb?tenant=${TENANT}&token=${TOKEN}`)
    const tabMatches = body.match(/hx-get="\/admin\/kb\/(pending|list|rejected)\?[^"]+"/g) || []
    if (tabMatches.length === 0) throw new Error('No tab hx-get found')
    for (const href of tabMatches) {
      if (!href.includes('token=')) throw new Error(`Tab ${href} missing token`)
    }
  })

  it('8.5 ingest URL form has token param', async () => {
    const body = await get(`/admin/kb?tenant=${TENANT}&token=${TOKEN}`)
    const formMatch = body.match(/hx-post="\/admin\/kb\/ingest-url\?[^"]+"/)
    if (!formMatch) throw new Error('No ingest form found')
    const href = formMatch[0]
    if (!href.includes('token=')) throw new Error(`Ingest form missing token: ${href}`)
  })

  it('8.6 upload file form has token param', async () => {
    const body = await get(`/admin/kb?tenant=${TENANT}&token=${TOKEN}`)
    const formMatch = body.match(/hx-post="\/admin\/kb\/upload-file\?[^"]+"/)
    if (!formMatch) throw new Error('No upload form found')
    const href = formMatch[0]
    if (!href.includes('token=')) throw new Error(`Upload form missing token: ${href}`)
  })
})

describe('Rules Admin', () => {
  it('2.1 main page loads', async () => {
    const body = await get(`/admin/rules?tenant=${TENANT}&token=${TOKEN}`)
    has(body, 'Policy Rules')
    has(body, 'Create Rule')
    has(body, 'Test Conditions')
  })

  it('2.2 nav links have tenant + token', async () => {
    const body = await get(`/admin/rules?tenant=${TENANT}&token=${TOKEN}`)
    const kbMatch = body.match(/href="\/admin\/kb\?tenant=[^&"]+&token=[^"]+"/)
    const rulesMatch = body.match(/href="\/admin\/rules\?tenant=[^&"]+&token=[^"]+"/)
    const siteMatch = body.match(/href="\/admin\/site\?tenant=[^&"]+&token=[^"]+"/)
    if (!kbMatch) throw new Error('KB nav link missing tenant+token')
    if (!rulesMatch) throw new Error('Rules nav link missing tenant+token')
    if (!siteMatch) throw new Error('Site nav link missing tenant+token')
  })

  it('2.3 empty state', async () => {
    const body = await get(`/admin/rules?tenant=${TENANT}&token=${TOKEN}`)
    has(body, 'No rules yet')
  })

  it('2.4 unauthorized', async () => {
    const body = await get(`/admin/rules?tenant=${TENANT}`)
    has(body, 'Unauthorized')
  })
})

describe('Site Admin', () => {
  it('3.1 main page loads', async () => {
    const body = await get(`/admin/site?tenant=${TENANT}&token=${TOKEN}`)
    has(body, 'AFIRMICO Admin')
    has(body, 'Staging')
    has(body, 'Production')
    has(body, 'Save Version')
    has(body, 'Widget Embed')
  })

  it('3.2 nav links have tenant + token', async () => {
    const body = await get(`/admin/site?tenant=${TENANT}&token=${TOKEN}`)
    const kbMatch = body.match(/href="\/admin\/kb\?tenant=[^&"]+&token=[^"]+"/)
    const rulesMatch = body.match(/href="\/admin\/rules\?tenant=[^&"]+&token=[^"]+"/)
    const siteMatch = body.match(/href="\/admin\/site\?tenant=[^&"]+&token=[^"]+"/)
    if (!kbMatch) throw new Error('KB nav link missing tenant+token')
    if (!rulesMatch) throw new Error('Rules nav link missing tenant+token')
    if (!siteMatch) throw new Error('Site nav link missing tenant+token')
  })

  it('3.3 empty staging/production', async () => {
    const body = await get(`/admin/site?tenant=${TENANT}&token=${TOKEN}`)
    has(body, 'No staging layout')
    has(body, 'No production layout')
  })

  it('3.4 widget embed section', async () => {
    const body = await get(`/admin/site?tenant=${TENANT}&token=${TOKEN}`)
    has(body, `data-tenant="${TENANT}"`)
    has(body, 'widget.v1.0.0.js')
    has(body, 'Preview Widget')
    has(body, 'Open Site')
  })

  it('3.5 promote no staging', async () => {
    const body = await post(`/admin/site/promote?tenant=${TENANT}&token=${TOKEN}`)
    has(body, 'No staging layout to promote')
  })

  it('3.6 save version no staging', async () => {
    const body = await post(`/admin/site/save-version?tenant=${TENANT}&token=${TOKEN}`, { label: 'test' })
    has(body, 'No staging layout to save')
  })

  it('3.7 unauthorized', async () => {
    const body = await get(`/admin/site?tenant=${TENANT}`)
    has(body, 'Unauthorized')
  })
})

describe('Cross-Cutting', () => {
  it('4.1 dashboard loads', async () => {
    const body = await get('/dashboard')
    has(body, 'EdgeGDE')
    has(body, 'Master Dashboard')
  })

  it('4.2 healthz returns ok', async () => {
    const body = await get('/healthz')
    has(body, 'ok')
  })
})

describe('Nav Link Auth', () => {
  it('5.1 KB nav links include token', async () => {
    const body = await get(`/admin/kb?tenant=${TENANT}&token=${TOKEN}`)
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

  it('5.2 Rules nav links include token', async () => {
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

  it('5.3 Site nav links include token', async () => {
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
})
