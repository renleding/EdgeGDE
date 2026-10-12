# Capability: Pre-Mutation Governance Gate

## ADDED Requirements

### Requirement: AGS-G01: The gate SHALL reject mutations that fail its checks

`can_apply_mutation()` SHALL return `allowed: false` when any check fails, and the Droid SHALL NOT apply the mutation.

#### Scenario: `as any` annotation rejected
- Given: proposed content `const x = {} as any;`
- When: the gate evaluates the content
- Then: `allowed` SHALL be `false`
- And: the report verdict SHALL be `FAIL`

#### Scenario: Clean content allowed
- Given: proposed content `const x: string = "ok";`
- When: the gate evaluates the content
- Then: `allowed` SHALL be `true`
- And: the report verdict SHALL be `PASS`

### Requirement: AGS-G02: Check logic SHALL match CI Gate 3

The gate SHALL implement the same rule families as `tools/governance-check.ts`: no `as any` / `: any` in production `.ts`, no `console.log` in production `.ts` (test/config/tooling excluded), trailing whitespace, file-size warning, JSDoc and test-file-existence warnings — with identical exclusion rules.

#### Scenario: Test files exempt from `any` rule
- Given: content `const x = {} as any;` in a file named `thing.test.ts`
- When: the gate evaluates it
- Then: the no-`any` check SHALL pass

#### Scenario: Tooling files exempt from console rule
- Given: content with `console.log("x")` in `tools/governance-check.ts`
- When: the gate evaluates it
- Then: the no-console check SHALL pass

### Requirement: AGS-G03: Gate results SHALL be journaled

Every gate evaluation SHALL produce a `GovernanceReport` with timestamp, per-check results, verdict, and files-checked count, suitable for Action Journal insertion.

#### Scenario: Report carries audit fields
- Given: any gate evaluation
- When: the report is inspected
- Then: it SHALL contain `timestamp`, `checks`, `verdict`, and `files_checked`
- And: each check SHALL carry `check`, `status`, `details`, `file`