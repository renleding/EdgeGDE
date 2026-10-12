# Capability: Code→Validate Loop

## ADDED Requirements

### Requirement: AGS-C01: The loop SHALL run autonomously between escalation points

The loop SHALL iterate write → governance check → verify → adjust without Hermes reviewing intermediate diffs. Only the loop result (completed/escalated/rejected) surfaces to the Director.

#### Scenario: Passing verification completes in one iteration
- Given: a criterion that passes on the initial content
- When: `execute()` runs
- Then: `status` SHALL be `completed`
- And: `iterations` SHALL be `1`

#### Scenario: Failing criterion triggers adjust callback
- Given: a criterion that fails on iteration 1
- When: `execute()` runs
- Then: the `adjust` callback SHALL be invoked with the current content and the last failure
- And: the returned content SHALL be used for iteration 2

### Requirement: AGS-C02: Governance SHALL gate every write

Before each file write the loop SHALL run the governance gate on the proposed content; a gate failure ends the task with `status: "rejected"` and no write occurs beyond whatever was last written.

#### Scenario: Content with `as any` is rejected before writing
- Given: initial content containing `const x = {} as any;`
- When: `execute()` runs
- Then: `status` SHALL be `rejected`
- And: `governance_report.verdict` SHALL be `FAIL`

### Requirement: AGS-C03: The loop SHALL escalate at the iteration limit

When the number of failed iterations reaches `iteration_limit`, the loop SHALL return `status: "escalated"` carrying the iteration count and the last failure — never a silent pass.

#### Scenario: Limit of 2 exhausted
- Given: `iteration_limit=2` and an adjust callback that never fixes the failure
- When: `execute()` runs
- Then: `status` SHALL be `escalated`
- And: `iterations` SHALL equal `2`
- And: `last_failure` SHALL contain the final verification result

#### Scenario: Default limit is five
- Given: a loop constructed without an explicit limit
- When: the limit is read
- Then: the limit SHALL be `5`