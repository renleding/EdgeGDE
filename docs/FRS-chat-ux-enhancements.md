# EdgeGDE Chat UX Enhancements — Functional Requirements Specification

**Document ID:** FRS-CHAT-UX-001  
**Version:** 1.1  
**Status:** Draft → Implemented  
**Based on:** Production conversation review with alpha-broker-01 tenant

---

## 1. Objective

Enhance the EdgeGDE chat widget from a working but unpolished data-collection interface into a production-quality conversational UX. Four areas targeted:

- **P1:** Post-completion next steps — what happens after all fields are collected
- **P2:** Validation UX — helpful error messaging and fuzzy matching
- **P3:** Session summary — show what was collected
- **P4:** Input state transition — graceful completion state

---

## 2. Current Baseline

### What Works

| Feature | Status | Detail |
|---------|--------|--------|
| Field collection | ✅ | 10 fields collected in priorityOrder |
| Validation | ✅ | Select field validation, email format check |
| SSE streaming | ✅ | `event: complete` + `data: {...}` per message |
| Name extraction | ✅ | `firstName` and `fullName` in response |
| Scoring trigger | ✅ | `triggerScoring()` fires on phase='complete' |
| Error rendering | ✅ | Widget shows error messages as bot bubbles |

### What's Missing

| Gap | User Impact | P-Level |
|-----|-------------|---------|
| No next-steps message after completion | User asks "what is next?" → meaningless response | P1 |
| Cold validation errors | "must be one of: A, B, C" — no suggestion | P2 |
| No summary of collected data | User can't verify what was captured | P3 |
| Input stays active after completion | User keeps typing into a completed session | P4 |

---

## 3. Requirements

### P1: Post-Completion Next Steps

**Current behavior:**
```
User: "dave bun"
Bot:  "Thanks, I've captured that. Please provide email."
...
User: "no"
Bot:  "Thanks, I've captured that. All details are collected."
User: "what is next?"
Bot:  "Thanks, I've captured that."     ← meaningless
```

**Target behavior:**
```
User: "no"
Bot:  "Thank you, Dave. Your application has been submitted.
      
      What happens next:
      1. A broker will review your details within 24 hours
      2. You'll receive a confirmation at dave@test.com
      3. We may call you at 0412345678 if we need more info
      
      Your application reference: APP-20260701-8F3A2
      
      [input bar disabled] Application complete ✓"
```

**Requirements:**

| # | Requirement | Verification |
|---|-------------|-------------|
| P1.1 | When `state.phase === 'complete'`, stream sends a closing message with next steps | `parsed.message` contains "broker" and "review" or equivalent |
| P1.2 | Closing message includes the applicant's first name | `message` contains the collected `firstName` |
| P1.3 | Closing message mentions the contact email/phone collected | `message` references collected fields |
| P1.4 | Widget disables input and send button on completion | `tx.disabled === true` and `sendBtn.disabled === true` |
| P1.5 | `triggerScoring()` fires before the completion message is sent | Scoring function called with all collected data |
| P1.6 | Widget shows a visual "Application complete" state | Input placeholder changes to "Application complete ✓", button shows checkmark |

**Sequence diagram:**
```
Widget                  Stream Endpoint           Scoring          D1
  │                         │                       │               │
  │── POST /chat/stream ───→│                       │               │
  │   (session_id, text)    │                       │               │
  │                         │── inferFieldUpdate() ─→│               │
  │                         │   (all fields done)    │               │
  │                         │── triggerScoring() ───→│               │
  │                         │   (sessionId, data)    │── INSERT ───→│
  │                         │← ok ───────────────────│               │
  │                         │── UPDATE D1 state ──────────────────→│
  │                         │← ok ─────────────────────────────────│
  │← event: complete ──────│                       │               │
  │← data: {done, message, │                       │               │
  │   state: {phase:       │                       │               │
  │   'complete'},          │                       │               │
  │   firstName: 'Dave'}    │                       │               │
  │                         │                       │               │
  │[Widget disables input]  │                       │               │
```

---

### P2: Validation UX Improvements

**Current behavior:**
```
User: "house"
Bot:  "Property Type must be one of: Owner-occupied, Investment, Refinance"
User: "owner"
Bot:  "Property Type must be one of: Owner-occupied, Investment, Refinance"
```

**Target behavior:**
```
User: "house"
Bot:  "I didn't recognize 'house'. Did you mean one of these?
      • Owner-occupied   • Investment   • Refinance
      
      (Tap one above or type the full option name)"
```

**Requirements:**

| # | Requirement | Verification |
|---|-------------|-------------|
| P2.1 | Error messages include user's input: "I didn't recognize 'X'" | Error message contains the user's typed value |
| P2.2 | Error messages suggest the available options | Message lists available options |
| P2.3 | Fuzzy matching: "house" → suggest "Owner-occupied" | Levenshtein or prefix matching maps partial input to closest option |
| P2.4 | "owner" matches "Owner-occupied", "investment" matches "Investment" | Case-insensitive prefix matching |
| P2.5 | Email validation gives specific error: "missing @" or "missing domain" | Distinct error messages for different email validation failures |
| P2.6 | Widget renders option pills on validation errors (tap to select) | Error message renders clickable option buttons |
| P2.7 | Number field validation gives range hints: "Annual Income must be between $0 and $10,000,000" | Error includes accepted range |

**Fuzzy matching algorithm:**
```
function fuzzyMatch(input: string, options: string[]): string | null {
  const normalized = input.toLowerCase().trim()
  // Exact match (case-insensitive)
  const exact = options.find(o => o.toLowerCase() === normalized)
  if (exact) return exact
  // Prefix match
  const prefix = options.find(o => o.toLowerCase().startsWith(normalized))
  if (prefix) return prefix
  // Contains match  
  const contains = options.find(o => o.toLowerCase().includes(normalized))
  if (contains) return contains
  // Levenshtein within 2 edits
  // ... (future enhancement)
  return null
}
```

