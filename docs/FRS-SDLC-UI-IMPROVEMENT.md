# Functional Requirements Specification — SDLC UI Improvement
## Applying UX Principles Report v2 to EdgeGDE SDLC Interface

**Version:** 1.0
**Status:** Draft
**Based on:** docs/ux-research/UX_PRINCIPLES_REPORT_v2.md
**Kanban Task:** EG-FEAT-0035
**Stack:** Svelte 5 / TypeScript 5 / Tailwind CSS 4 / Design Themes System

---

## 1. Executive Summary

This FRS defines UI/UX improvements to the EdgeGDE SDLC interface by systematically applying the 19 psychological UX principles, 10 NN/g heuristics, 10 token-efficiency patterns, 7 Baymard patterns, and 6 NN/g article insights from the UX Principles Report v2.

**Goal:** Transform the SDLC interface from a functional tool into a psychologically optimized, delightful developer experience that reduces cognitive load, increases completion rates, and builds trust.

**Scope:** All 8 SDLC stages across Product UX (developer-facing) and SDLC UX (workflow) dimensions.

---

## 2. Current State Assessment

### 2.1 Existing SDLC UI Components
| Stage | Current UI | Pain Points |
|-------|------------|-------------|
| Issue Creation | Basic form, no defaults | Blank forms, decision fatigue |
| PR Creation | Template-based, manual | No smart defaults, "Start review" framing |
| Code Review | Basic diff view | No progress visualization, loss framing missing |
| CI/CD | Status badges only | No progress visualization, no value-first |
| Deployment | Basic confirm dialog | "Start deploy" framing, no loss aversion |
| Incident Response | Manual runbooks | No value-first, no progress viz |
| Config Management | Raw YAML/JSON editors | Blank forms, no smart defaults |
| Onboarding | Documentation only | Zero progress, no IKEA effect |

### 2.2 Gap Analysis vs UX Principles Report v2
| Principle | Current State | Target State |
|-----------|---------------|--------------|
| Smart Defaults | Minimal | Comprehensive across all forms |
| Never Start at Zero | 0% everywhere | Minimum 20% progress everywhere |
| Value-First/Reciprocity | Ask first, give later | Show value before asking |
| Loss Aversion Framing | Gain-focused | Loss-framed for critical actions |
| Goal Gradient/Progress | None | Progress rings, gradient everywhere |
| IKEA Effect | No builder flow | Builder flows before auth |
| Smart Framing | "Sign up", "Start" | "Continue", "Continue deploy" |
| Decision Fatigue | Unlimited options | Max 6, progressive disclosure |
| Visual Hierarchy | Inconsistent | Design token system |
| Error Prevention | Reactive | Proactive inline validation |

---

## 3. Functional Requirements

### 3.1 Cross-Cutting Requirements (Apply to All Stages)

#### FR-001: Smart Defaults System
**Priority:** P0 | **Principle:** Smart Defaults
**Requirement:** All forms MUST pre-fill with intelligent defaults derived from context (user preferences, project config, team conventions, sensible global defaults).
- **Acceptance Criteria:**
  - Zero blank required fields on form load
  - Defaults derivable from: user profile, project config (.edgegde.yaml), team conventions, global sensible defaults
  - User can override any default; system learns from overrides
  - Defaults persisted per user/project

#### FR-002: Minimum Progress Indicator (Never Start at Zero)
**Priority:** P0 | **Principle:** Never Start at Zero / Goal Gradient Effect
**Requirement:** Every multi-step flow MUST show minimum 20% progress on first render.
- **Acceptance Criteria:**
  - Progress indicators never show 0%
  - First step pre-checked if already completed (e.g., "Repo created ✓")
  - Progress ring/bar minimum value = 20%
  - Design token: `--progress-min: 20%`

#### FR-003: Smart Framing ("Continue" not "Start")
**Priority:** P0 | **Principle:** Smart Framing
**Requirement:** All primary CTAs for continuation MUST use "Continue" language, never "Start" or "Sign Up".
- **Acceptance Criteria:**
  - "Continue deployment" not "Start deployment"
  - "Continue review" not "Start review"
  - "Continue setup" not "Start setup"
  - Design token: `--cta-continue: "Continue"`

