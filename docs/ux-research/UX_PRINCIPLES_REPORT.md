# UX Principles Report for EdgeGDE
## Research-Driven Psychological & Technical Principles for Svelte/TS/Tailwind + Design Themes System

---

## Executive Summary

This report synthesizes **19 psychological UX principles** and **10 token-efficiency patterns** from authoritative sources to create a unified framework for EdgeGDE's Svelte/TypeScript/Tailwind stack with design themes system. Each principle includes implementation guidance for both **Product UX** (user-facing) and **SDLC UX** (developer workflows).

**Sources Analyzed:**
- UXPeak YouTube: "The UX Psychology Behind Apps People Can't Stop Using" (11:33)
- UXPeak.com: Product skills curriculum
- Nielsen Norman Group: 10 Usability Heuristics + psychology articles
- Baymard Institute: 450+ ecommerce UX research articles
- EdgeGDE Runtime Config: Token-efficient patterns (already codified)

---

## Part 1: Psychological UX Principles (from UXPeak Video + NN/g)

### 1. Smart Defaults (Pre-fill, Don't Blank)
**Source:** UXPeak video (0:28-1:40) — "Stop giving users blank forms"
**Evidence:** 70-90% of users never change defaults; not laziness — trust
**Psychology:** Reduces decision fatigue; shifts task from "fill from scratch" → "scan and adjust"

| Aspect | Product UX | SDLC UX |
|--------|-----------|---------|
| **Implementation** | Pre-fill timezone, currency, theme, notifications | Pre-fill PR templates, CI config, review labels |
| **Svelte/TS** | `bind:value={formData} initialValues={defaults}` | `git commit --template=.gitmessage` |
| **Tailwind** | `data-[default]:bg-muted` styling | N/A |
| **Design Theme** | `--default-bg`, `--default-text` tokens | N/A |

---

### 2. Decision Fatigue Reduction (Choice Limiting)
**Source:** UXPeak video (0:45-1:00) — Jam study: 24 flavors → 3% buy; 6 flavors → 30% buy
**Evidence:** 10x purchase rate improvement by limiting options
**Psychology:** Analysis paralysis prevention; cognitive load reduction

| Aspect | Product UX | SDLC UX |
|--------|-----------|---------|
| **Implementation** | Max 6 visible options; "Show more" progressive disclosure | Limit PR labels to 6; default deploy env to staging |
| **Svelte/TS** | `<Select options={top6} />` `<RadioGroup options={curated} />` | `deploy.yml` with `environment: staging` default |
| **Tailwind** | `max-h-60 overflow-auto` dropdown | N/A |
| **Design Theme** | `--dropdown-max-height`, `--option-limit: 6` | N/A |

---

### 3. Goal Gradient Effect (Progress Visualization)
**Source:** UXPeak video (2:00-3:00) — Car wash: 0% deflating; 20% momentum
**Evidence:** 2x completion rate with artificial 20% head start
**Psychology:** "The closer people feel to finishing, the faster they move"

| Aspect | Product UX | SDLC UX |
|--------|-----------|---------|
| **Implementation** | Never 0% — minimum 20% progress; pre-check first step | PR review: "Branch created ✓, CI queued ✓" pre-checked |
| **Svelte/TS** | `<ProgressBar value={20} initialStep={1} />` | `gh pr create --body-file=.github/PULL_REQUEST_TEMPLATE.md` |
| **Tailwind** | `data-progress="20"` styling; never `0%` | `--progress-min: 20%` token |
| **Design Theme** | `--progress-min: 20%`, `--progress-ring-color` | `--pr-progress-ring` |

---

### 4. Endowed Progress / Artificial Head Start
**Source:** UXPeak video (2:00-3:00) — Car wash: 8 empty vs 10 with 2 pre-filled = 2x completion
**Evidence:** Same 8 washes needed; 2 pre-filled → 2x completion rate
**Psychology:** "Never start a user at zero. Find something they've already done and count it."

| Aspect | Product UX | SDLC UX |
|--------|-----------|---------|
| **Implementation** | "Account created ✓, First login ✓" pre-checked | New repo: "README created ✓, CI configured ✓" pre-checked |
| **Svelte/TS** | `<OnboardingProgress initialSteps={['created','login']} />` | `gh repo create --template=starter` with checklist |
| **Tailwind** | `data-step="2"` instead of `data-step="1"` | `--onboard-min-steps: 2` |
| **Design Theme** | `--progress-base: 20%` token | `--sdlc-progress-base: 2` |

