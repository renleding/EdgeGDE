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
- Respond in JSON: {"answer": "...", "working": "...", "tip": "...", "diagram": "..."}
- working should show step-by-step reasoning
- tip should be a practical learning suggestion
- If the student uploads a document, use it as context for explanations
- Follow the NSW Mathematics Standard Stage 6 syllabus
- Format equations using KaTeX notation (e.g., $$x = \\\\frac{-b \\\\pm \\\\sqrt{b^2 - 4ac}}{2a}$$)
- For geometry, graphing, step-by-step logic, or any concept that benefits from a diagram,
  include a "diagram" field with a Mermaid.js definition string
- Use these Mermaid diagram types:
  * graph TD or flowchart for geometry, triangles, angles, problem-solving flows
  * xy-chart for linear/quadratic/trig graphs
  * pie for statistical distributions
  * gantt for study schedules
- Example diagram for triangle area: "graph TD\\n  A[Triangle] --> B[Base = 7cm]\\n  A --> C[Height = 12cm]\\n  B --> D[Area = 0.5 x 7 x 12]\\n  D --> E[42 cm2]"
- Example diagram for line graph: "xyChart\\n  x-axis \"x\"\\n  y-axis \"y\"\\n  line \"y = 2x + 1\"\\n  data [1, 3, 5, 7, 9]"`

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
    // Attach a testId so frontend can reference it
    const testId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    return c.json({ ...result, testId })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// ── POST /api/tutor/score — Evaluate test answers ──
router.post('/score', async (c) => {
  try {
    const { questions, answers } = await c.req.json()
    if (!questions || !answers) {
      return c.json({ error: 'questions and answers required' }, 400)
    }

    // For each question, determine if the answer is correct
    const results = questions.map((q: any, i: number) => {
      const userAnswer = (answers[i] || '').trim()
      const correctAnswer = (q.answer || '').trim()

      // Multiple choice: exact match (case-insensitive, trimmed)
      if (q.type === 'multiple-choice') {
        return {
          questionIndex: i,
          question: q.question,
          correctAnswer,
          userAnswer,
          isCorrect: userAnswer.toLowerCase() === correctAnswer.toLowerCase(),
          type: q.type,
        }
      }

      // Short answer / extended: no direct comparison yet — will be LLM-evaluated below
      return {
        questionIndex: i,
        question: q.question,
        correctAnswer,
        userAnswer,
        isCorrect: false, // placeholder, re-evaluated via LLM below
        type: q.type,
      }
    })

    // Batch short-answer / extended questions to LLM for semantic evaluation
    const freeformQ = results.filter((r: any) => r.type !== 'multiple-choice' && r.userAnswer)
    if (freeformQ.length > 0) {
      const evalPrompt = `You are a maths tutor evaluating student answers. For each question, determine if the student's answer is mathematically correct (accept equivalent answers, allow minor phrasing differences, ignore units casing).

Respond in JSON: {"verdicts": [{"index": 0, "isCorrect": true}, ...]}

Questions and answers:
${freeformQ.map((r: any, idx: number) =>
  `Q${idx}: ${r.question}\nCorrect answer: ${r.correctAnswer}\nStudent answer: ${r.userAnswer}`
).join('\n\n')}`

      try {
        const evalResult = await callLLM(`You are a strict but fair maths tutor evaluator.`, evalPrompt, c.env)
        if (evalResult?.verdicts) {
          evalResult.verdicts.forEach((v: any) => {
            const freeIdx = freeformQ[v.index]?.questionIndex
            if (freeIdx != null && results[freeIdx]) {
              results[freeIdx].isCorrect = v.isCorrect === true
            }
          })
        }
      } catch {
        // LLM evaluation failed — mark all freeform as needing review
        freeformQ.forEach((r: any) => { results[r.questionIndex].needsReview = true })
      }
    }

    const score = results.filter((r: any) => r.isCorrect).length
    const total = questions.length
    const percentage = total > 0 ? Math.round((score / total) * 100) : 0

    return c.json({ results, score, total, percentage })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// ── POST /api/tutor/save-result — Save a completed test result to KV ──
router.post('/save-result', async (c) => {
  try {
    const { studentId, testId, topic, questions, answers, results, score, total, percentage } = await c.req.json()
    if (!studentId || !testId) {
      return c.json({ error: 'studentId and testId required' }, 400)
    }

    const kv = c.env.TENANT_KV as KVNamespace | undefined
    if (!kv) {
      return c.json({ error: 'KV not available' }, 500)
    }

    const timestamp = Date.now()
    const resultEntry = {
      testId,
      topic: topic || 'All Topics',
      score,
      total,
      percentage,
      timestamp,
      questions,
      answers,
      results,
    }

    // Store the full result
    await kv.put(`tutor:test:${testId}`, JSON.stringify(resultEntry), {
      metadata: { studentId, topic: topic || 'All Topics', score, total, timestamp },
    })

    // Update the student's test index
    const indexKey = `tutor:student:${studentId}`
    const existingRaw = await kv.get(indexKey)
    const index: any[] = existingRaw ? JSON.parse(existingRaw) : []
    index.push({ testId, topic: topic || 'All Topics', score, total, percentage, timestamp })
    // Keep only latest 50 entries
    if (index.length > 50) index.splice(0, index.length - 50)
    await kv.put(indexKey, JSON.stringify(index))

    return c.json({ saved: true, testId })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// ── GET /api/tutor/results/:studentId — Get test history ──
router.get('/results/:studentId', async (c) => {
  try {
    const { studentId } = c.req.param()
    const kv = c.env.TENANT_KV as KVNamespace | undefined
    if (!kv) return c.json({ tests: [] })

    const indexKey = `tutor:student:${studentId}`
    const raw = await kv.get(indexKey)
    if (!raw) return c.json({ tests: [] })

    const tests = JSON.parse(raw)
    return c.json({ tests })
  } catch {
    return c.json({ tests: [] })
  }
})

// ── GET /api/tutor/test/:testId — Get a specific test result ──
router.get('/test/:testId', async (c) => {
  try {
    const { testId } = c.req.param()
    const kv = c.env.TENANT_KV as KVNamespace | undefined
    if (!kv) return c.json({ error: 'KV not available' }, 500)

    const raw = await kv.get(`tutor:test:${testId}`)
    if (!raw) return c.json({ error: 'Test not found' }, 404)

    return c.json(JSON.parse(raw))
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// ── GET /api/tutor/progress ──
router.get('/progress', async (c) => {
  // Return basic dashboard metrics
  return c.json({
    mastery: 0,
    time_on_task: 0,
    test_count: 0,
    streak_days: 0,
    mastery_chart: '20, 45, 60, 30, 15',
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
