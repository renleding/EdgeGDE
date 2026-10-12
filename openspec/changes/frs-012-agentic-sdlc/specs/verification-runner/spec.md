# Capability: Verification Runner

## ADDED Requirements

### Requirement: AGS-V01: The verification runner SHALL execute criteria deterministically

Running the same criterion against unchanged state SHALL produce the same `status` and comparable `result` on every invocation.

#### Scenario: Identical command yields identical status
- Given: criterion `test_command` with `command: "echo ok"` and `expected: {exit_code: 0}`
- When: the runner executes the criterion twice
- Then: both results SHALL have `status: "pass"`
- And: the timestamps SHALL be the only field that differs

### Requirement: AGS-V02: The runner SHALL support four criterion types

The runner SHALL execute `test_command` (shell + exit code/out assertions), `script` (file with auto-detected interpreter), `http_check` (GET + status/body assertions), and `state_check` (file existence/content assertions).

#### Scenario: test_command checks exit code
- Given: criterion `test_command` with `command: "false"` and `expected: {exit_code: 0}`
- When: the runner executes it
- Then: `status` SHALL be `fail`
- And: `result.exit_code` SHALL be `1`

#### Scenario: state_check verifies file existence
- Given: criterion `state_check` with `path` pointing at an existing file and `expected: {exists: true}`
- When: the runner executes it
- Then: `status` SHALL be `pass`

#### Scenario: unknown criterion type fails
- Given: criterion with `type: "bogus"`
- When: the runner executes it
- Then: `status` SHALL be `fail` with an `error` naming the unknown type

### Requirement: AGS-V03: Expected conditions SHALL compare structurally

When `expected` and the actual result are both objects, every key in `expected` SHALL be matched against the corresponding field of the actual result; scalar expectations on non-object results SHALL support equality, `contains`, `exists`, and `not_exists`.

#### Scenario: Exit code dictionary comparison
- Given: actual result `{exit_code: 0, stdout: "ok"}` and expected `{exit_code: 0}`
- When: the condition is evaluated
- Then: the evaluation SHALL pass (expected keys are a subset match)

#### Scenario: Missing expected key fails
- Given: actual result `{exit_code: 0}` and expected `{exit_code: 1}`
- When: the condition is evaluated
- Then: the evaluation SHALL fail