---

### 5. Smart Framing: "Continue" vs "Sign Up"
**Source:** UXPeak video (1:00-1:15) — Button says "Continue" not "Sign Up"
**Evidence:** "Leaving doesn't feel like skipping a form, it feels like abandoning something they made"
**Psychology:** Shifts mental model from "task" → "investment"; loss aversion activates

| Aspect | Product UX | SDLC UX |
|--------|-----------|---------|
| **Implementation** | `<Button>Continue</Button>` not `<Button>Sign Up</Button>` | "Continue deployment" not "Start deployment" |
| **Svelte/TS** | `variant="primary"` with semantic label | `<Button>Continue review</Button>` |
| **Tailwind** | N/A | N/A |
| **Design Theme** | `--cta-continue: "Continue"` token | `--sdlc-cta-continue` |

---

### 5. Value-First / Reciprocity (Give Before Ask)
**Source:** UXPeak video (4:30-5:30) — SEO analyzer shows real report first, then asks for signup
**Evidence:** "Difference in conversion is massive because of reciprocity" — Cialdini: #1 driver
**Evidence:** Free samples increase purchases 2000% (Costco, Spotify, Notion)
**Psychology:** Deep human instinct to return favors; unconscious debt created

| Aspect | Product UX | SDLC UX |
|--------|-----------|---------|
| **Implementation** | Show partial results (score, top issues) → then ask | Show CI results before requiring login; show deploy preview |
| **Svelte/TS** | `<ResultsPreview data={partial} cta="Save full report" />` | `<DeployPreview diff={diff} cta="Confirm deploy" />` |
| **Tailwind** | `data-preview="true"` styling | `--preview-border` token |
| **Design Theme** | `--preview-bg`, `--cta-reciprocity` | `--sdlc-preview-border` |

---

### 6. Loss Aversion Framing (Show Loss, Not Gain)
**Source:** UXPeak video (9:30-10:30) — "Don't sell what they'll gain, show what they'll lose"
**Evidence:** Loss aversion = 2x psychological power of gain (Kahneman Nobel)
**Evidence:** Storage app: "You're about to lose your actual files" + countdown vs "Upgrade now"

| Aspect | Product UX | SDLC UX |
|--------|-----------|---------|
| **Implementation** | `<LossFrame itemsAtRisk={files} countdown={deadline} />` | "This deploy will lose 3 days of analytics data" |
| **Svelte/TS** | `<LossFrame itemsAtRisk={files} dismissLabel="I'll risk it" />` | `<LossAversionCard itemsAtRisk={data} />` |
| **Tailwind** | `data-loss-frame="true"` red accent | `--loss-frame-border: red-500` |
| **Design Theme** | `--loss-frame-bg`, `--countdown-color` | `--sdlc-loss-frame` |

---

### 7. Threat Framing > Pitch Framing (Status Quo Bias)
**Source:** UXPeak video (9:15-9:30) — "Threat wins every time because of status quo bias"
**Evidence:** Screen 1 (pitch) vs Screen 2 (threat: actual files by name + countdown) → threat wins
**Psychology:** Humans wired to protect what they already have; must feel cost of inaction

| Aspect | Product UX | SDLC UX |
|--------|-----------|---------|
| **Implementation** | `<LossAversionCard itemsAtRisk={files} countdown={deadline} dismissLabel="I'll risk it" />` | "This config change will lose audit logging" |
| **Svelte/TS** | `<LossAversionCard itemsAtRisk={files} dismissLabel="I'll risk it" />` | `<LossFrame message="This will lose audit logging" />` |
| **Tailwind** | `border-red-500` `animate-pulse` | `--sdlc-threat-border` |
| **Design Theme** | `--threat-frame-bg`, `--dismiss-label` | `--sdlc-threat-frame` |

---

### 8. Contrast Effect / Price Anchoring
**Source:** UXPeak video (10:00-11:00) — $90 Wagyu → $40 salmon reasonable; $1900 laptop → $50 plan = 2.6%
**Evidence:** Brain evaluates relative to immediate predecessor; not absolute evaluation
**Evidence:** Restaurants: $90 Wagyu makes $40 salmon look reasonable

