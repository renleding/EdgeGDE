# EdgeGDE Website Visual Fidelity Reconstruction — Functional Specification

Version: 1.0.0
Status: Functional specification for future Droid mission
Owner: Hermes / Aegis / EdgeGDE
Primary runtime target: `apps/edge-runtime`
Related existing spec: `apps/edge-runtime/canvas-transpiler-v2.1-spec.md`

## 0. Executive Summary

This specification defines a governed workflow for reconstructing a public website into EdgeGDE-compatible artifacts that visually match the source at declared viewport(s) and preserve declared interaction behavior.

The workflow is intentionally not a universal raw website cloner. It is a fidelity-gated reconstruction pipeline:

```text
public URL
  -> browser snapshot and source extraction
  -> visual fidelity analysis
  -> EdgeGDE-compatible adapter generation
  -> behavior contract generation
  -> schema validation
  -> security scan
  -> audit log
  -> policy request
  -> optional future EdgeGDE mutation only after separate approval
```

The workflow may use browser rendering as a visual oracle, but browser/computed output must not become authoritative EdgeGDE state. EdgeGDE state mutation remains controlled by `CanvasSession_DO`, `expectedVersion`, `correlationId`, Aegis policy approval, and audit logging.

## 1. Core Principle

The objective is not literal cloning.

The objective is:

```text
visually equivalent at declared viewport(s)
+ behaviorally equivalent for declared interactions
+ EdgeGDE-compatible
+ governed
+ auditable
+ non-authoritative until policy-approved
```

The workflow must not copy raw CSS bundles, raw JavaScript bundles, or third-party renderer code as authoritative EdgeGDE state.

Allowed:

```text
source website -> extraction -> EdgeGDE-native reconstruction -> visual verification
```

Forbidden:

```text
source website -> raw copied renderer -> direct EdgeGDE mutation
```

## 2. Non-Negotiable Invariants

1. `source_url_is_public_only`
   - Only public URLs are allowed.
   - Localhost, private IPs, metadata endpoints, file URLs, data URLs, and credential-bearing URLs are rejected.

2. `output_is_non_authoritative_until_policy_approved`
   - The workflow produces artifacts and policy requests only.
   - It never mutates EdgeGDE state directly.

3. `edgegde_state_mutation_requires_expected_version`
   - Any future mutation requires `expectedVersion`.

4. `edgegde_state_mutation_requires_correlation_id`
   - Any future mutation requires `correlationId`.

5. `edgegde_state_mutation_requires_policy_gate`
   - Aegis must approve any mutation before EdgeGDE applies it.

6. `visual_oracle_is_not_state_authority`
   - Browser screenshots and computed layout may be used for verification and diagnostics.
   - They must not become the source of truth for CanvasDocument state.

7. `structure_before_tokens`
   - UI structure extraction must precede token inference.

8. `existing_edgegde_types_are_canonical`
   - Use existing EdgeGDE `DesignTokens`, `CanvasDocument`, `Node`, `Mutation[]`, and audit/event conventions.
   - Do not create a parallel token or canvas state system.

9. `no_raw_css_or_js_authority`
   - Raw CSS and JS may be analyzed as source evidence.
   - They must not be persisted as authoritative renderer state.

10. `deterministic_artifacts`
    - Same normalized input and same rule versions must produce byte-stable artifacts within documented tolerance.

11. `unsupported_features_must_be_reported`
    - Anything not reconstructed must be listed in the audit/fidelity report.

12. `fail_closed`
    - Security, schema, or policy failures must stop mutation and return partial artifacts plus failure reason.

## 3. Goals

The workflow must enable the following outcomes:

1. Reconstruct a public website into EdgeGDE-compatible artifacts.
2. Match the source visually at declared viewport(s).
3. Preserve behavior for declared interactions.
4. Preserve editability inside EdgeGDE where native reconstruction is used.
5. Preserve instant re-theming where design tokens are used.
6. Produce a visual verification report with measurable parity.
7. Produce a behavior contract for supported interactions.
8. Produce a policy request package for any future EdgeGDE mutation.
9. Keep EdgeGDE as the sole authority over workspace/canvas state.

## 4. Non-Goals

Out of scope for v1:

1. Arbitrary JavaScript application cloning.
2. Full SPA state replication.
3. Payment, auth, or backend-dependent workflows.
4. Third-party widget internal behavior replication.
5. Pixel-perfect parity across every possible device.
6. Direct EdgeGDE mutation from the reconstruction workflow.
7. Raw CSS bundle persistence as authoritative renderer output.
8. Raw JS persistence as authoritative behavior engine.

## 5. Site Classes and Feasibility

### 5.1 High-feasibility sites

The workflow is expected to achieve high visual parity for:

- marketing pages
- landing pages
- SaaS homepages
- documentation sites
- blogs
- pricing pages
- simple dashboards
- static content sites
- standard component-based pages

Expected behavior parity:

- navigation
- anchors
- buttons
- simple forms
- tabs
- accordions
- modals
- dropdowns
- carousels
- hover/focus states

### 5.2 Medium-feasibility sites

The workflow may achieve partial parity for:

- SPAs with deterministic client state
- dashboards with client-side filtering
- interactive calculators
- simple data tables
- form wizards

Expected requirement:

- explicit behavior contract
- interaction fixtures
- unsupported state transitions listed

### 5.3 Low-feasibility sites

The workflow should not claim native parity for:

- canvas/WebGL apps
- design editors
- collaborative apps
- payment flows
- authenticated apps
- live chat apps
- complex drag/drop editors
- third-party embedded widgets
- apps depending on private APIs or secrets

Recommended handling:

- produce artifacts for supported static/structural portions
- mark unsupported portions
- optionally produce sandboxed EdgeGDE-compatible iframe/window policy request if allowed by policy

## 6. Fidelity Levels

The workflow must define the fidelity level requested in the Mission Manifest.

### Level 1: Structural Reconstruction

Purpose:

- capture content hierarchy
- produce EdgeGDE-compatible structure
- no visual parity requirement

Expected output:

- `layout_tree.json`
- `ui_manifest.json`
- `audit_log.json`

### Level 2: Visual Approximation

Purpose:

- capture visual character
- infer colors, typography, spacing, radius, and layout
- no strict screenshot parity

Expected output:

- Level 1 outputs
- `design_tokens.json`
- `component_library.json`
- `visual_report.json` with approximation metrics

### Level 3: Visual Parity

Purpose:

- match source visually at declared viewport(s)
- enforce screenshot-based thresholds

Expected output:

- Level 2 outputs
- `visual_report.json` with parity metrics
- `fidelity_manifest.json`
- viewport screenshots
- diff artifacts
- unsupported visual differences list

### Level 4: Behavioral Parity

Purpose:

- Level 3 plus declared interaction behavior

Expected output:

- Level 3 outputs
- `behavior_contract.json`
- interaction fixtures
- interaction verification report
- unsupported behavior list

This specification targets Level 3 and Level 4.

## 7. Mission Manifest Contract

The workflow executes only from a validated Mission Manifest.

Required fields:

```yaml
mission_id: "stable-mission-id"
executor: "droid"
skill: "software-development/website-to-code"
authority: "non_authoritative_artifacts"

inputs:
  url: "https://example.com"
  fidelity_level: "visual_parity | behavioral_parity"
  viewports:
    - name: "desktop"
      width: 1440
      height: 900
    - name: "tablet"
      width: 768
      height: 1024
    - name: "mobile"
      width: 375
      height: 812
  visual_thresholds:
    desktop_min_ssim: 0.95
    tablet_min_ssim: 0.90
    mobile_min_ssim: 0.85
    max_mean_pixel_delta: 12
  behavior_scope:
    - "navigation"
    - "buttons"
    - "forms"
    - "tabs"
    - "accordions"
    - "modals"

policy:
  allow_public_network: true
  allow_private_network: false
  allow_local_network: false
  allow_credential_urls: false
  allow_direct_edgegde_mutation: false
  require_schema_validation: true
  require_security_scan: true
  require_visual_verification: true
  require_behavior_verification: true
  require_audit_log: true

outputs:
  - artifacts/dom_snapshot.json
  - artifacts/layout_tree.json
  - artifacts/design_tokens.json
  - artifacts/component_library.json
  - artifacts/ui_manifest.json
  - artifacts/canvas_document_adapter.json
  - artifacts/visual_report.json
  - artifacts/behavior_contract.json
  - artifacts/policy_request.json
  - artifacts/audit_log.json
```

## 8. Pipeline

