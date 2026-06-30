# EdgeGDE Canvas Evolution — Draft Functional Requirements Specification (FRS) v3

---

## 1. Objective

Evolve the existing EdgeGDE infinite canvas from a visual orchestration surface into an **agentic workflow state machine** that makes system governance, agent lifecycle management, and deterministic mutation history visible, navigable, and auditable directly on the canvas itself. The canvas must remain an SDLC kernel artifact — not a design tool — by encoding operational semantics (agent states, proposal/approve flows, rollback points) as first-class visual primitives.

---

## 2. Baseline (Existing Canvas v1 + FRS v2 Targets)

| Capability | Status |
|---|---|
| Infinite pan/zoom (CSS transform) | ✅ Implemented |
| Drag & resize with 8-direction handles | ✅ Implemented |
| Shift-click multi-select, rectangle select | ✅ Implemented |
| Snap-to-object alignment | ✅ Implemented |
| Node types: Page | Section | Text | Input | Button | Frame | ✅ Implemented |
| Two-pointer versioning (stagingPointer / livePointer) | ✅ Implemented |
| Append-only mutation history | ✅ Implemented |
| IndexedDB draft save, online/offline detection | ✅ Implemented |
| PWA vanilla JS (~971 lines), static assets copied to worker | ✅ Implemented |
| Property editor (double-click edit) | 🔄 FRS v2 target |
| Undo/redo local mutations | 🔄 FRS v2 target |
| Publish workspace → EdgeGDE runtime | 🔄 FRS v2 target |
| Agent instruction form creates proposals | 🔄 FRS v2 target |

---

## 3. Proposed Features (FRS v3)

### Feature A — Agent Lifecycle State Overlay

**Objective:** Render agent execution states as visual primitives on the canvas so that a developer can see, at a glance, which agents are running, paused, failed, or completed within a workspace and trace their state transitions without leaving the canvas.

**Proposed behavior:**
1. Introduce a new node type `AgentNode` that wraps an existing node and carries a lifecycle enum: `{ Idle, Running, Paused, Failed, Completed }`.
2. Each `AgentNode` renders with a colored border ring (green = running, red = failed, gray = idle) and a small status badge.
3. A **state transition trail** is drawn as a dashed line connecting an agent's previous state position to its current one — visually encoding "this agent moved from Running → Failed at 14:02 UTC".
4. Clicking any `AgentNode` opens the property editor with an expanded Agent tab showing: agent ID, last mutation timestamp, error log, and a **Replay** button.

**Architecture:**
```typescript
interface AgentNode extends Node {
  targetNodeId: string
  state: 'Idle' | 'Running' | 'Paused' | 'Failed' | 'Completed'
  history: Array<{ state: string; ts: number; mutationId: string }>
}
```

**AC:**
- [ ] 3+ running agents show distinct colored rings
- [ ] Failed agents show dashed state transition trails
- [ ] Replay restores state via deterministic mutation replay

---

### Feature B — Deterministic Mutation Timeline

**Objective:** Make the append-only mutation history visible as a navigable timeline on the canvas, enabling operators to jump to any historical state and verify deterministic application.

**Proposed behavior:**
1. Add a **Timeline Rail** — fixed horizontal strip at the top showing mutation entries as compact chips (timestamp, type, hash prefix).
2. Clicking any chip performs a **state jump**: re-applies mutations up to that point deterministically.
3. Filtering by mutation type, date range, or agent ID.
4. A **diff view** between two timeline points highlights nodes added/removed/changed.

**AC:**
- [ ] Timeline Rail renders all mutations chronologically
- [ ] Clicking a chip re-applies mutations and sets livePointer (verified by hash match)
- [ ] Diff overlay accurately highlights changes

---

### Feature C — Proposal Approval Flow on Canvas

**Objective:** Visualize the proposal/approve governance pattern directly on the canvas.

**Proposed behavior:**
1. `ProposalNode` type renders as a bordered card with status badge (Draft= yellow, Review=blue, Approved=green, Rejected=red).
2. Flow arrow connects ProposalNode to its target node(s).
3. Operators approve/reject directly on canvas — all recorded as deterministic mutations.

**Architecture:**
```typescript
interface ProposalNode extends Node {
  title: string
  proposerAgentId: string
  status: 'Draft' | 'Review' | 'Approved' | 'Rejected'
  targetNodes: string[]
}
```

**AC:**
- [ ] Agent instruction form creates ProposalNode on canvas
- [ ] Approve/reject transitions recorded in history
- [ ] Flow arrow updates visually on state change

---

### Feature D — Cross-Workspace Agent Handoff Map

**Objective:** Enable visualization of agent workflows spanning multiple workspaces.

**Proposed behavior:**
1. `WorkspaceLink` primitive connects two `AgentNode`s across different workspaces, rendered as a dashed line with handoff payload type.
2. Each workspace appears as a **pane** — bordered region containing its own nodes and agents. Panes are draggable and resizable.
3. A **handoff map view** overlays all workspace panes with interconnecting links.

**AC:**
- [ ] Two workspaces with handoff relationships show WorkspaceLinks
- [ ] Handoff map overlays all panes and links
- [ ] Clicking a link shows payload schema, timestamp, retry count

---

### Feature E — Compliance Audit Trail Overlay

**Objective:** Render governance decisions (approvals, rejections, rollbacks) as an auditable overlay on the canvas.

**Proposed behavior:**
1. Right-side vertical timeline showing governance events with color coding (green=approve, red=reject/rollback, blue=info).
2. Clicking an event highlights affected nodes.
3. **Rollback replay** re-applies deterministic mutations without breaking append-only integrity.

**AC:**
- [ ] Governance events render as color-coded timeline entries
- [ ] Clicking highlights affected nodes
- [ ] Rollback replay preserves append-only integrity

---

## 4. Architecture Considerations

### Node Type Extension
```typescript
// New mutations for FRS v3
type Mutation = existing | 'transition_agent_state' | 'create_proposal'
              | 'approve_proposal' | 'reject_proposal'
              | 'rollback_to_point' | 'link_workspaces'
```

### State Management
- **Append-only history integrity:** All new mutations follow the same pattern. No mutation is ever overwritten.
- **Parallel history tracks:** Agent lifecycle changes in a parallel track (does not affect main undo/redo).
- **Deterministic replay:** All state jumps verify hash match before committing to livePointer.

---

## 5. Acceptance Criteria Summary

| Feature | Key Criterion |
|---|---|
| Agent Lifecycle Overlay | Colored rings, dashed trails, deterministic Replay |
| Mutation Timeline | Timeline Rail, state jumps, diff overlay |
| Proposal Approval Flow | ProposalNodes on canvas, approve/reject in history |
| Cross-Workspace Handoff | Workspace panes, interconnecting links, inspection panel |
| Audit Trail Overlay | Governance events, highlight affected nodes, rollback replay |

---

## 6. Open Questions

1. Should `WorkspacePane` be a first-class node type or an overlay primitive?
2. How do concurrent agent state transitions serialize — through proposal/approve or conflict resolution?
3. Maximum agents/workspaces before performance degrades?
4. Should the audit trail be collapsible to avoid clutter on simple workspaces?

---

*End of Draft FRS v3 — EdgeGDE Canvas Evolution*