| Aspect | Product UX | SDLC UX |
|--------|-----------|---------|
| **Implementation** | `<PriceAnchor high=$1900 target=$50 badge="Just 2.6%" />` | "Enterprise $500/mo" before "Team $50/mo" |
| **Svelte/TS** | `<PriceAnchor high={1900} target={50} badge="Just 2.6%" />` | `<PricingTable plans={['enterprise','team']} anchor="enterprise" />` |
| **Tailwind** | `data-anchor="high"` styling | `--price-anchor-high` token |
| **Design Theme** | `--anchor-high`, `--target-badge` | `--sdlc-price-anchor` |

---

### 9. IKEA Effect / Endowment Effect
**Source:** UXPeak video (5:45-7:00) — "When people build something themselves, they value it significantly more"
**Evidence:** Duolingo: pick language, set goal, complete lesson BEFORE signup → 10 min invested → won't throw away
**Evidence:** IKEA effect: people value self-built items significantly more than identical pre-made

| Aspect | Product UX | SDLC UX |
|--------|-----------|---------|
| **Implementation** | Builder flow: pick stack → config CI → deploy preview → then auth | Let devs configure project, see preview deploy, run tests BEFORE GitHub auth |
| **Svelte/TS** | `<BuilderFlow><Step>Pick stack</Step><Step>Config CI</Step><SignupGate /></BuilderFlow>` | `<BuilderFlow><Step>Config CI</Step><Step>Deploy preview</Step><AuthGate /></BuilderFlow>` |
| **Tailwind** | `data-builder-step="2"` progression | `--builder-step` token |
| **Design Theme** | `--builder-step-active`, `--builder-progress` | `--sdlc-builder-step` |

---

### 8. Never Start at Zero (Minimum Progress)
**Source:** UXPeak video (2:45-3:15) — LinkedIn profile strength never at 0%; 0% = standing still
**Evidence:** 0% = standing still; 20% = momentum; artificial head start creates real motivation
**Evidence:** Car wash: 2/10 stamps pre-filled → 2x completion

| Aspect | Product UX | SDLC UX |
|--------|-----------|---------|
| **Implementation** | `<ProgressRing value={20} label="Profile 20% complete" />` | New issue: "Title added ✓" pre-checked |
| **Svelte/TS** | `<ProgressRing value={20} label="Profile 20% complete" />` | `<IssueProgress initialChecks={['title']} />` |
| **Tailwind** | `--progress-min: 20%` token | `--sdlc-progress-min: 1` |
| **Design Theme** | `--progress-min: 20%` | `--sdlc-progress-min` |

---

### 9. Status Quo Bias / Loss Framing for Upgrades
**Source:** UXPeak video (9:15-10:00) — "Threat wins every time because of status quo bias"
**Evidence:** Humans wired to protect what they have; must feel cost of inaction
**Evidence:** Storage app: "Your actual files by name with countdown" vs "Upgrade now"

| Aspect | Product UX | SDLC UX |
|--------|-----------|---------|
| **Implementation** | `<LossAversionCard itemsAtRisk={files} countdown={deadline} dismissLabel="I'll risk it" />` | "This config change will lose audit logging" |
| **Svelte/TS** | `<LossAversionCard itemsAtRisk={files} dismissLabel="I'll risk it" />` | `<LossFrame message="This will lose audit logging" />` |
| **Tailwind** | `border-red-500 animate-pulse` | `--sdlc-threat-border` |
| **Design Theme** | `--threat-frame-bg`, `--dismiss-label` | `--sdlc-threat-frame` |

---

### 10. Contrast Effect / Price Anchoring
**Source:** UXPeak video (10:00-11:00) — $90 Wagyu → $40 salmon reasonable; $1900 laptop → $50 plan = 2.6%
**Evidence:** Brain evaluates relative to immediate predecessor; not absolute evaluation
**Evidence:** Restaurants: $90 Wagyu makes $40 salmon look reasonable

| Aspect | Product UX | SDLC UX |
|--------|-----------|---------|
| **Implementation** | `<PriceAnchor high=$1900 target=$50 badge="Just 2.6%" />` | "Enterprise $500/mo" before "Team $50/mo" |
| **Svelte/TS** | `<PriceAnchor high={1900} target={50} badge="Just 2.6%" />` | `<PricingTable plans={['enterprise','team']} anchor="enterprise" />` |
| **Tailwind** | `data-anchor="high"` styling | `--price-anchor-high` token |
| **Design Theme** | `--anchor-high`, `--target-badge` | `--sdlc-price-anchor` |

---

### 9. IKEA Effect / Endowment Effect
**Source:** UXPeak video (5:45-7:00) — "When people build something themselves, they value it significantly more"
**Evidence:** Duolingo: pick language, set goal, complete lesson BEFORE signup → 10 min invested → won't throw away
**Evidence:** IKEA effect: people value self-built items significantly more than identical pre-made

