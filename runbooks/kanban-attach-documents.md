# SOP: Attaching Documents to Kanban Tasks

**Purpose:** When you produce a research report, FRS, spec, or any deliverable document during a task, attach it to the Kanban task so it's findable from the dashboard.

**API base:** `http://localhost:9119`  
**Auth:** `X-Hermes-Session-Token` header (extracted from dashboard HTML)

---

## Step 1: Get the session token

```bash
TOKEN=$(curl -s http://localhost:9119/ | \
  grep -o '__HERMES_SESSION_TOKEN__="[^"]*"' | cut -d'"' -f2)
AUTH=(-H "X-Hermes-Session-Token: $TOKEN")
BASE=http://localhost:9119
```

## Step 2: Upload the file

```bash
curl -s "${AUTH[@]}" -X POST "$BASE/api/plugins/kanban/tasks/TASK_ID/attachments" \
  -F "file=@/path/to/document.md" \
  -F "name=Human-Readable Name"
```

**Important:** Use `-F` (multipart form), NOT JSON body. JSON with `"file":"path"` fails.

## Step 3: Verify

```bash
curl -s "${AUTH[@]}" "$BASE/api/plugins/kanban/tasks/TASK_ID/attachments"
```

## Step 4: (Hermes agent only) Update the task summary

After attaching the document, update the task's `completed_at` summary to reference the attachment:

```bash
curl -s "${AUTH[@]}" -X PATCH "$BASE/api/plugins/kanban/tasks/TASK_ID" \
  -H "Content-Type: application/json" \
  -d '{"summary": "Done — see attached document.md for full report"}'
```

---

## Quick Script

```bash
# Paste this as a single block with TASK_ID and FILE_PATH set
TOKEN=$(curl -s http://localhost:9119/ | grep -o '__HERMES_SESSION_TOKEN__="[^"]*"' | cut -d'"' -f2)
AUTH=(-H "X-Hermes-Session-Token: $TOKEN")
BASE=http://localhost:9119

TASK_ID="t_aab2ed64"       # <-- SET THIS
FILE_PATH="docs/report.md"  # <-- SET THIS
FILE_NAME="Report Name"     # <-- SET THIS

curl -s "${AUTH[@]}" -X POST "$BASE/api/plugins/kanban/tasks/$TASK_ID/attachments" \
  -F "file=@$FILE_PATH" \
  -F "name=$FILE_NAME"
```

---

## Permissions

- Attachment DELETE is not supported via API (returns Method Not Allowed).
- To remove a stale attachment, delete it from the task detail view in the dashboard UI.
- Files are stored at `~/.hermes/kanban/boards/{board}/attachments/{task_id}/`.