---

### P3: Session Summary Display

**Target UI (ASCII):**
```
┌─────────────────────────────────────┐
│         Application Summary          │
│                                      │
│  Full Name          Dave Bun         │
│  Email              dave@test.com    │
│  Phone              0412345678       │
│  Employment Status  Employed         │
│  Annual Income      $100,000         │
│  Loan Amount        $1,000,000       │
│  Property Value     $1,100,000       │
│  Property Type      Owner-occupied   │
│  Dependants         Yes              │
│  Existing Mortgage  No               │
│                                      │
│  Reference: APP-20260701-8F3A2       │
│  Submitted: 01 Jul 2026, 2:30 PM     │
│                                      │
│  ┌─────────────────────────────────┐ │
│  │  Your application has been      │ │
│  │  submitted. A broker will       │ │
│  │  contact you within 24 hours.   │ │
│  └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

**Requirements:**

| # | Requirement | Verification |
|---|-------------|-------------|
| P3.1 | On completion, widget renders a summary card showing all 10 fields | DOM contains a `.summary-card` element with field label:value pairs |
| P3.2 | Number fields are formatted with $ and commas | `$1,000,000` not `1000000` |
| P3.3 | Summary includes a reference number | Random 8-char hex generated and displayed |
| P3.4 | Summary includes a submission timestamp | Formatted in local timezone |
| P3.5 | Summary card is scrollable within the chat body | overflow-y: auto on summary container |
| P3.6 | Field labels match the config definitions (not internal fieldNames) | "Full Name" not "fullName", "Employment Status" not "employmentStatus" |

---

### P4: Input State Transition

**Target behavior:**
```
Before completion:
  [Type a message...                    ] [→]

After completion:
  [Application complete ✓               ] [✓]  ← both disabled
```

**Requirements:**

| # | Requirement | Verification |
|---|-------------|-------------|
| P4.1 | When `state.phase === 'complete'`, widget sets `tx.disabled = true` | Input element `disabled` property is true |
| P4.2 | Send button is also disabled | `sendBtn.disabled` is true |
| P4.3 | Input placeholder changes to "Application complete" | Placeholder text updated |
| P4.4 | Send button text changes from "→" to "✓" | Button textContent is "✓" |
| P4.5 | CSS class `.chat-complete` added to the chat container | DOM element has class `chat-complete` |
| P4.6 | Completed state persists across page reload (session stored as complete) | D1 status column = 'complete' on reload |
| P4.7 | History remains scrollable and readable | Message list still interactive |

**State machine:**
```
IDLE → INITIALIZING → COLLECTING → COMPLETE
  │         │             │            │
  │      input disabled   │            │
  │         │         input enabled    │
  │         │         typing allowed   │ input disabled
  │         │         send enabled     │ button shows ✓
  │         │             │            │ summary card shown
  └─────────┴─────────────┴────────────┘
```

---

## 4. Acceptance Criteria

| # | Criterion | P-Level | Test |
|---|-----------|---------|------|
| AC1 | After all 10 fields collected, bot sends next-steps message with firstName | P1 | E2E-08c extended: verify final message contains "Dave" and "broker" |
| AC2 | Input disabled after phase='complete' | P1 | WIDGET-07a: verify tx.disabled after completion |
| AC3 | Send button disabled after phase='complete' | P1 | WIDGET-07b: verify sendBtn.disabled after completion |
| AC4 | Validation error includes user input and suggestions | P2 | E2E-09a: send "house" → error mentions "Owner-occupied" |
| AC5 | Fuzzy match maps "owner" → "Owner-occupied" | P2 | E2E-09b: "owner" accepted as valid field value |
| AC6 | Email validation distinguishes missing @ vs missing domain | P2 | E2E-09c: "test@" → specific error about missing domain |
| AC7 | Summary card rendered with all 10 fields | P3 | WIDGET-07c: DOM contains .summary-card with 10 field entries |
| AC8 | Number fields formatted with $ and commas | P3 | WIDGET-07d: "$100,000" not "100000" |
| AC9 | Input placeholder changes to "Application complete" | P4 | WIDGET-07e: placeholder text updated |
| AC10 | Send button shows "✓" after completion | P4 | WIDGET-07f: button text is "✓" |
| AC11 | All 598 backend + 27 widget + all widget e2e tests pass | ALL | `bun run test:unit && bun run test:widget` |

---

## 5. Implementation Phases

### Phase 1: Backend — Completion Message + Validation

1. Update `buildChatDoneMessage()` in `chat.ts` to generate next-steps message when phase='complete'
2. Add fuzzy matching to `inferFieldUpdate()` in `chat-constraint.ts`
3. Add specific email error messages
4. Ensure `triggerScoring()` fires before completion message is enqueued

### Phase 2: Widget — Completion State + Summary

1. Add `if (complete) disable input, update placeholder, update button` to widget stream handler
2. Render summary card from collected data when `phase === 'complete'`
3. Format number fields with locale string

### Phase 3: Validation UX

1. Update error message template to include suggestions
2. Render option pills on validation errors
3. Add CSS for completion state styling

---

## 6. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Summary card breaks mobile layout | Low | Medium | Use existing CSS grid classes, test on 320px viewport |
| Fuzzy matching accepts wrong field | Medium | Low | Always let the backend validate — fuzzy match is a suggestion, not an override |
| Completion message hardcoded to English | Low | Low | Future: support configurable completion message per tenant |
| Widget becomes too complex | Low | Medium | Keep widget.js under 250 lines. Extract summary rendering to helper functions |
