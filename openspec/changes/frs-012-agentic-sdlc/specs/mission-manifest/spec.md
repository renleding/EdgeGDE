# Capability: Mission Manifest with Executable Verification Criteria

## ADDED Requirements

### Requirement: AGS-M01: Verification criteria SHALL be structured objects, not prose

Each `Task.verification_criteria` SHALL be an object with fields: `type` (one of `test_command`, `script`, `http_check`, `state_check`), a type-specific selector (`command`/`script`/`endpoint`/`path`), `expected` (structured condition), and optional `timeout`.

#### Scenario: Structured criteria round-trips through serialization
- Given: a manifest with a task carrying a `test_command` criterion
- When: the manifest is serialized to JSON and parsed back
- Then: the criterion SHALL retain its `type`, `command`, and `expected` fields

#### Scenario: Prose criteria are not accepted
- Given: a task whose `verification_criteria` is the string "tests should pass"
- When: the manifest is parsed
- Then: validation SHALL fail with an error indicating a structured object is required

### Requirement: AGS-M02: Mutating tasks without criteria SHALL fail validation

`MissionManifest.validate()` SHALL return an error for every task whose `operation` is in {`write_text`, `patch`, `delete`, `shell`} and which has no `verification_criteria`.

#### Scenario: Write task missing criteria rejected
- Given: a manifest containing a `write_text` task with no `verification_criteria`
- When: `validate()` is called
- Then: the returned error list SHALL contain an entry naming the task
- And: the mission SHALL NOT pass GATE

#### Scenario: Read-only task without criteria accepted
- Given: a manifest containing only `read_file` tasks with no criteria
- When: `validate()` is called
- Then: the error list SHALL be empty

### Requirement: AGS-M03: Parallel tasks SHALL declare no dependencies

A task with `parallel: true` SHALL have an empty `depends_on` list; `validate()` SHALL otherwise fail.

#### Scenario: Parallel task with dependency rejected
- Given: a task with `parallel: true` and `depends_on: ["task_1"]`
- When: `validate()` is called
- Then: the error list SHALL contain a parallel/dependency conflict error

#### Scenario: Duplicate task ids rejected
- Given: two tasks sharing the same `task_id`
- When: `validate()` is called
- Then: the error list SHALL contain a duplicate-id error