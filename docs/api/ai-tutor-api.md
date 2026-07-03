# AI Tutor API Reference

**Base URL:** `https://edgegde-calculator.renleding.workers.dev/api/tutor/math`  
**Auth:** None (public endpoints, rate-limited)  
**Format:** JSON request/response

---

## POST /ask

Send a question to the maths tutor.

### Request

```json
{
  "message": "How do I calculate the area of a circle?",
  "context": "Optional document context text (up to 4000 chars)",
  "tutor_subject": "maths-standard"
}
```

### Response

```json
{
  "response": "The area of a circle is πr²...",
  "working": "Step 1: Identify the radius...",
  "tip": "Remember: π ≈ 3.14159..."
}
```

### Errors
- `400` — `message` is required
- `500` — LLM API error

---

## POST /upload

Upload a reference document for the tutor to use as context.

### Request

`multipart/form-data` with a `file` field (`.pdf`, `.txt`, `.md`)

### Response

```json
{
  "id": "doc-1719876543210-a1b2",
  "name": "chapter2.pdf",
  "size": 15243,
  "stored": true
}
```

### Errors
- `400` — No file provided
- `500` — KV unavailable

---

## POST /test

Generate a practice test.

### Request

```json
{
  "count": 5,
  "topic": "Area"
}
```

### Response

```json
{
  "testId": "test-1719876543210-a1b2c3d4",
  "questions": [
    {
      "question": "What is the area of a rectangle 7cm by 12cm?",
      "type": "multiple-choice",
      "options": ["19 cm²", "84 cm²", "84 cm", "72 cm²"],
      "answer": "84 cm²"
    }
  ]
}
```

### Notes
- `count` is clamped to 1–20
- `topic` is optional; omit for mixed topics
- Response includes the correct `answer` for each question (use with `/score`)

---

## POST /score

Evaluate student answers against correct answers.

### Request

```json
{
  "questions": [{ "question": "...", "type": "multiple-choice", "options": [...], "answer": "..." }],
  "answers": ["84 cm²"]
}
```

### Response

```json
{
  "results": [
    {
      "questionIndex": 0,
      "question": "What is the area...",
      "correctAnswer": "84 cm²",
      "userAnswer": "84 cm²",
      "isCorrect": true,
      "type": "multiple-choice"
    }
  ],
  "score": 1,
  "total": 1,
  "percentage": 100
}
```

### Notes
- Multiple-choice: exact match (case-insensitive, trimmed)
- Short-answer/extended: evaluated by LLM for semantic correctness
- If LLM evaluation fails, `needsReview: true` is set instead

---

## POST /save-result

Persist a completed test result for cross-device history.

### Request

```json
{
  "studentId": "s-abc123...",
  "testId": "test-1719876543210-a1b2c3d4",
  "topic": "Area",
  "questions": [...],
  "answers": ["84 cm²"],
  "results": [...],
  "score": 1,
  "total": 1,
  "percentage": 100
}
```

### Response

```json
{ "saved": true, "testId": "test-1719876543210-a1b2c3d4" }
```

---

## GET /results/:studentId

Get all test summaries for a student.

### Response

```json
{
  "tests": [
    {
      "testId": "test-1719876543210-a1b2c3d4",
      "topic": "Area",
      "score": 1,
      "total": 1,
      "percentage": 100,
      "timestamp": 1719876543210
    }
  ]
}
```

### Notes
- Returns latest 50 entries
- Ordered chronologically (newest last)

---

## GET /test/:testId

Get the full detail of a specific test, including all questions and answers.

### Response

```json
{
  "testId": "test-1719876543210-a1b2c3d4",
  "topic": "Area",
  "score": 1,
  "total": 1,
  "percentage": 100,
  "timestamp": 1719876543210,
  "questions": [...],
  "answers": ["84 cm²"],
  "results": [...]
}
```

### Errors
- `404` — Test not found
