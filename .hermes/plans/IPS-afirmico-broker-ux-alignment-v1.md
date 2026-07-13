# IPS: Afirmico Broker UX — Chat + Pipeline Alignment with UX Principles v2

**Version:** 1.0  
**Status:** Draft  
**Target:** EdgeGDE Worker (index.ts, widget.js, fragment.ts, broker_pipeline_view.json, EDR renderer)  
**FRS Source:** docs/ux-research/UX_PRINCIPLES_REPORT_v2.md, docs/FRS-SDLC-UI-IMPROVEMENT.md  
**Kanban:** EG-FEAT-0036  
**Audit findings:** docs/IPS/alphabet-broker-ux-audit.md  

---

## 1. Scope

Align the affirmco broker chat widget, fragment calculator/budget pages, broker pipeline view, and dashboard admin pages with UX Principles v2 — focusing on the 4 confirmed work items:

| # | Work Item | Priority | Principle(s) |
|---|---|---|---|
| W1 | **Loss framing for chat close** | P1 | Loss Aversion (FR-005) |
| W2 | **Decision fatigue — budget progressive disclosure** | P1 | Decision Fatigue (FR-006) |
| W3 | **Pipeline view progress visualization** | P1 | Progress Viz (FR-009), Goal Gradient |
| W4 | **Design token CSS alignment** | P2 | Visual Hierarchy (FR-010) |

---

## 2. W1 — Loss Framing for Chat Close

### 2.1 Current State
The chat widget close button (`#gde-close-btn`) immediately hides the chat with no confirmation. User loses their ongoing conversation with no warning.

### 2.2 Requirements
- When user clicks close while chat has messages (beyond welcome), show a loss-framed card
- Card text: "You'll lose this conversation" with items at risk: "Unanswered questions, inputted data"
- Dismiss button: "Close anyway" (red, "I'll risk it" framing)
- Cancel button: "Keep chatting" (green)
- If chat has only the welcome message, close immediately (no loss to incur)

### 2.3 Implementation
```javascript
// In widget.js / index.ts widget script
// Track if user has sent messages
var hasConversation = false;
// On send: hasConversation = true

// Close handler
gdeCloseBtn.onclick = function() {
  if (!hasConversation) { hideChat(); return; }
  showLossFrame(
    'You\'ll lose this conversation',
    ['Unanswered questions', 'Your inputted data'],
    'Close anyway',    // dismiss = "I'll risk it"
    'Keep chatting'    // keep
  );
};
```

### 2.4 CSS (design token aligned)
```css
.lf-overlay { /* matches doc-intel .lf */ }
.lf-card { /* matches doc-intel .lf-c */ }
.lf-title { /* matches doc-intel .lf-h */ }
.lf-items { /* matches doc-intel .lf-i */ }
.lf-dismiss { background: #da3633; /* btn-danger */ }
.lf-keep { background: #238636; /* btn-primary */ }
```

---

## 3. W2 — Budget Progressive Disclosure

### 3.1 Current State
The budget planner shows 6 expense categories (food, transport, utilities, insurance, entertainment, healthcare) + education, debt payments, other expenses — exceeding the Decision Fatigue max of 6 visible options.

### 3.2 Requirements
- Show max 6 categories by default
- Additional categories behind "Show more" progressive disclosure
- Default visible: salary, housing, food, transport, utilities, insurance
- Hidden: entertainment, healthcare, education, debt payments, other expenses, investments, government
- "Show more" link expands to reveal remaining categories
- State persists per session (cookies or memory)

### 3.3 Implementation
```html
<div class="budget-categories">
  <!-- 6 default visible -->
  <div class="budget-row visible">salary</div>
  <div class="budget-row visible">housing</div>
  <!-- ... -->
  <!-- Hidden behind disclosure -->
  <div class="budget-row collapsed">entertainment</div>
  <div class="budget-row collapsed">healthcare</div>
  <!-- Show more toggle -->
  <button id="show-more-btn" onclick="toggleBudgetFields()">
    Show more (5 hidden)
  </button>
</div>
```

