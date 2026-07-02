/**
 * Math Tutor PWA — EdgeGDE Route
 *
 * Serves the Math Tutor PWA at /ai-tutor/
 * Static assets are copied to apps/edge-runtime/public/ai-tutor/
 * by `apps/ai-tutor/scripts/copy-static.mjs`.
 */
import { Hono } from 'hono'
import type { Env } from '../lib/env'

const router = new Hono<{ Bindings: Env }>()

// Serve index.html for /ai-tutor and /ai-tutor/
router.get('/', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head><meta http-equiv="refresh" content="0;url=/ai-tutor/index.html"></head>
<body><a href="/ai-tutor/index.html">Math Tutor</a></body>
</html>`)
})

// Everything else is served from static assets
export { router as aiTutorRouter }
