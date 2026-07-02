/**
 * AI Tutor Route — EdgeGDE Route
 *
 * Serves the AI Tutor hub at /ai-tutor/ and individual tutors under
 * /ai-tutor/<subject>/ (e.g. /ai-tutor/math/).
 *
 * Static assets are copied to apps/edge-runtime/public/ai-tutor/
 * by `apps/ai-tutor/scripts/copy-static.mjs`.
 */
import { Hono } from 'hono'
import type { Env } from '../lib/env'

const router = new Hono<{ Bindings: Env }>()

// Serve /ai-tutor and /ai-tutor/ — redirects to the hub
router.get('/', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head><meta http-equiv="refresh" content="0;url=/ai-tutor/index.html"></head>
<body><a href="/ai-tutor/index.html">AI Tutor Hub</a></body>
</html>`)
})

// Serve /ai-tutor/math and /ai-tutor/math/ — redirects to the math tutor
router.get('/math', (c) => c.redirect('/ai-tutor/math/index.html', 302))
router.get('/math/', (c) => c.redirect('/ai-tutor/math/index.html', 302))

export { router as aiTutorRouter }
