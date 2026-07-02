/**
 * Math Tutor API — EdgeGDE routes
 *
 * Endpoints:
 *   POST /api/tutor/math/ask            — Ask the maths tutor a question
 *   POST /api/tutor/math/upload         — Upload a reference document
 *   POST /api/tutor/math/test           — Generate a practice test
 *   GET  /api/tutor/math/progress       — Student progress overview
 *   GET  /api/tutor/math/progress/csv   — Export progress as CSV
 *
 * AI model: deepseek/deepseek-v4-flash via OpenRouter
 */
import { Hono } from 'hono'
import type { Env } from '../lib/env'

const router = new Hono<{ Bindings: Env }>()

// ── System Prompt ──
const TUTOR_SYSTEM_PROMPT = `You are a patient, encouraging NSW Mathematics Standard tutor for Year 10-12 students.

RULES:
- Always show working, never just the final answer
- Use positive reinforcement ("Well done!", "Great effort!", "You're building real momentum")
- After each solution, include a learning tip
- Respond in JSON: {"answer": "...", "working": "...", "tip": "..."}
- working should show step-by-step reasoning
- tip should be a practical learning suggestion
- If the student uploads a document, use it as context for explanations
- Follow the NSW Mathematics Standard Stage 6 syllabus
- Format equations using KaTeX notation (e.g., $$x = \\\\frac{-b \\\\pm \\\\sqrt{b^2 - 4ac}}{2a}$$)
- For geometry, describe the diagram in text that can be rendered as SVG`

// ── Helpers ──
function getApiKey(env: any): string {
  return env.OPENROUTER_API_KEY || ''
}

async function callLLM(systemPrompt: string, userMessage: string, env: any): Promise<any> {
  const apiKey = getApiKey(env)
  if (!apiKey) {
    return { answer: 'Tutor API key not configured.', working: '', tip: 'Ask your administrator to set OPENROUTER_API_KEY.' }
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://edgegde-calculator.renleding.workers.dev',
      'X-Title': 'EdgeGDE Math Tutor',
    },
    body: JSON.stringify({
      model: 'deepseek/deepseek-v4-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 4000,
    }),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => 'unknown')
    throw new Error(`LLM API error: ${response.status} — ${errText}`)
  }

  const data: any = await response.json()
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('LLM returned empty response')

  try {
    return JSON.parse(content)
  } catch {
    return { answer: content, working: '', tip: 'Break problems into smaller steps.' }
  }
}

// ── POST /api/tutor/ask ──
router.post('/ask', async (c) => {
  try {
    const { message, context } = await c.req.json()
    if (!message || typeof message !== 'string') {
      return c.json({ error: 'message is required' }, 400)
    }

    const userMessage = context
      ? `Document context:\n${context.slice(0, 4000)}\n\nStudent question: ${message}`
      : message

    const result = await callLLM(TUTOR_SYSTEM_PROMPT, userMessage, c.env)
    return c.json({
      response: result.answer || '',
      working: result.working || '',
      tip: result.tip || 'Keep practicing — you are building real skills.',
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// ── POST /api/tutor/upload ──
router.post('/upload', async (c) => {
  try {
    const formData = await c.req.formData()
    const file = formData.get('file') as File | null
    if (!file) return c.json({ error: 'No file provided' }, 400)

    const text = await file.text()
    const docId = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const key = `student:refs:${docId}`

    // Store parsed text in KV (up to 64KB)
    const kv = c.env.TENANT_KV as KVNamespace | undefined
    if (kv) {
      await kv.put(key, text.slice(0, 64000), {
        metadata: { name: file.name, type: file.type, uploaded: Date.now() },
      })
    }

    return c.json({ id: docId, name: file.name, size: text.length, stored: !!kv })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// ── POST /api/tutor/test ──
router.post('/test', async (c) => {
  try {
    const { count = 5, topic } = await c.req.json()
    const n = Math.min(Math.max(parseInt(count) || 5, 1), 20)

    const testPrompt = `Generate a ${n}-question NSW Mathematics Standard practice test${topic ? ` on ${topic}` : ''}.
Include a mix of multiple-choice, short answer, and extended response questions.
Respond in JSON: {"questions": [{"question": "...", "type": "multiple-choice|short-answer|extended", "options": ["A", "B", "C", "D"], "answer": "..."}]}`

    const result = await callLLM(TUTOR_SYSTEM_PROMPT, testPrompt, c.env)
    return c.json(result)
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// ── GET /api/tutor/progress ──
router.get('/progress', async (c) => {
  // Return default values — D1 integration TBD
  return c.json({
    mastery: 0,
    time_on_task: 0,
    test_count: 0,
    streak_days: 0,
  })
})

// ── GET /api/tutor/progress/csv ──
router.get('/progress/csv', async (c) => {
  const csv = 'subject,topic,mastery,time_min,test_count,streak_days\nmaths-standard,all,0,0,0,0\n'
  return new Response(csv, {
    headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="math-tutor-progress.csv"' },
  })
})

export { router as aiTutorApiRouter }