#### FR-004: Value-First / Reciprocity Pattern
**Priority:** P0 | **Principle:** Value-First / Reciprocity
**Requirement:** Show genuine value before requesting commitment.
- **Acceptance Criteria:**
  - CI results visible before login prompt
  - Deploy preview shown before confirmation
  - Partial results (score, top issues) shown before "Save report"
  - Design token: `--preview-bg`, `--cta-reciprocity`

#### FR-005: Loss Aversion Framing for Critical Actions
**Priority:** P1 | **Principle:** Loss Aversion / Threat Framing > Pitch Framing
**Requirement:** Destructive/irreversible actions MUST frame as loss prevention.
- **Acceptance Criteria:**
  - "This deploy will lose 3 days of analytics data" vs "Deploy now"
  - "This config change will lose audit logging" vs "Save config"
  - Dismiss button: "I'll risk it" not "Cancel"
  - Design tokens: `--loss-frame-bg`, `--loss-frame-border`, `--dismiss-label`

#### FR-006: Decision Fatigue Reduction (Max 6 Choices)
**Priority:** P1 | **Principle:** Decision Fatigue Reduction
**Requirement:** No selector shall present more than 6 visible options without progressive disclosure.
- **Acceptance Criteria:**
  - Dropdowns/selectors max 6 visible options
  - "Show more" progressive disclosure for >6
  - Design token: `--dropdown-max-height`, `--option-limit: 6`

#### FR-007: Artificial Head Start / Endowed Progress
**Priority:** P1 | **Principle:** Endowed Progress Effect
**Requirement:** Multi-step flows must pre-credit completed implicit steps.
- **Acceptance Criteria:**
  - New repo: "README created ✓, CI configured ✓" pre-checked
  - New PR: "Branch created ✓, CI queued ✓" pre-checked
  - Onboarding: "Account created ✓, First login ✓" pre-checked
  - Design token: `--progress-base: 20%`, `--sdlc-progress-base: 2`

#### FR-008: IKEA Effect Builder Flows
**Priority:** P1 | **Principle:** IKEA Effect / Endowment Effect
**Requirement:** Let users build/configure before requiring authentication/commitment.
- **Acceptance Criteria:**
  - Project config → CI preview → Deploy preview → THEN GitHub auth
  - Config editor with live preview before save
  - Design tokens: `--builder-step-active`, `--builder-progress`

#### FR-009: Progress Visualization (Goal Gradient)
**Priority:** P0 | **Principle:** Goal Gradient Effect
**Requirement:** All multi-step flows MUST show progress with momentum.
- **Acceptance Criteria:**
  - Progress rings/bars on all multi-step flows
  - "20% complete" not "Step 1 of 5"
  - Checkmarks for completed steps
  - Design tokens: `--progress-ring-color`, `--pr-progress-ring`

