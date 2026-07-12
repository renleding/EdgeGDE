/**
 * EdgeGDE — Document Intelligence Module Index
 *
 * Exports all route handlers and shared libraries for the document
 * intelligence platform. Mounted under /api/v1/doc-intel in index.ts.
 *
 * @packageDocumentation
 */

export { ingestRouter } from './routes/ingest'
export { jobsRouter } from './routes/jobs'
export { searchRouter } from './routes/search'
export { uiRouter } from './routes/ui'

// Shared lib
export { resolveTenant, resolveBindings, errorBody, errorResponse, VALID_TENANTS } from './lib/errors'
export { resolveTenantBindings, queryFirst, queryAll, queryRun } from './lib/db'
export { writeAuditLog, auditStageStarted, auditStageCompleted, auditStageFailed } from './lib/audit'
export * from './lib/types'
