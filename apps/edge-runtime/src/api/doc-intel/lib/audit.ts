/**
 * EdgeGDE — Document Intelligence Audit Log Writer
 *
 * Writes structured audit events to the per-tenant audit_log D1 table.
 * Policy-enforced: only inserts, no updates or deletes.
 *
 * @packageDocumentation
 */

import type { D1Database } from '@cloudflare/workers-types'
import type { AuditStage, AuditStatus } from './types'

interface AuditEntry {
  audit_id: string
  workflow_id: string
  document_id: string | null
  client_id: string | null
  profile_id: string | null
  skill_id: string | null
  tenant_id: string
  stage: string
  status: string
  actor: string
  duration_ms: number | null
  before_state: string | null
  after_state: string | null
}

/**
 * Write an audit log entry.
 * Fire-and-forget: failures are logged but never throw.
 */
export async function writeAuditLog(
  db: D1Database,
  entry: Omit<AuditEntry, 'audit_id'>,
): Promise<void> {
  try {
    const auditId = crypto.randomUUID()
    await db.prepare(
      `INSERT INTO audit_log (
        audit_id, workflow_id, document_id, client_id, profile_id,
        skill_id, tenant_id, stage, status, actor,
        duration_ms, before_state, after_state, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`
    ).bind(
      auditId,
      entry.workflow_id,
      entry.document_id ?? null,
      entry.client_id ?? null,
      entry.profile_id ?? null,
      entry.skill_id ?? null,
      entry.tenant_id,
      entry.stage,
      entry.status,
      entry.actor,
      entry.duration_ms ?? null,
      entry.before_state ?? null,
      entry.after_state ?? null,
    ).run()
  } catch (err) {
    // Audit failure is non-blocking — log and continue
    console.error('[doc-intel:audit] write failed:', err)
  }
}

/**
 * Convenience: create a "stage started" audit event.
 */
export async function auditStageStarted(
  db: D1Database,
  tenantId: string,
  workflowId: string,
  stage: AuditStage,
  overrides?: Partial<Omit<AuditEntry, 'audit_id'>>,
): Promise<void> {
  return writeAuditLog(db, {
    workflow_id: workflowId,
    document_id: null,
    client_id: null,
    profile_id: null,
    skill_id: null,
    tenant_id: tenantId,
    stage,
    status: 'started',
    actor: 'system',
    duration_ms: null,
    before_state: null,
    after_state: null,
    ...overrides,
  })
}

/**
 * Convenience: create a "stage completed" audit event with duration.
 */
export async function auditStageCompleted(
  db: D1Database,
  tenantId: string,
  workflowId: string,
  stage: AuditStage,
  durationMs: number,
  afterState?: string,
  overrides?: Partial<Omit<AuditEntry, 'audit_id'>>,
): Promise<void> {
  return writeAuditLog(db, {
    workflow_id: workflowId,
    document_id: null,
    client_id: null,
    profile_id: null,
    skill_id: null,
    tenant_id: tenantId,
    stage,
    status: 'completed',
    actor: 'system',
    duration_ms: durationMs,
    before_state: null,
    after_state: afterState ?? null,
    ...overrides,
  })
}

/**
 * Convenience: create a "stage failed" audit event.
 */
export async function auditStageFailed(
  db: D1Database,
  tenantId: string,
  workflowId: string,
  stage: AuditStage,
  errorDetail: string,
  overrides?: Partial<Omit<AuditEntry, 'audit_id'>>,
): Promise<void> {
  return writeAuditLog(db, {
    workflow_id: workflowId,
    document_id: null,
    client_id: null,
    profile_id: null,
    skill_id: null,
    tenant_id: tenantId,
    stage,
    status: 'failed',
    actor: 'system',
    duration_ms: null,
    before_state: null,
    after_state: errorDetail,
    ...overrides,
  })
}
