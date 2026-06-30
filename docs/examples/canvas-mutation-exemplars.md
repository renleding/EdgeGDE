# EdgeGDE Few-Shot Exemplars — Mutation Patterns
## ALIGNMENT Phase Reference (FRS v3 Rec #3)

These exemplars show the correct pattern for each common mutation type.
Droid uses these as reference during the ALIGNMENT phase to match
expected output format and structure before generation.

---

## Exemplar 1: Add a Node

**Intent:** Create a new agent node on the canvas.

**Expected mutation:**
```json
{
  "type": "add_node",
  "node": {
    "id": "agent-node-001",
    "type": "AgentNode",
    "parentId": null,
    "children": [],
    "props": {
      "agentState": "Idle",
      "agentHistory": [],
      "targetNodeId": "welcome-onboarding"
    },
    "style": {
      "width": "360px",
      "height": "220px",
      "backgroundColor": "#0f172a"
    }
  },
  "parentId": "canvas-root"
}
```

**Validation check:** Node ID must not already exist in nodes map.

---

## Exemplar 2: Update a Node's Properties

**Intent:** Change the agent state from Running to Failed.

**Expected mutation:**
```json
{
  "type": "transition_agent_state",
  "nodeId": "agent-node-001",
  "newState": "Failed"
}
```

**Validation check:** newState must be a valid transition from current state.
Valid paths: Idle→Running, Running→Paused, Running→Failed, Running→Completed,
Paused→Running, Paused→Completed, Failed→Running, Completed→Idle.

---

## Exemplar 3: Create a Proposal

**Intent:** Propose adding a new mortgage calculator sandbox app.

**Expected mutation:**
```json
{
  "type": "create_proposal",
  "node": {
    "id": "proposal-042",
    "type": "ProposalNode",
    "parentId": "canvas-root",
    "children": [],
    "props": {},
    "style": {}
  },
  "proposalData": {
    "title": "Add mortgage calculator v2",
    "proposerAgentId": "agent-deploybot",
    "status": "Draft",
    "targetNodes": ["mcp-calculator-frame"],
    "createdAt": 1719432000000,
    "updatedAt": 1719432000000
  }
}
```

**Validation check:** Status must start at 'Draft'. Title must be non-empty.

---

## Exemplar 4: Approve a Proposal

**Intent:** Approve a pending proposal, transitioning it to Approved.

**Expected mutation:**
```json
{
  "type": "approve_proposal",
  "nodeId": "proposal-042"
}
```

**Validation check:** Node must exist and be type 'ProposalNode'.
Node's status must be 'Draft' or 'Review' (not already Approved/Rejected).

---

## Exemplar 5: Rollback to Previous State

**Intent:** Roll back the canvas to mutation index 24 (prior to a bad change).

**Expected mutation:**
```json
{
  "type": "rollback_to_point",
  "targetPointer": 24
}
```

**Validation check:** targetPointer must be >= -1 and < current history length.
Rollback is recorded in history as a new mutation (append-only).

---

## Exemplar 6: Link Workspaces

**Intent:** Connect two workspace agents for artifact handoff.

**Expected mutation:**
```json
{
  "type": "link_workspaces",
  "link": {
    "id": "link-ws-alpha-beta",
    "sourceWorkspaceId": "ws-alpha",
    "targetWorkspaceId": "ws-beta",
    "sourceAgentId": "agent-builder",
    "targetAgentId": "agent-deployer",
    "handoffType": "artifact",
    "retryCount": 0
  }
}
```

**Validation check:** Link ID must be unique across all workspace links.

---

## Exemplar 7: Delete a Node (with child reparenting)

**Intent:** Remove a section node while promoting its children to the parent level.

**Expected mutation:**
```json
{
  "type": "delete_node",
  "nodeId": "section-middle",
  "strategy": "reparent_children"
}
```

**Validation check:** Node must not be root. If strategy is 'reparent_children',
children must have valid parentId after promotion.

---

## Exemplar 8: Move a Node

**Intent:** Move an agent node to a different location in the tree.

**Expected mutation:**
```json
{
  "type": "move_node",
  "nodeId": "agent-node-003",
  "newParentId": "section-tools",
  "newIndex": 2
}
```

**Validation check:** newParentId must not be a descendant of nodeId
(circular parenting check). newIndex must be >= 0.