### Stage 0: Mission Validation

Checks:

- executor is `droid`
- authority is `non_authoritative_artifacts`
- direct EdgeGDE mutation is forbidden
- public network is allowed only for public URLs
- required validation flags are true

Failure behavior:

- return `mission_rejected`
- do not fetch target URL
- write audit log only

### Stage 1: URL Normalization and Security Gate

Normalize:

- strict URL parse
- lower-case scheme and host
- remove fragment
- reject credentials in URL
- reject non-http(s) schemes
- reject localhost
- reject private/reserved IPs
- reject metadata endpoints
- reject file/data/javascript URLs

Network constraints:

- HTTPS only for v1
- max redirects: 3
- reject redirects to disallowed host
- request timeout: 5s
- max HTML size: 2MB
- max total CSS size: 5MB
- max total artifact size: 10MB

Output:

- `url_validation_result`
- `normalized_url`

Failure behavior:

- return `security_rejected`
- no target fetch
- audit reason required

### Stage 2: Browser Snapshot

Purpose:

- capture visual oracle
- capture viewport-specific DOM state
- capture source evidence

For each declared viewport:

- load URL in controlled browser context
- disable third-party tracking where possible
- block credential leakage
- capture screenshot
- capture DOM snapshot
- capture HTML snapshot
- capture stylesheet references
- capture accessibility tree if available
- record load status and timing

Important:

- browser snapshot is visual verification evidence.
- browser snapshot is not EdgeGDE state authority.

Output:

- `browser_snapshot/{viewport}.png`
- `browser_snapshot/{viewport}.dom.json`
- `browser_snapshot/{viewport}.html`
- `browser_snapshot/{viewport}.manifest.json`

### Stage 3: Source Extraction

Extract:

- static HTML
- semantic structure
- inline styles
- external stylesheets
- CSS variables
- class tokens
- text content
- labels
- aria attributes
- form fields
- links
- images as metadata
- safe structural hints

Do not:

- persist raw CSS bundles as authoritative renderer
- persist raw JS as behavior engine
- execute arbitrary third-party logic for state reconstruction
- fetch credentials or private endpoints

Output:

- `dom_snapshot.json`
- `stylesheet_snapshot.json`
- `source_evidence.json`

### Stage 4: Sanitization

Sanitize DOM/HTML:

- remove scripts
- remove event handler attributes
- remove `javascript:` URLs
- remove unsafe iframes
- remove form actions
- remove credential-bearing metadata
- preserve structural text and safe UI primitives
- preserve semantic roles
- preserve links/buttons/forms as behavior candidates

Output:

- `sanitized_dom_snapshot.json`
- sanitizer decisions in `audit_log.json`

### Stage 5: Structure Extraction

Build semantic UI tree.

Suggested mapping:

```text
html/body/main -> page
header -> section/header
nav -> section/navigation
footer -> section/footer
section/article/div -> section or frame
h1-h6 -> heading/text
p/li/span -> text
button/a -> button or link
form/input/select/textarea -> form/input primitives
img -> image placeholder
```

Rules:

- prefer semantic HTML
- fallback to `role`
- fallback to class/name heuristics
- preserve parent/child hierarchy
- generate stable node IDs
- create placeholders for skipped elements
- no orphan nodes
- no duplicate IDs
- no cycles

Output:

- `layout_tree.json`

### Stage 6: Visual Token and Component Extraction

Use existing EdgeGDE types.

Canonical source:

```text
src/lib/design-parser.ts
```

Token sources, in priority order:

1. inline styles
2. CSS variables
3. pattern-based CSS class matching
4. visual snapshot diagnostics
5. EdgeGDE defaults

Token categories:

- background
- surface
- text
- muted
- primary
- border
- typography
- spacing
- radius
- shadow/elevation if supported by existing EdgeGDE type

Component detection:

- nav groups
- cards
- feature blocks
- pricing cards
- testimonials
- footers
- buttons
- lists
- forms
- modals
- tabs/accordions if declared in behavior scope

Output:

- `design_tokens.json`
- `component_library.json`

### Stage 7: UI Manifest Construction

Build:

```text
UiManifest
  schema_version
  mission_id
  source
  viewports
  root_node_id
  nodes
  components
  token_refs
  visual_targets
  behavior_targets
  validation
  policy
  audit
```

