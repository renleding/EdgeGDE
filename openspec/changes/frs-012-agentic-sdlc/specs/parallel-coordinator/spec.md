# Capability: Parallel Coordinator

## ADDED Requirements

### Requirement: AGS-P01: Parallel tasks SHALL be isolated

The coordinator SHALL plan one worktree per parallel task with a deterministic path derived from `mission_id` and `task_id`. Actual worktree creation is gated until fleet idle.

#### Scenario: Worktree paths are planned deterministically
- Given: a manifest with one parallel task
- When: `plan_worktrees()` is called
- Then: the returned map SHALL contain exactly one entry keyed by task id
- And: the path SHALL be under the worktrees root

### Requirement: AGS-P02: Parallel tasks SHALL have no dependencies

`validate_parallelism()` SHALL return an error for every parallel task with a non-empty `depends_on`.

#### Scenario: Parallel with depends_on flagged
- Given: a parallel task with `depends_on: ["task_1"]`
- When: `validate_parallelism()` is called
- Then: the error list SHALL be non-empty

#### Scenario: Independent parallel tasks validate clean
- Given: parallel tasks with empty `depends_on`
- When: `validate_parallelism()` is called
- Then: the error list SHALL be empty

### Requirement: AGS-P03: Coordinator SHALL track and aggregate status

The coordinator SHALL track per-task status (`pending`, `running`, `completed`, `failed`, `escalated`) and produce an `AggregationResult` with `all_passed`, per-task results, and budget accounting.

#### Scenario: All completed passes
- Given: all tracked tasks marked completed
- When: `aggregate_results()` is called
- Then: `all_passed` SHALL be `true`

#### Scenario: One failure fails aggregation
- Given: one task marked failed
- When: `aggregate_results()` is called
- Then: `all_passed` SHALL be `false`
- And: the failed task SHALL appear in `task_results`