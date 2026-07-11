/**
 * EdgeGDE — Document Intelligence API Mount
 *
 * Mounts all doc-intel sub-routers under /api/v1/doc-intel.
 * Tenant routing via x-tenant header.
 *
 * Also exports the doc-intel UI router for top-level mounting at /doc-intel/.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import { ingestRouter } from './doc-intel/routes/ingest'
import { jobsRouter } from './doc-intel/routes/jobs'
import { searchRouter } from './doc-intel/routes/search'
import { documentsRouter } from './doc-intel/routes/documents'
import { docIntelUiRouter } from './doc-intel/ui-route'
import { uiRouter } from './doc-intel/routes/ui'

export const docIntelRouter = new Hono()

// Health check
docIntelRouter.get('/healthz', (c) => c.json({ status: 'ok', service: 'doc-intel' }))

// UI page at /api/v1/doc-intel/ui — full SPA from ui-route.ts
docIntelRouter.route('/ui', docIntelUiRouter)

// Ingest — accepts multipart file uploads
docIntelRouter.route('/', ingestRouter)

// Job lifecycle — M1 poller management
docIntelRouter.route('/', jobsRouter)

// Search + audit — document and audit queries
docIntelRouter.route('/', searchRouter)

// Document storage — R2 proxy for the M1 poller
docIntelRouter.route('/', documentsRouter)

// UI — embedded SPA for document browsing
docIntelRouter.route('/', uiRouter)

// Re-export the UI routers for mounting in index.ts
export { docIntelUiRouter, uiRouter }
