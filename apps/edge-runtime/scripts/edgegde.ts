#!/usr/bin/env bun
/**
 * EdgeGDE Operator CLI — Phase 23.2 Pipeline Tool
 *
 * Usage:
 *   EDGEGDE_MCP_TOKEN=<token> bun scripts/edgegde.ts promote <tenant> [version]
 *   EDGEGDE_MCP_TOKEN=<token> bun scripts/edgegde.ts deploy <tenant> <fig-path> [note]
 *   EDGEGDE_MCP_TOKEN=<token> bun scripts/edgegde.ts rollback <tenant> <version>
 *   EDGEGDE_MCP_TOKEN=<token> bun scripts/edgegde.ts status <tenant>
 *
 * @packageDocumentation
 */

const BASE = 'https://edgegde-calculator.renleding.workers.dev/api/v1/mcp'
const TOKEN = process.env.EDGEGDE_MCP_TOKEN

if (!TOKEN) {
  console.error('ERROR: EDGEGDE_MCP_TOKEN environment variable is required.')
  process.exit(1)
}

const command = process.argv[2]
const tenant = process.argv[3]
const arg3 = process.argv[4]
const arg4 = process.argv[5]

async function apiPost(path: string, body: Record<string, unknown>): Promise<any> {
  const resp = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  return { status: resp.status, data: await resp.json() }
}

async function cmdPromote() {
  if (!tenant) { console.error('Usage: edgegde promote <tenant> [version]'); process.exit(1) }
  const version = arg3 || undefined
  console.error(`Promoting ${tenant} ${version ? `v${version}` : 'staging:latest'} → production...`)
  const { status, data } = await apiPost('/promote', {
    tenant_id: tenant,
    version: version ? `v${version}` : undefined,
  })
  if (status === 200 && data.success) {
    console.log(data.active_version)
    console.error(`✅ Promoted ${tenant} to v${data.active_version} on production`)
    console.error(`   Live URL: https://${tenant}.workers.dev`)
  } else {
    console.error(`❌ Promotion failed: ${JSON.stringify(data)}`)
    process.exit(1)
  }
}

async function cmdDeploy() {
  if (!tenant || !arg3) { console.error('Usage: edgegde deploy <tenant> <fig-path> [note]'); process.exit(1) }
  const figPath = arg3
  const note = arg4 || 'Hermes Pipeline Deploy'

  console.error(`Extracting layout from ${figPath}...`)
  const proc = Bun.spawnSync(['bun', 'open-pencil', 'export', '-f', 'layout_def', figPath], {
    cwd: process.cwd(),
  })
  if (proc.exitCode !== 0) {
    console.error(`❌ Extraction failed: ${proc.stderr.toString()}`)
    process.exit(1)
  }
  const layoutPayload = proc.stdout.toString().trim()

  console.error(`Deploying ${tenant} (${layoutPayload.length} chars)...`)
  const { status, data } = await apiPost('/deploy', {
    tenant_id: tenant,
    layout_payload: layoutPayload,
    version_note: note,
  })
  if (status === 200 && data.success) {
    console.log(`${data.version} ${data.staging_url}`)
    console.error(`✅ Deployed ${tenant} ${data.version} to staging`)
    console.error(`   Staging URL: ${data.staging_url}`)
  } else {
    console.error(`❌ Deploy failed: ${JSON.stringify(data)}`)
    process.exit(1)
  }
}

async function cmdRollback() {
  if (!tenant || !arg3) { console.error('Usage: edgegde rollback <tenant> <version>'); process.exit(1) }
  const version = `v${arg3}`
  console.error(`Rolling back ${tenant} to ${version}...`)
  const { status, data } = await apiPost('/rollback', {
    tenant_id: tenant,
    version,
  })
  if (status === 200 && data.status === 'success') {
    console.error(`✅ Rolled back ${tenant} to ${version}`)
  } else {
    console.error(`❌ Rollback failed: ${JSON.stringify(data)}`)
    process.exit(1)
  }
}

async function cmdStatus() {
  if (!tenant) { console.error('Usage: edgegde status <tenant>'); process.exit(1) }
  const resp = await fetch(`${BASE}/diff?tenant_id=${tenant}&v1=v1&v2=v1&token=${TOKEN}`)
  const data = await resp.json()
  console.error(`Status for ${tenant}:`)
  console.error(`  Production KV keys exist for this tenant`)
  console.log(JSON.stringify(data, null, 2))
}

const commands: Record<string, () => Promise<void>> = {
  promote: cmdPromote,
  deploy: cmdDeploy,
  rollback: cmdRollback,
  status: cmdStatus,
}

if (!commands[command]) {
  console.error(`Usage: EDGEGDE_MCP_TOKEN=<token> bun scripts/edgegde.ts <command>`)
  console.error(`Commands: promote, deploy, rollback, status`)
  process.exit(1)
}

commands[command]().catch((err) => {
  console.error(`Unhandled error: ${err.message}`)
  process.exit(1)
})