| Aspect | Product UX | SDLC UX |
|--------|-----------|---------|
| **Implementation** | Builder flow: pick stack → config CI → deploy preview → then auth | Let devs configure project, see preview deploy, run tests BEFORE requiring GitHub auth |
| **Svelte/TS** | `<BuilderFlow><Step>Pick stack</Step><Step>Config CI</Step><SignupGate /></BuilderFlow>` | `<BuilderFlow><Step>Config CI</Step><Step>Deploy preview</Step><AuthGate /></BuilderFlow>` |
| **Tailwind** | `data-builder-step="2"` progression | `--builder-step` token |
| **Design Theme** | `--builder-step-active`, `--builder-progress` | `--sdlc-builder-step` |

---

### 10. Never Start at Zero (Minimum Progress)
**Source:** UXPeak video (2:45-3:15) — LinkedIn profile strength never at 0%; car wash 2/10 stamps
**Evidence:** 0% = standing still; 20% = momentum; artificial head start creates real motivation
**Evidence:** Car wash: 2/10 stamps pre-filled → 2x completion

| Aspect | Product UX | SDLC UX |
|--------|-----------|---------|
| **Implementation** | `<ProgressRing value={20} label="Profile 20% complete" />` | New issue: "Title added ✓" pre-checked |
| **Svelte/TS** | `<ProgressRing value={20} label="Profile 20% complete" />` | `<IssueProgress initialChecks={['title']} />` |
| **Tailwind** | `--progress-min: 20%` token | `--sdlc-progress-min: 1` |
| **Design Theme** | `--progress-min: 20%` | `--sdlc-progress-min` |

---

### 11. Visual Hierarchy System (Spacing, Contrast, Hierarchy, Polish)
**Source:** UXPeak.com — "Beautiful UI is only the surface. Learn how spacing, hierarchy, contrast, copy, and interaction details make a screen feel polished and easy to trust."
**Implementation:** Tailwind design tokens for spacing scale (4, 8, 12, 16, 24, 32, 48, 64); contrast ratios ≥4.5:1; consistent heading scale

| Aspect | Implementation |
|--------|----------------|
| **Svelte/TS** | `@theme` tokens; `prose` classes; `focus-visible` rings |
| **Tailwind** | `@theme { --spacing-* }`; `prose` classes; `focus-visible` rings |
| **Design Theme** | Already in EdgeGDE themes system — ensure consistent application |

---

### 10. Friction Removal / Clarity in User Flows
**Source:** UXPeak.com — "Understand what people actually need, remove unnecessary friction, and turn messy flows into experiences that feel simple, natural, and genuinely world-class."
**Implementation:** Audit each flow for unnecessary steps; combine screens where possible; inline validation; inline editing

---

### 11. Retention Design: Onboarding, Habit Loops, Reactivation
**Source:** UXPeak.com — "Design onboarding, habit loops, empty states, and reactivation flows that help people understand the value and keep coming back."
**Implementation:** First-run experience with progressive disclosure; empty states with clear CTAs; re-engagement emails with deep links

---

### 12. Conversion Design: Product Pages, Pricing, Forms, Checkout
**Source:** UXPeak.com — "Learn how to shape product pages, pricing pages, forms, and checkouts so users understand faster and take action with more confidence."
**Implementation:** Single-column forms; inline validation; progress indicators; trust signals (testimonials, badges); clear value prop above fold

---

### 13. AI-Enhanced Design Workflow
**Source:** UXPeak.com — "Almost everyone uses AI now... The real skill is knowing how to prompt it to get the best results, and having the design taste to spot which version will actually work the best."
**Implementation:** AI-assisted component generation with design system constraints; automated accessibility audits; AI-powered design token generation

---

## Part 2: NN/g 10 Usability Heuristics (Applied to EdgeGDE)

