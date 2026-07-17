# FRS-005: Auto-Workflow — Browser Recording → Automated Playwright Scripts

Version: 1.0.0
Status: Draft for review
Date: 2026-07-17

---

## Objective

A Chrome extension that silently watches user interactions, detects repeatable workflows, and generates optimised Playwright scripts. The user does nothing except their normal work. The extension identifies patterns ("you downloaded a Broker Accreditation Form 3 times this week"), generates a script, and offers to schedule it.

Target: single power-user (broker, ops analyst, admin) who repeats the same browser tasks weekly — downloading lender docs, checking portal statuses, filling forms.

---

## FRS-1: Chrome Extension — Interaction Recorder

### Objective

Record all user interactions in Chrome via CDP without perceptible performance impact. Store them as compressed event sequences for offline analysis.

### Functional Requirements

**FR-1.1** — The extension SHALL connect to the page's CDP session via `chrome.debugger` API and subscribe to:

```
Input.dispatchMouseEvent
Input.dispatchKeyEvent
Page.navigatedWithinDocument
Page.frameNavigated
Network.requestWillBeSent (subset: form POSTs, API calls)
Runtime.executionContextCreated (SPA navigation detection)
```

**FR-1.2** — Recording SHALL be scoped per-origin with user-visible indicator (badge icon turns red when recording is active for that tab).

**FR-1.3** — Events SHALL be grouped into **sessions** — contiguous activity on one origin with gaps < 5 minutes between events. A session becomes a "candidate workflow" when repeated 3+ times with >70% structural similarity.