Rules:

- deterministic ordering
- no raw scripts
- no raw CSS bundles
- all component refs must exist
- all token refs must exist or use EdgeGDE defaults
- all viewport targets must reference captured snapshots
- all unsupported features must be listed

Output:

- `ui_manifest.json`

### Stage 8: EdgeGDE CanvasDocument Adapter

The adapter is non-authoritative.

It may produce:

```text
canvas_document_adapter.json
```

Requirements:

- use existing `CanvasDocument` type
- use existing `Node` type
- use existing `DesignTokens` type
- use existing responsive override model where available
- mark adapter as proposal-only
- include `policy_approval_required: true`
- include `expected_version_required: true`
- include `correlation_id_required: true`
- do not mutate EdgeGDE state

If exact visual parity cannot be represented natively, the adapter must include one of:

1. native approximation with limitations
2. sandboxed iframe/window compatibility proposal
3. unsupported feature report

Output:

- `canvas_document_adapter.json`

### Stage 9: Visual Verification

For each viewport:

1. render EdgeGDE adapter
2. capture screenshot
3. compare against source screenshot
4. calculate metrics:
   - SSIM
   - mean pixel delta
   - max pixel delta
   - structural layout delta
   - text bounding box delta
   - color delta
5. list visual differences
6. classify differences:
   - acceptable
   - needs_iteration
   - unsupported_native_renderer
   - requires_sandboxed_fallback
   - failed_threshold

Default thresholds:

```text
desktop SSIM >= 0.95
tablet SSIM >= 0.90
mobile SSIM >= 0.85
max mean pixel delta <= 12
```

Mission Manifest may override thresholds.

Output:

- `visual_report.json`
- screenshot diff artifacts
- unsupported visual features list

### Stage 10: Behavior Contract Construction

For each declared interaction:

- identify source behavior
- define EdgeGDE-native behavior
- define expected state transitions
- define fixtures
- define unsupported limitations

Supported behavior examples:

- nav links
- buttons
- anchors
- simple forms
- dropdowns
- tabs
- accordions
- modals
- carousels
- hover/focus states

Unsupported behavior examples:

- arbitrary SPA state
- third-party widgets
- payment flows
- authentication flows
- live/collaborative state
- complex drag/drop editors

Output:

- `behavior_contract.json`

### Stage 11: Behavior Verification

For each fixture in `behavior_contract.json`:

1. run source behavior fixture
2. run EdgeGDE adapter behavior fixture
3. compare expected outcomes
4. record pass/fail
5. record unsupported limitations

Output:

- `behavior_verification_report.json`

### Stage 12: Policy Request Package

The workflow produces:

```text
policy_request.json
```

Required fields:

```json
{
  "action": "website_visual_fidelity_reconstruction.apply_to_canvas",
  "status": "requires_policy_approval",
  "source_artifacts_hash": "...",
  "target_canvas_id": null,
  "expected_version_required": true,
  "correlation_id_required": true,
  "mutation_allowed": false,
  "policy_checks_required": [
    "tenant_authorization",
    "artifact_hash_match",
    "schema_validation",
    "security_scan",
    "visual_threshold_acceptance",
    "behavior_threshold_acceptance",
    "unsupported_feature_review"
  ],
  "notes": [
    "Droid workflow produced non-authoritative artifacts only.",
    "EdgeGDE mutation requires separate Aegis-approved mission."
  ]
}
```

### Stage 13: Audit Log

Audit log must include:

- `mission_id`
- `correlation_id`
- `executor`
- `skill_version`
- `rule_versions`
- `input_url_hash`
- `source_snapshot_hash`
- `output_hashes`
- `url_validation`
- `fetch_summary`
- `sanitizer_decisions`
- `structure_decisions`
- `component_decisions`
- `token_decisions`
- `visual_verification`
- `behavior_verification`
- `schema_validation`
- `security_scan`
- `policy_gate`
- `failures`
- `loop_report`
- `stop_reason`

Deterministic hash rule:

- `deterministic_hash` excludes volatile fields such as run timestamp.
- `run_id` may include timestamp but must not affect artifact determinism.

## 9. EdgeGDE Type Alignment

The workflow must align with existing EdgeGDE concepts.

Use existing:

```text
DesignTokens
CanvasDocument
Node
Mutation[]
expectedVersion
correlationId
guardKV()
guardDB()
AuditLedger
```