### 3.4 HTMX Integration
The existing "Add Income" / "Add Expense" dynamic field system already supports progressive addition — but the base categories should be collapsed first.

---

## 4. W3 — Pipeline View Progress Visualization

### 4.1 Current State
`broker_pipeline_view.json` defines 3 stages (Intake, Assessment, Submission) as static badges with no visual progress.

### 4.2 Requirements
- Each pipeline stage shows a count badge (e.g., "3 in Intake")
- Pipeline stages connected with visual arrow/connector showing progression
- Active stage highlighted (current stage in pipeline)
- Completed stages shown with checkmark
- Progress ring or bar showing overall pipeline completion

### 4.3 EDR Component Spec
```json
{
  "type": "pipeline",
  "stages": ["Intake", "Assessment", "Submission"],
  "stageData": {
    "Intake": { "count": 3, "status": "active" },
    "Assessment": { "count": 1, "status": "pending" },
    "Submission": { "count": 0, "status": "pending" }
  },
  "progress": {
    "total": 4,
    "completed": 0,
    "minProgress": 20
  }
}
```

### 4.4 Rendering
- Integrate `ProgressRing.ts` from `sdlc-ui/` into the EDR component system
- Each stage rendered as a card with count badge + status indicator
- Connector lines between stages (gray pending → green completed)
- Overall pipeline progress ring at top (minimum 20% per Never Start at Zero)

---

## 5. W4 — Design Token CSS Alignment

### 5.1 Current State
All inline CSS across index.ts (chat widget), fragment.ts (calculator/budget), and dashboard-html.ts uses raw hex values — no CSS custom properties.

### 5.2 Requirements
- Add `:root` CSS custom properties matching `sdlc-ui/design-tokens.ts` defaults
- Migrate widget CSS to use `var(--token-name)` references
- Align with doc-intel UI token names for consistency:
  - `--bg`, `--fg`, `--border`, `--surface`, `--surface-alt`
  - `--accent`, `--success`, `--danger`, `--warning`
  - `--ring-fg`, `--ring-bg`
  - `--loss-border`, `--loss-bg`, `--loss-text`
  - `--btn-primary`, `--btn-danger`
  - `--spacing-{xs,sm,md,lg,xl}`
  - `--font-{sm,md,lg}`

### 5.3 Token Reference
See `apps/edge-runtime/src/lib/sdlc-ui/design-tokens.ts` for canonical values. The doc-intel UI at `ui-route.ts:94` has the established `:root` block to copy from.

---

## 6. Phasing

| Phase | Items | Effort | Dependencies |
|-------|-------|--------|--------------|
| **Phase 1** | W1 (Loss frame chat) + W4 (Tokens widget) | 2 days | None — standalone JavaScript changes |
| **Phase 2** | W2 (Budget progressive disclosure) | 3 days | HTMX fragment knowledge |
| **Phase 3** | W3 (Pipeline progress) | 5 days | EDR component registration, ProgressRing component |

**Total: ~10 days**

---

## 7. Verification

| W# | Criteria |
|----|----------|
| W1 | Close with messages → loss frame shown; close without messages → immediate; "Keep chatting" dismisses frame |
| W2 | Default: 6 categories visible; "Show more" expands to show all; count updates dynamically |
| W3 | Pipeline renders 3 stages with connectors; active stage highlighted; progress ring ≥20% |
| W4 | 100% of new CSS uses `var(--token)` references; matches doc-intel UI token names |

---

## 8. Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Widget.js loss frame conflicts with host page CSS | Medium | Scope all classes under `#edgegde-chat-root` |
| Budget progressive disclosure breaks HTMX dynamic fields | Low | Keep collapsed/visible as CSS class toggle, not DOM removal |
| Pipeline EDR component registration requires compiler update | Medium | Start with HTML fragment fallback if EDR compiler isn't ready |