| # | Heuristic | EdgeGDE Application |
|---|-----------|---------------------|
| 1 | **Visibility of System Status** | Loading states, progress bars, toast notifications, real-time CI status |
| 2 | **Match System & Real World** | Domain language (not dev jargon); "Deploy" not "Execute pipeline" |
| 3 | **User Control & Freedom** | Undo deploy; cancel PR; revert config; escape hatches everywhere |
| 4 | **Consistency & Standards** | Design tokens; component library; shared patterns across apps |
| 5 | **Error Prevention** | Inline validation; confirm destructive actions; type-safe APIs |
| 6 | **Recognition Over Recall** | Searchable command palette; autocomplete; recent projects sidebar |
| 7 | **Flexibility & Efficiency** | Keyboard shortcuts; power-user modes; bulk operations |
| 8 | **Aesthetic & Minimalist** | Design tokens; whitespace; progressive disclosure; no clutter |
| 9 | **Error Recognition & Recovery** | Clear error messages; suggested fixes; one-click rollback |
| 10 | **Help & Documentation** | Contextual help; command palette; inline docs; AI assistant |

---

## Part 3: EdgeGDE Token-Efficient Patterns (Runtime Config)

*Already codified in `github/edgegde-sdlc/references/token-efficient-patterns.md`*

| Pattern | Description | Token Savings |
|---------|-------------|---------------|
| **Runtime Compression** | Auto-compress at 50% threshold, target 20%, protect first 3/last 20 messages | 60-80% |
| **OpenRouter Response Cache** | 5-min TTL for identical requests | 100% on repeats |
| **Context Hierarchy** | Load rules→spec→source→error→history; stop at <2000 lines | 70-90% |
| **Selective Include** | Only load files relevant to current task | 80-95% |
| **Duplicate Detection** | Skip re-uploaded documents | 100% on dupes |
| **Client-Side Context Injection** | 64KB cap, read once, inject per request | 90%+ |
| **Inline SVG Geometry** | Replace Mermaid for simple shapes | 10x smaller |
| **Token Budgets** | Per-operation caps (500-12k) | Prevents overflow |
| **Peak Pricing Avoidance** | Cron at off-peak UTC (10,12,22,04) | 50% cost reduction |
| **Provider Fallback** | DeepSeek → OpenRouter (Nemotron, Gemma) | Availability + cost |

---

## Part 4: Baymard Institute Ecommerce UX (Applicable Patterns)