Do not create:

```text
new token system
new canvas mutation authority
new direct renderer
new parallel state store
```

If future mutation is approved, the path must be:

```text
policy_request.json
  -> Aegis policy approval
  -> Hermes-issued mutation mission
  -> expectedVersion check
  -> correlationId
  -> CanvasSession_DO mutation
  -> AuditLedger event
```

## 10. Native Mode and Sandbox Mode

The workflow supports two output modes.

### 10.1 Native EdgeGDE Reconstruction

Use when the source can be represented with:

- EdgeGDE nodes
- EdgeGDE design tokens
- EdgeGDE components
- supported behavior primitives
- supported responsive model

Output:

- native `CanvasDocument` adapter
- native behavior contract
- visual verification report

### 10.2 Sandboxed Compatibility Fallback

Use when the source depends on unsupported behavior or renderer features.

Use when:

- third-party widgets are required
- arbitrary JS behavior is required
- native renderer cannot meet visual threshold
- policy allows sandboxed UI hosting

Output:

- EdgeGDE window/iframe shell proposal
- source URL and policy metadata
- CSP/permission metadata
- audit record
- unsupported native reconstruction report

Sandbox mode keeps EdgeGDE as host and authority. It does not grant third-party UI direct mutation authority.

## 11. Security Hardening

Required controls:

1. URL validation
   - HTTPS only
   - no credentials
   - no fragments
   - no localhost
   - no private/reserved IPs
   - no metadata endpoints
   - no file/data/javascript URLs

2. DNS and redirect protection
   - resolve host before fetch
   - reject private/reserved IPs
   - reject redirects to disallowed hosts
   - max redirects: 3

3. Fetch limits
   - timeout: 5s
   - max HTML: 2MB
   - max total CSS: 5MB
   - max total artifacts: 10MB

4. Sanitization
   - strip scripts
   - strip event handlers
   - strip `javascript:` URLs
   - strip unsafe iframes
   - strip form actions
   - preserve structure only

5. Output safety
   - no raw CSS bundles
   - no raw JS
   - no third-party component libraries
   - no external renderer source
   - CSP-safe artifacts

6. Secret safety
   - never log full URL if it contains credentials
   - redact sensitive query parameters
   - never persist cookies, tokens, or headers from target site

## 12. Verification Fixtures

The implementation must include deterministic fixtures.

### Visual fixtures

1. `fixture_simple_static`
   - purpose: basic semantic and visual extraction
   - expected: header, hero, text, footer

2. `fixture_marketing_page`
   - purpose: nav, hero, feature cards, CTA, footer
   - expected: component candidates and visual parity

3. `fixture_tailwind_hidden`
   - purpose: Tailwind responsive visibility
   - expected: `hidden lg:flex` is not treated as permanently hidden

4. `fixture_external_css_variables`
   - purpose: CSS variable extraction
   - expected: design tokens extracted from CSS variables

5. `fixture_inline_styles`
   - purpose: inline style extraction
   - expected: colors/background/radius extracted

6. `fixture_typography_spacing`
   - purpose: typography and spacing fidelity
   - expected: fonts, sizes, padding, gaps captured

7. `fixture_large_html`
   - purpose: size cap
   - expected: graceful partial output with audit reason

### Security fixtures

8. `fixture_hostile_script_tags`
   - purpose: sanitization
   - expected: no scripts/event handlers persisted

9. `fixture_javascript_url`
   - purpose: unsafe URL filtering
   - expected: rejected or sanitized

10. `fixture_private_url`
    - purpose: SSRF guard
    - expected: security rejection, no fetch

11. `fixture_credential_url`
    - purpose: credential rejection
    - expected: security rejection

### Behavior fixtures

12. `fixture_navigation`
    - purpose: links and nav behavior
    - expected: navigation contract generated

13. `fixture_tabs`
    - purpose: tab behavior
    - expected: tab state contract generated

14. `fixture_accordion`
    - purpose: accordion behavior
    - expected: accordion state contract generated

15. `fixture_modal`
    - purpose: modal behavior
    - expected: modal open/close contract generated

16. `fixture_form_basic`
    - purpose: simple form behavior
    - expected: form fields and validation contract generated

### Unsupported behavior fixtures

