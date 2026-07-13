/**
 * SDLC UI Routes — Stub
 * Minimal implementation to satisfy the import in index.ts
 * Full implementation will be merged via SDLC UI Phase 3 PR
 */

import { Hono } from 'hono'

export const sdlcRouter = new Hono()

sdlcRouter.get('/', (c) => c.text('SDLC UI — placeholder. Full implementation pending Phase 3 merge.', 200))