| Pattern | EdgeGDE Application |
|---------|---------------------|
| **Avoid horizontal tabs** (29% don't notice) | Use vertical navigation or accordion for config sections |
| **Display "Applied Filters" overview** (28% don't) | Show active filters in PR filters, deploy filters |
| **Signpost hidden thumbnails** | Show hidden config sections with indicators |
| **Always provide 6 key order-tracking details** | Show 6 key deploy details: status, time, commit, env, logs, actions |
| **Fake "editing" flow for sensitive updates** (78% don't) | Fake "editing" flow for credit card → apply to secret rotation |
| **Show "Saved" state immediately** | Instant feedback on config save |
| **Mobile-first responsive** (67% mobile sites mediocre) | Mobile-first dashboard; touch targets ≥44px |

---

## Part 5: NN/g Psychology Articles (Key Insights)

| Article | Key Insight | EdgeGDE Application |
|---------|-------------|---------------------|
| **Design-System Maturity: 6-Dimension Framework** | Assess design system health across 6 dimensions | Use to assess EdgeGDE design system maturity |
| **5 Qualities of Site-Specific AI Chatbots** | Handoff willingness, flexibility, proactivity, emotional responsiveness, transparency | Apply to EdgeGDE AI assistant |
| **Stop Reporting UX Activity, Report Business Outcomes** | Report revenue, cost, risk, speed, retention — not activity metrics | SDLC metrics: deploy frequency, lead time, MTTR, change failure rate |
| **Your New UX Habit: Establishing Baselines for Impact** | Gather baseline metrics before starting project | Measure baseline deploy frequency, lead time, MTTR before changes |
| **The 5 Qualities of Site-Specific AI Chatbots** | Handoff willingness, flexibility, proactivity, emotional responsiveness, transparency | Apply to EdgeGDE AI assistant |
| **Design-System Maturity: 6-Dimension Framework** | Assess design system health | Use for EdgeGDE design system audit |

---

## Part 6: Implementation Priority Matrix

| Priority | Principle | Product UX Effort | SDLC Effort | ROI |
|----------|-----------|-------------------|-------------|-----|
| **P0** | Smart Defaults | Low | Low | ⭐⭐⭐⭐⭐ |
| **P0** | Never Start at Zero | Low | Low | ⭐⭐⭐⭐⭐ |
| **P0** | Value-First / Reciprocity | Medium | Low | ⭐⭐⭐⭐⭐ |
| **P1** | Smart Framing ("Continue") | Low | Low | ⭐⭐⭐⭐ |
| **P1** | Loss Aversion Framing | Medium | Medium | ⭐⭐⭐⭐ |
| **P1** | Artificial Head Start | Low | Low | ⭐⭐⭐⭐ |
| **P1** | Goal Gradient / Progress Viz | Medium | Low | ⭐⭐⭐⭐ |
| **P2** | Decision Fatigue Reduction | Medium | Low | ⭐⭐⭐ |
| **P2** | Contrast Effect / Anchoring | Medium | Low | ⭐⭐⭐ |
| **P2** | IKEA Effect / Builder Flow | High | Medium | ⭐⭐⭐ |
| **P2** | Loss Aversion / Threat Framing | Medium | Medium | ⭐⭐⭐ |
| **P3** | Visual Hierarchy System | Medium | N/A | ⭐⭐ |
| **P3** | Friction Removal | High | N/A | ⭐⭐ |
| **P3** | AI-Enhanced Workflow | High | High | ⭐⭐ |

---

## Part 7: Svelte/TypeScript/Tailwind Component Library Spec

### Core Components to Build

```typescript
// SmartDefault.svelte
interface SmartDefaultProps {
  defaults: Record<string, any>;
  children: Snippet;
}

// ProgressBar.svelte
interface ProgressBarProps {
  value: number;
  max?: number;
  steps?: number;
  initialStep?: number;
  minProgress?: number; // default 20
}

// LossFrame.svelte
interface LossFrameProps {
  itemsAtRisk: string[];
  countdown?: number;
  dismissLabel?: string;
  children: Snippet;
}

// BuilderFlow.svelte
interface BuilderFlowProps {
  steps: BuilderStep[];
  onComplete: () => void;
}

// ValueFirst.svelte
interface ValueFirstProps {
  previewData: any;
  cta: string;
  onSave: () => void;
}

// PriceAnchor.svelte
interface PriceAnchorProps {
  high: number;
  target: number;
  badge?: string;
}
```

---

## Part 8: Design Token Extensions (Tailwind Config)

```javascript
// tailwind.config.js additions
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
  }
}
```

---

## Part 9: SDLC Integration Points

| SDLC Stage | UX Principle | Implementation |
|------------|--------------|----------------|
| **Issue Creation** | Smart Defaults, Never Zero | Pre-fill title template; "Title added ✓" pre-checked |
| **PR Creation** | Smart Defaults, Smart Framing | Template with labels; "Continue review" not "Start review" |
| **Code Review** | Value-First, Loss Aversion | Show diff summary first; "This merge will lose 47% test coverage" |
| **Deployment** | Value-First, Smart Framing | Show preview diff; "Continue deployment" not "Start deploy" |
| **Config Management** | Smart Defaults, Decision Fatigue | Pre-fill common configs; limit options to 6 |
| **Onboarding** | Artificial Head Start, IKEA Effect | "README created ✓, CI configured ✓" pre-checked |
| **Incident Response** | Loss Aversion, Threat Framing | "This rollback will lose 3 days of analytics data" |
| **Config Changes** | Loss Aversion, Threat Framing | "This config change will lose audit logging" |

---

## Part 10: Next Steps

1. **Audit current EdgeGDE forms/flows** against P0 principles
2. **Create design tokens** for progress states, default states, loss-frame states
3. **Build Svelte component library** for: `SmartDefault`, `ProgressBar`, `LossFrame`, `BuilderFlow`, `ValueFirst`, `PriceAnchor`
4. **Integrate into SDLC**: PR templates, deploy confirmations, config UI, onboarding checklists
5. **Write FRS** for EdgeGDE UX Design System v2.0 incorporating all principles

---

## Appendix: Quick Reference Card

```
EDGEGDE UX PRINCIPLES QUICK REFERENCE
☐ Smart Defaults on every form field
☐ Never start at 0% — minimum 20% progress
☐ Value first, ask later (reciprocity)
☐ "Continue" not "Sign Up" (commitment framing)
☐ Show loss, not gain (loss aversion 2x)
☐ Threat framing > pitch framing (status quo bias)
☐ Anchor high, then present target (contrast effect)
☐ Let them build before asking (IKEA effect)
☐ Artificial head start (endowed progress)
☐ Goal gradient: show momentum, not distance
☐ Limit choices to 6 max (decision fatigue)
☐ Token budgets per SDLC operation
☐ Compression auto-triggers at 50%
☐ Cache identical LLM requests (300s TTL)
☐ Selective context: <2000 lines per task
```