17. `fixture_third_party_widget`
    - purpose: unsupported third-party behavior
    - expected: unsupported feature report or sandbox proposal

18. `fixture_js_heavy_spa`
    - purpose: JS-dependent content
    - expected: audit notes and limitations

## 13. Acceptance Criteria

The workflow is production-ready only when all are true:

1. valid Hermes skill/frontmatter exists
2. Droid-only Mission Manifest template exists
3. direct EdgeGDE mutation is forbidden
4. policy gate is explicit
5. URL security hardening is implemented
6. browser visual oracle is used only for verification
7. schemas are defined and validated
8. design tokens align with existing EdgeGDE `DesignTokens`
9. CanvasDocument adapter is non-authoritative
10. visual parity thresholds are enforced at declared viewport(s)
11. behavior contract is enforced for declared interactions
12. no raw CSS bundles are persisted as authoritative renderer
13. no raw JS is persisted as authoritative behavior engine
14. audit log includes hashes, rule versions, decisions, and failures
15. deterministic output is tested
16. verification fixtures pass
17. unsupported features are explicitly reported
18. no implementation path bypasses Aegis

## 14. Implementation Phases

### Phase 1: Specification and mission template

Deliverables:

- `website_visual_fidelity_reconstruction_spec.md`
- Mission Manifest template
- policy request template
- audit log schema outline

Acceptance:

- spec is reviewed
- no implementation started
- no EdgeGDE mutation path added

### Phase 2: Extraction and sanitization

Deliverables:

- URL validation
- fetch limits
- browser snapshot
- DOM snapshot
- sanitizer

Acceptance:

- public URL fixtures pass
- private/credential URLs are rejected
- scripts/event handlers are stripped

### Phase 3: Visual fidelity pipeline

Deliverables:

- screenshot capture
- visual diff metrics
- viewport reports
- unsupported visual features list

Acceptance:

- default thresholds are enforced
- visual report is deterministic
- browser oracle is not persisted as state authority

### Phase 4: EdgeGDE adapter

Deliverables:

- `CanvasDocument` adapter proposal
- design token alignment
- responsive override support where available
- sandbox fallback proposal where needed

Acceptance:

- adapter validates against existing EdgeGDE types
- adapter is marked non-authoritative
- mutation requires separate policy approval

### Phase 5: Behavior contract

Deliverables:

- behavior contract schema
- interaction fixtures
- behavior verification report

Acceptance:

- declared interactions pass
- unsupported interactions are listed
- no raw third-party JS is persisted

### Phase 6: Verification and hardening

Deliverables:

- schema validation
- security scan
- deterministic artifact tests
- visual fixtures
- behavior fixtures
- audit hash verification

Acceptance:

- tests pass
- typecheck passes
- lint passes
- dry-run deploy passes if runtime code is touched
- no direct EdgeGDE mutation occurs

## 15. Verification Commands

When implemented, use:

```bash
hermes skills list --source local | grep -i website-to-code
```

```bash
python3 -c "import yaml; yaml.safe_load(open('skills/software-development/website-to-code/SKILL.md')); print('SKILL frontmatter OK')"
```

```bash
npx tsx tests/website-visual-fidelity/*.test.ts
```

```bash
bun run typecheck -w apps/edge-runtime
```

```bash
npx eslint apps/edge-runtime/src/cloner apps/edge-runtime/src/transpiler tests/website-visual-fidelity
```

If runtime code is touched:

```bash
npx wrangler deploy --dry-run
```

Always verify deploy output:

```bash
npx wrangler deploy --dry-run 2>&1 | grep -E "ERROR|Build failed"
```

## 16. Final Product Definition

The 100/100 workflow is:

```text
website_visual_fidelity_reconstruction
```

It reconstructs a public website into EdgeGDE-compatible artifacts that:

- visually match the source at declared viewport(s)
- preserve declared interaction behavior
- use EdgeGDE-native types where possible
- fall back to sandboxed compatibility where native reconstruction cannot satisfy parity
- never mutate EdgeGDE state directly
- always require Aegis policy approval before mutation

It is not:

```text
universal raw website cloner
```

The correct success statement is:

```text
The reconstructed website is visually equivalent at declared viewport(s) and behaviorally equivalent for declared interactions, while remaining EdgeGDE-compatible, governed, auditable, and non-authoritative until policy-approved.
```