#### FR-010: Visual Hierarchy & Design Token System
**Priority:** P0 | **Principle:** Visual Hierarchy (NN/g Heuristic #8)
**Requirement:** Consistent design token system for all UI.
- **Acceptance Criteria:**
  - Spacing scale: 4, 8, 12, 16, 24, 32, 48, 64
  - Contrast ratios ≥ 4.5:1
  - Heading scale: consistent typographic scale
  - Tokens for all FR-001 through FR-009 properties

---

### 3.2 Stage-Specific Requirements

#### Stage 1: Issue Creation
| Requirement | Implementation |
|-------------|----------------|
| **Smart Defaults** | Pre-fill: issue type (Bug), priority (Medium), assignee (me), labels (team conventions) |
| **Never Zero** | "Title added ✓" pre-checked on focus |
| **Smart Framing** | "Continue describing issue" not "Create issue" |
| **Decision Fatigue** | Issue type: max 6 types; Labels: type-ahead with top 6 |
| **Progress** | "Title ✓ → Description → Labels → Submit" (20% → 100%) |

#### Stage 2: PR Creation
| Requirement | Implementation |
|-------------|----------------|
| **Smart Defaults** | Base branch (main), reviewers (codeowners), labels (from branch name) |
| **Never Zero** | "Branch created ✓, CI queued ✓" pre-checked |
| **Smart Framing** | "Continue creating PR" not "Create PR" |
| **Value First** | Show diff summary + CI status BEFORE "Create PR" button |
| **Progress** | "Branch ✓ → CI ✓ → Description → Reviewers → Create" |

#### Stage 3: Code Review
| Requirement | Implementation |
|-------------|----------------|
| **Progress Viz** | "Files reviewed: 3/8" with progress ring; "20% → 100%" |
| **Loss Framing** | "Skipping review loses: 3 security issues, 2 performance regressions" |
| **Smart Defaults** | Auto-assign reviewers from CODEOWNERS; default "Approve" |
| **Never Zero** | "Opened PR ✓" pre-checked (20% progress) |
| **Smart Framing** | "Continue review" not "Start review" |

#### Stage 4: CI/CD Pipeline
| Requirement | Implementation |
|-------------|----------------|
| **Value First** | Show test results, coverage, bundle size BEFORE "Deploy" prompt |
| **Progress Viz** | "Build ✓ → Test ✓ → Lint ✓ → Deploy" with checkmarks |
| **Loss Framing** | "Deploy will lose: 3 days analytics, current feature flag state" |
| **Smart Defaults** | Env: staging; Strategy: rolling; Auto-rollback: on |

#### Stage 5: Deployment
| Requirement | Implementation |
|-------------|----------------|
| **Smart Framing** | "Continue deployment" not "Start deployment" |
| **Loss Framing** | "This deploy loses: feature flag config, 47 user sessions" |
| **Value First** | Show preview URL, diff summary, risk score BEFORE "Continue" |
| **Progress** | "Preview ✓ → Staging ✓ → Production (current)" |

#### Stage 6: Incident Response
| Requirement | Implementation |
|-------------|----------------|
| **Value First** | Show impact assessment, similar past incidents, runbook BEFORE "Acknowledge" |
| **Loss Framing** | "Not acknowledging loses: SLA breach in 12min, 2,400 users affected" |
| **Progress** | "Detected ✓ → Investigating → Mitigating → Resolved" |
| **Smart Defaults** | Auto-assign on-call; pre-fill incident template |

#### Stage 7: Config Management
| Requirement | Implementation |
|-------------|----------------|
| **Smart Defaults** | Pre-fill from .edgegde.yaml, team conventions, global defaults |
| **Never Zero** | "Config loaded ✓" pre-checked |
| **Decision Fatigue** | Max 6 env vars visible; "Show advanced" for rest |
| **Inline Validation** | Real-time YAML/JSON validation with suggested fixes |

#### Stage 8: Onboarding
| Requirement | Implementation |
|-------------|----------------|
| **IKEA Effect** | Config project → Preview deploy → Run tests → THEN GitHub auth |
| **Artificial Head Start** | "Repo cloned ✓, Deps installed ✓, Tests passing ✓" (60% progress) |
| **Smart Defaults** | Stack detected from repo; CI template suggested |
| **Progress** | "Clone ✓ → Install ✓ → Test ✓ → Config → Deploy → Auth" |

---

## 4. Non-Functional Requirements

| NFR | Requirement |
|-----|-------------|
| **Performance** | Form render < 100ms; Progress updates < 16ms |
| **Accessibility** | WCAG 2.1 AA; Progress announced to screen readers |
| **Responsiveness** | Mobile-first; Touch targets ≥ 44px |
| **Token Efficiency** | Leverage existing EdgeGDE compression (50% threshold, 20% target) |
| **Caching** | OpenRouter response cache (300s TTL) for repeated LLM calls |
| **Context Limits** | < 2000 lines context per LLM call |

---

## 5. Design Token Extensions

Add to `tailwind.config.js`:

```javascript
theme: {
  extend: {
    // Progress tokens
    progress: {
      min: '20%',
      ring: 'var(--progress-ring-color)',
      track: 'var(--progress-track-color)',
    },
    // Loss frame tokens
    lossFrame: {
      bg: 'var(--loss-frame-bg)',
      border: 'var(--loss-frame-border)',
      countdown: 'var(--countdown-color)',
    },
    // Smart default tokens
    default: {
      bg: 'var(--default-bg)',
      text: 'var(--default-text)',
      border: 'var(--default-border)',
    },
    // Price anchor tokens
    anchor: {
      high: 'var(--anchor-high)',
      target: 'var(--target-badge)',
    },
    // Builder flow tokens
    builder: {
      stepActive: 'var(--builder-step-active)',
      progress: 'var(--builder-progress)',
    },
    // CTA tokens
    cta: {
      continue: 'var(--cta-continue)',
      reciprocity: 'var(--cta-reciprocity)',
    },
  }
}
```

---

## 6. Component Library Specifications

### 6.1 SmartDefaultForm.svelte
```typescript
interface SmartDefaultFormProps {
  defaults: Record<string, any>;
  onSubmit: (data: any) => void;
  children: Snippet;
}
```

### 6.2 ProgressRing.svelte
```typescript
interface ProgressRingProps {
  value: number;           // 20-100
  minProgress?: number;    // default 20
  label?: string;
  showPercentage?: boolean;
}
```

### 6.3 LossFrame.svelte
```typescript
interface LossFrameProps {
  itemsAtRisk: string[];
  countdown?: number;
  dismissLabel?: string;  // default "I'll risk it"
  children: Snippet;
}
```

### 6.4 ValueFirstPreview.svelte
```typescript
interface ValueFirstPreviewProps {
  previewData: any;
  ctaText: string;
  onSave: () => void;
}
```

### 6.5 BuilderFlow.svelte
```typescript
interface BuilderFlowProps {
  steps: BuilderStep[];
  onComplete: () => void;
  initialProgress?: number; // default 20
}
```

### 6.6 SmartDefaultSelect.svelte
```typescript
interface SmartDefaultSelectProps {
  options: SelectOption[];
  maxVisible?: number;  // default 6
  defaultValue?: string;
  showMoreLabel?: string; // "Show more"
}
```

---

## 7. Implementation Phases

| Phase | Scope | Effort | Dependencies |
|-------|-------|--------|--------------|
| **Phase 1: Foundation** | Design tokens, ProgressRing, SmartDefaultForm | 2 weeks | Tailwind config |
| **Phase 2: Core Patterns** | SmartDefaultForm, ProgressRing, LossFrame, ValueFirstPreview | 3 weeks | Phase 1 |
| **Phase 3: Stage Integration** | Issue Creation, PR Creation, Code Review | 4 weeks | Phase 2 |
| **Phase 4: Advanced Stages** | CI/CD, Deployment, Incident, Config, Onboarding | 4 weeks | Phase 3 |
| **Phase 5: Polish** | Visual hierarchy, accessibility, token efficiency audit | 2 weeks | Phase 4 |

**Total: ~15 weeks**

---

## 8. Acceptance Criteria Summary

| Principle | Measurable Criteria |
|-----------|---------------------|
| Smart Defaults | 0 blank required fields on form load; 100% fields pre-filled |
| Never Zero | 100% of multi-step flows show ≥20% on load |
| Smart Framing | 100% continuation CTAs use "Continue" language |
| Value First | 100% critical flows show value before ask |
| Loss Aversion | 100% destructive actions use loss framing |
| Decision Fatigue | 100% selectors ≤6 visible options |
| Artificial Head Start | 100% multi-step flows pre-credit implicit steps |
| IKEA Effect | 100% auth gates AFTER builder flow |
| Progress Viz | 100% multi-step flows show progress ring/bar |
| Visual Hierarchy | 100% components use design tokens |

---

## 9. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Token system conflicts with existing themes | Medium | High | Audit existing tokens first; namespace new tokens |
| Progress rings add render overhead | Low | Medium | Use CSS-only rings where possible |
| Loss framing feels aggressive | Medium | Medium | A/B test framing; provide "I understand" alternative |
| Smart defaults feel presumptive | Medium | Medium | Always editable; "Reset to defaults" button |
| Token efficiency regression | Low | High | CI gate: token budget per SDLC operation |

---

## 10. Appendix: Quick Reference Card

```
EDGEGDE SDLC UX PRINCIPLES QUICK REFERENCE
☐ Smart Defaults on every form field
☐ Never start at 0% — minimum 20% progress
☐ Value first, ask later (reciprocity)
☐ "Continue" not "Sign Up" / "Start"
☐ Show loss, not gain (loss aversion 2x)
☐ Threat framing > pitch framing (status quo bias)
☐ Anchor high, then present target (contrast)
☐ Let them build before asking (IKEA effect)
☐ Artificial head start (endowed progress)
☐ Goal gradient: show momentum
☐ Limit choices to 6 max
☐ Token budgets per SDLC operation
☐ Compression auto-triggers at 50%
☐ Cache identical LLM requests (300s TTL)
☐ Selective context: <2000 lines per task
```