# OpenSpec Workflow for EdgeGDE

## Init
```bash
cd /Users/warren/Documents/_HQ_AI/EdgeGDE
openspec init --tools none
```

## Create a Change
```bash
openspec new change "feature-name"
# Creates: openspec/changes/feature-name/
#   proposal.md → why
#   design.md   → how
#   specs/      → what (Given/When/Then scenarios)
#   tasks.md    → implementation tasks
```

## Config
`openspec/config.yaml` contains project context and rules.

## Validate
```bash
openspec validate feature-name
# Must pass before any code is written
# Every requirement must use SHALL or MUST
# Every requirement must have at least one #### Scenario: block
```

## Status
```bash
openspec status --change feature-name
```

## Archive (on completion)
```bash
openspec archive feature-name
```

## CI Gate
Add to `.github/workflows/ci.yml`:
```yaml
- name: OpenSpec Validate
  run: openspec validate
```

## Spec Format
```markdown
# Capability Name

## ADDED Requirements

### Requirement: Specific behavior

Requirement description with SHALL/MUST.

#### Scenario: Given/When/Then name
Given [precondition]
When [action]
Then [expected result]
```
