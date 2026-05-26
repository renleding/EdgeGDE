/**
 * EdgeGDE Runtime — Registry Write Contract with Deploy Locks
 * Phase 23.1: Deploy locking, tenant layout set/promote/rollback.
 *
 * @packageDocumentation
 */

import type { KvStore } from './publish'
import {
  storeVersion,
  getVersion,
  getLatestVersion,
} from './versioning'

// ═══════════════════════════════════════════════════════════════════════════
// Lock Key Helper
// ═══════════════════════════════════════════════════════════════════════════

function lockKey(tenantId: string): string {
  return `lock:${tenantId}:deploy`
}

// ═══════════════════════════════════════════════════════════════════════════
// acquireDeployLock — try to acquire a deploy lock for a tenant
// ═══════════════════════════════════════════════════════════════════════════

export async function acquireDeployLock(
  kv: KvStore,
  tenantId: string,
): Promise<boolean> {
  const key = lockKey(tenantId)
  const existing = await kv.get(key)
  if (existing !== null) {
    return false // Already locked
  }
  await kv.put(key, '1')
  return true
}

// ═══════════════════════════════════════════════════════════════════════════
// releaseDeployLock — release a deploy lock for a tenant
// ═══════════════════════════════════════════════════════════════════════════

export async function releaseDeployLock(
  kv: KvStore,
  tenantId: string,
): Promise<void> {
  await kv.delete(lockKey(tenantId))
}

// ═══════════════════════════════════════════════════════════════════════════
// setTenantLayout — store a new layout version for a tenant
// ═══════════════════════════════════════════════════════════════════════════

export async function setTenantLayout(
  kv: KvStore,
  tenantId: string,
  payload: string,
  note?: string,
  env?: 'staging' | 'production',
): Promise<{ status: string; version: string; url: string }> {
  // 1. Acquire deploy lock
  const locked = await acquireDeployLock(kv, tenantId)
  if (!locked) {
    return { status: 'conflict', version: '', url: '' }
  }

  try {
    // 2. Store the version
    const result = await storeVersion(kv, tenantId, payload, note)

    // 3. If env is 'production', also update the production pointer
    if (env === 'production') {
      await kv.put(`layout:${tenantId}:production:latest`, result.version)
    }

    // 4. Construct URL
    const url = env === 'production'
      ? `${tenantId}.workers.dev`
      : `vnext.${tenantId}.workers.dev`

    return { status: 'success', version: result.version, url }
  } finally {
    // 5. Release deploy lock
    await releaseDeployLock(kv, tenantId)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// promoteToProduction — promote a staging version to production
// ═══════════════════════════════════════════════════════════════════════════

export async function promoteToProduction(
  kv: KvStore,
  tenantId: string,
  version?: string,
): Promise<{ status: string; active_version: string }> {
  // 1. Acquire deploy lock
  const locked = await acquireDeployLock(kv, tenantId)
  if (!locked) {
    return { status: 'conflict', active_version: '' }
  }

  try {
    // 2. Resolve version to promote
    const targetVersion = version ?? await getLatestVersion(kv, tenantId, 'staging')
    if (!targetVersion) {
      return { status: 'no_version_found', active_version: '' }
    }

    // 3. Verify version exists
    const payload = await getVersion(kv, tenantId, targetVersion)
    if (payload === null) {
      return { status: 'version_not_found', active_version: '' }
    }

    // 4. Set production:latest pointer
    await kv.put(`layout:${tenantId}:production:latest`, targetVersion)

    return { status: 'success', active_version: targetVersion }
  } finally {
    // 5. Release deploy lock
    await releaseDeployLock(kv, tenantId)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// rollbackTenantLayout — rollback production to a specific version
// ═══════════════════════════════════════════════════════════════════════════

export async function rollbackTenantLayout(
  kv: KvStore,
  tenantId: string,
  version: string,
): Promise<{ status: string }> {
  // 1. Acquire deploy lock
  const locked = await acquireDeployLock(kv, tenantId)
  if (!locked) {
    return { status: 'conflict' }
  }

  try {
    // 2. Verify version exists
    const payload = await getVersion(kv, tenantId, version)
    if (payload === null) {
      return { status: 'version_not_found' }
    }

    // 3. Set production:latest pointer
    await kv.put(`layout:${tenantId}:production:latest`, version)

    return { status: 'success' }
  } finally {
    // 4. Release deploy lock
    await releaseDeployLock(kv, tenantId)
  }
}