**FR-1.4** — The extension SHALL NOT record:
- Password input values (Chrome's `Input.dispatchKeyEvent` marks password fields)
- Credit card / payment form fields
- URLs containing known secret patterns (tokens, API keys)
- Content from incognito windows

**FR-1.5** — Recordings SHALL be stored locally in IndexedDB, compressed (gzip), and aged out after 14 days. Only "detected workflows" are uploaded to the local processing service.

### Acceptance Criteria

- [ ] Extension installs from `.crx` or Chrome Web Store as developer mode
- [ ] Badge shows recording status per tab
- [ ] 3 repeated download sequences on the same lender library → "Candidate workflow detected" notification
- [ ] Recording adds <50ms latency to any user interaction
- [ ] No credential values stored in event logs

### Verification

```bash
# Load unpacked extension
open -a "Google Chrome" --args --load-extension=./extension/dist/

# Open DevTools → chrome://extensions → Inspect views background page
# Check IndexedDB for recorded sessions
```

---

## FRS-2: Workflow Detection Engine

### Objective

Analyse recorded sessions, identify repeatable patterns, generalise variable parts. This runs as a local service (Go binary or Node.js process) that the extension talks to.

### Functional Requirements

**FR-2.1** — The detection engine SHALL compare sequences using edit-distance on action types (click, type, navigate, select). Two sequences match when >70% of actions align.

**FR-2.2** — Variable detection: when two matching sequences differ on a typed value (e.g. "Gateway Bank" vs "Bendigo Bank"), the differing value SHALL be extracted as a variable. The LLM labels it:

```
input "Gateway Bank" → input "${lenderName}"  // labelled by LLM
```

**FR-2.3** — Detected workflows SHALL be scored by:
- **Frequency** (higher = more value to automate)
- **Duration** (longer = more time saved)
- **Stability** (identical across all repetitions = easier to automate)

**FR-2.4** — The engine SHALL produce a **Puppeteer Replay JSON** recording for each detected workflow — this is the interchange format before LLM optimisation.

### Acceptance Criteria

- [ ] 3 recordings of "search lender → download document" produce a single detected workflow
- [ ] Variable detection replaces hardcoded lender names with `${lenderName}`
- [ ] Workflow scoring ranks a weekly 5-minute task above a daily 30-second task
- [ ] Output is valid Puppeteer Replay JSON (Google's format)

### Verification

```bash
# Feed 3 recorded sessions
./detect --input ./recordings/session-*.jsonl --output ./workflows/

# Inspect output
cat ./workflows/gateway-bank-download.json | python3 -m json.tool
```

---

## FRS-3: LLM Optimisation Pipeline

### Objective

Take the detected workflow (Puppeteer Replay JSON) and produce a production-ready Playwright TypeScript spec with stable selectors, env vars, and proper error handling.

### Functional Requirements

**FR-3.1** — The LLM prompt SHALL receive:
- Raw Puppeteer Replay JSON
- Page HTML snapshot (captured during recording)
- List of detected variables with descriptions

**FR-3.2** — The LLM SHALL output a complete `.spec.ts` file with:
- `role=` or `data-testid` selectors (never class-name selectors)
- `process.env.*` for all detected variables
- `waitForSelector` / `waitForURL` for reliability
- JSDoc comment describing the workflow

**FR-3.3** — The output SHALL be type-checked (`npx tsc --noEmit`) before being offered to the user.

**FR-3.4** — The optimisation cost SHALL be tracked per-workflow and displayed to the user: "Cost to generate: $0.03"

### Acceptance Criteria

- [ ] Raw Puppeteer Replay JSON → valid `.spec.ts` file
- [ ] All class-name selectors replaced with role/attribute selectors
- [ ] TypeScript compilation passes with zero errors
- [ ] All variables replaced with `process.env.*` references
- [ ] Each generated script includes a clear `test.describe` block

### Verification

```bash
# Generate script from detection
llm-optimise workflow.json > workflow.spec.ts
npx tsc --noEmit --strict workflow.spec.ts
```

---

## FRS-4: User Review + Deployment

### Objective

Present the generated script to the user for review. Let them one-click approve, edit, or reject. Approved scripts are stored and can be scheduled or triggered.

### Functional Requirements

**FR-4.1** — The extension SHALL show a notification: *"Workflow detected: Download lender documents (3 times this week). Generate automation?"*

**FR-4.2** — On approval, the script SHALL be added to the user's script library with:
- Name (auto-generated, editable)
- Trigger (manual / schedule / on-detection)
- Last run status
- Edit button that opens the `.spec.ts` in VS Code

**FR-4.3** — The extension SHALL provide a dashboard page showing:
- All detected workflows (status: pending/approved/rejected)
- Run history (pass/fail/timing)
- Time saved estimate: "Automated 4 tasks, saved ~18 min this week"

**FR-4.4** — Running a script SHALL use the EdgeGDE Droid runner pattern:
```
BROWSER_EVIDENCE_DIR=./evidence npx playwright test workflow.spec.ts
```
Results (pass/fail, trace, screenshot) are stored locally.

### Acceptance Criteria

- [ ] Notification appears for candidate workflow within 30 seconds of detection
- [ ] User can approve/edit/reject from the extension popup
- [ ] Approved scripts run on schedule without user intervention
- [ ] Dashboard shows time-saved metric

### Verification

```bash
# Script is stored and runnable
ls ~/.auto-workflow/scripts/
npx playwright test ~/.auto-workflow/scripts/gateway-bank.spec.ts
```

---

## FRS-5: Privacy & Security

### Objective

Ensure no sensitive data leaves the user's machine. All recording, detection, LLM processing, and execution is local.

### Functional Requirements

**FR-5.1** — All data processing SHALL happen on-device:
- Recording → IndexedDB (local)
- Detection → local Go/Node service (localhost only)
- LLM optimisation → local Ollama (default) or configurable remote API key
- Script execution → local Playwright

**FR-5.2** — Password fields SHALL be scrubbed at the CDP event level (Chrome marks `type=password` input events). The recorded sequence stores `[PASSWORD]` not the typed value.

**FR-5.3** — The extension SHALL NOT have network permissions to any external domain except:
- `localhost` (for the detection service)
- Chrome Web Store (for updates)
- Configurable LLM API endpoint (user's choice)

**FR-5.4** — All data SHALL be deletable from the dashboard with a single "Clear all data" button.

### Acceptance Criteria

- [ ] Network tab in DevTools shows zero requests to external domains during recording
- [ ] Recorded session files contain no plaintext password values
- [ ] "Clear all data" empties IndexedDB, deletes scripts, resets all state
- [ ] Offline mode: full functionality with zero internet connectivity

### Verification

```bash
# Test offline
sudo ifconfig en0 down
npx playwright test workflow.spec.ts  # Should pass (all local)
sudo ifconfig en0 up
```

---

## Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Extension | Chrome Extensions MV3 + `chrome.debugger` API | CDP access, MV3 for manifest v3 compliance |
| Detection Engine | Go binary (or Node.js) | Performance (Levenshtein on 10K+ event sequences) |
| LLM Optimisation | Ollama (local) / OpenRouter API | Local-first default; API key for quality |
| Script Execution | Playwright (TypeScript) | Our stack, deterministic, trace viewer |
| Storage | IndexedDB (extension) + local filesystem (scripts) | Zero cloud dependency |
| Dashboard | Extension popup + optional local web UI | Simple, no PWA complexity |

## User Flow (Test User)

1. Install the extension
2. Go about normal work — browse Salestrekker, download Gateway Bank forms, check lender docs
3. Do the same workflow 3 times over the week
4. Day 5: extension badge shows **"3"** — 3 candidate workflows detected
5. Click extension → *"Download lender documents — 3 times this week"*
6. Click **Generate** → 5 seconds later → *"Script ready for review"*
7. Review the generated `.spec.ts` — edit lender name to variable `lenderName`
8. Click **Schedule** → runs every Monday 9am
9. Next Monday: script runs, downloads new forms, moves them to correct folders
10. Dashboard: *"Time saved this week: 12 min"*

## Open Questions

1. **Ollama model quality** — Can a local 7B model reliably label variables (e.g. "Gateway Bank" → `lenderName`)? If not, the default LLM API should be configurable.
2. **Chrome Web Store policy** — Extensions using `chrome.debugger` require "debugger" permission which triggers a warning on install. Acceptable for power-user tool but may limit distribution.
3. **Detection accuracy floor** — 70% structural similarity is a guess. What's the false-positive rate on free-form browsing (reading news, checking email)?
4. **Multipage workflows** — If the workflow spans 3 different origins (Salestrekker → lender portal → email), can the detection engine stitch them together? The session gap threshold handles page transitions but cross-origin stitching is harder.

## Resolved Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| PWA vs Extension | ✅ Chrome Extension | CDP access requires extension API, not available to PWAs |
| Cloud vs Local | ✅ 100% Local-first | Privacy sell is easier, offline works, no subscription cost for user |
| Playwright vs Puppeteer | ✅ Playwright | Export format aligns with FRS-004, TS-native, established in EdgeGDE |
| OSS vs Commercial | ✅ Commercial (MIT core, paid features) | Core recorder is MIT; scheduling, team sync, priority support are paid |

---

*End of FRS-005*
