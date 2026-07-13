/**
 * SDLC UI Design Tokens
 * Phase 1: Foundation tokens for SDLC UI improvements
 * Based on UX Principles Report v2
 */

// ════════════════════════════════════════════════════════════════════════════
// Progress Tokens
// ════════════════════════════════════════════════════════════════════════════

export const progressTokens = {
  // Minimum progress value (never start at 0%)
  minProgress: 20,
  
  // Progress ring colors
  ring: {
    background: 'var(--progress-ring-bg, #1c212e)',
    foreground: 'var(--progress-ring-fg, #3fb950)',
    track: 'var(--progress-track-bg, #2d3140)',
    complete: 'var(--progress-complete-fg, #2ea043)',
    warning: 'var(--progress-warning-fg, #d29922)',
    danger: 'var(--progress-danger-fg, #f85149)',
  },
  
  // Progress bar sizes
  size: {
    sm: '2px',
    md: '4px',
    lg: '8px',
    ring: '32px',
  },
  
  // Progress states
  state: {
    pending: 'pending',
    active: 'active',
    complete: 'complete',
    warning: 'warning',
    error: 'error',
  },
} as const;

// ════════════════════════════════════════════════════════════════════════════
// Loss Frame / Threat Frame Tokens
// ════════════════════════════════════════════════════════════════════════════

export const lossFrameTokens = {
  // Background and border
  bg: 'var(--loss-frame-bg, #2d1b1b)',
  border: 'var(--loss-frame-border, #f85149)',
  borderWidth: '2px',
  
  // Countdown/timer
  countdown: {
    bg: 'var(--countdown-bg, #3d1d1d)',
    text: 'var(--countdown-text, #ff7b72)',
    critical: 'var(--countdown-critical, #f85149)',
  },
  
  // Dismiss button
  dismiss: {
    bg: 'var(--dismiss-bg, #1c212e)',
    text: 'var(--dismiss-text, #8b949e)',
    hoverBg: 'var(--dismiss-hover-bg, #2d3140)',
    hoverText: 'var(--dismiss-hover-text, #e1e4e8)',
    border: 'var(--dismiss-border, #2d3140)',
  },
  
  // Items at risk
  itemsAtRisk: {
    bg: 'var(--items-risk-bg, #2d1b1b)',
    text: 'var(--items-risk-text, #ff7b72)',
    border: 'var(--items-risk-border, #f85149)',
  },
  
  // Dismiss label
  dismissLabel: 'I\'ll risk it',
} as const;

// ════════════════════════════════════════════════════════════════════════════
// Smart Defaults Tokens
// ════════════════════════════════════════════════════════════════════════════

export const smartDefaultsTokens = {
  // Default field backgrounds
  field: {
    bg: 'var(--default-field-bg, #161b22)',
    text: 'var(--default-text, #e1e4e8)',
    placeholder: 'var(--default-placeholder, #6e7681)',
    border: 'var(--default-border, #2d3140)',
    borderFocus: 'var(--default-focus-border, #3fb950)',
    borderError: 'var(--default-error-border, #f85149)',
    label: 'var(--default-label, #8b949e)',
  },
  
  // Default button
  button: {
    primary: {
      bg: 'var(--btn-primary-bg, #238636)',
      hoverBg: 'var(--btn-primary-hover-bg, #2ea043)',
      text: 'var(--btn-primary-text, #ffffff)',
      border: 'var(--btn-primary-border, transparent)',
    },
    secondary: {
      bg: 'var(--btn-secondary-bg, #1c2128)',
      hoverBg: 'var(--btn-secondary-hover-bg, #2d3140)',
      text: 'var(--btn-secondary-text, #e1e4e8)',
      border: 'var(--btn-secondary-border, #2d3140)',
    },
    danger: {
      bg: 'var(--btn-danger-bg, #da3633)',
      hoverBg: 'var(--btn-danger-hover-bg, #f85149)',
      text: 'var(--btn-danger-text, #ffffff)',
      border: 'var(--btn-danger-border, transparent)',
    },
  },
  
  // CTA "Continue" framing
  cta: {
    continueText: 'Continue',
    continueAriaLabel: 'Continue to next step',
  },
} as const;

// ════════════════════════════════════════════════════════════════════════════
// Decision Fatigue Tokens
// ════════════════════════════════════════════════════════════════════════════

export const decisionFatigueTokens = {
  maxVisibleOptions: 6,
  showMoreLabel: 'Show more',
  showLessLabel: 'Show less',
  progressiveDisclosure: {
    collapsed: 'collapsed',
    expanded: 'expanded',
  },
} as const;

// ════════════════════════════════════════════════════════════════════════════
// Artificial Head Start / Endowed Progress Tokens
// ════════════════════════════════════════════════════════════════════════════

export const headStartTokens = {
  // Pre-checked steps for common flows
  precheckedSteps: {
    issueCreation: ['title'],
    prCreation: ['branchCreated', 'ciQueued'],
    repoCreation: ['repoCloned', 'depsInstalled', 'testsPassing'],
    onboarding: ['accountCreated', 'firstLogin'],
    configManagement: ['configLoaded'],
  },
  
  // Base progress values
  baseProgress: {
    onboarding: 20,      // Account created + first login
    repoCreation: 30,    // Cloned + deps installed + tests passing
    prCreation: 30,      // Branch + CI queued
    issueCreation: 20,   // Title focused
    configManagement: 25, // Config loaded
  },
  
  // Step labels
  stepLabels: {
    issueCreation: ['Title', 'Description', 'Labels', 'Submit'],
    prCreation: ['Branch', 'CI', 'Description', 'Reviewers', 'Create'],
    repoCreation: ['Clone', 'Install', 'Test', 'Configure', 'Deploy'],
    onboarding: ['Account', 'API Key', 'Dashboard'],
    configManagement: ['Load', 'Edit', 'Validate', 'Save'],
  },
} as const;

// ════════════════════════════════════════════════════════════════════════════
// IKEA Effect / Builder Flow Tokens
// ════════════════════════════════════════════════════════════════════════════

export const builderTokens = {
  stepActive: 'var(--builder-step-active, #3fb950)',
  stepCompleted: 'var(--builder-step-completed, #2ea043)',
  stepPending: 'var(--builder-step-pending, #2d3140)',
  stepConnector: 'var(--builder-step-connector, #2d3140)',
  
  preview: {
    bg: 'var(--builder-preview-bg, #0d1117)',
    border: 'var(--builder-preview-border, #2d3140)',
  },
  
  continueButton: {
    text: 'Continue',
    variant: 'primary',
  },
  
  authGateLabel: 'Continue to save your configuration',
} as const;

// ════════════════════════════════════════════════════════════════════════════
// Visual Hierarchy Tokens
// ════════════════════════════════════════════════════════════════════════════

export const hierarchyTokens = {
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '24px',
    xxl: '32px',
    xxxl: '48px',
    xxxxl: '64px',
  },
  
  typography: {
    heading: {
      h1: { size: '28px', weight: 700, lineHeight: 1.2, tracking: '-0.02em' },
      h2: { size: '22px', weight: 600, lineHeight: 1.3, tracking: '-0.01em' },
      h3: { size: '18px', weight: 600, lineHeight: 1.4, tracking: '0' },
      h4: { size: '16px', weight: 600, lineHeight: 1.4, tracking: '0' },
    },
    body: {
      lg: { size: '16px', weight: 400, lineHeight: 1.6 },
      md: { size: '14px', weight: 400, lineHeight: 1.5 },
      sm: { size: '12px', weight: 400, lineHeight: 1.5 },
      xs: { size: '11px', weight: 400, lineHeight: 1.5 },
    },
    code: {
      sm: { size: '12px', family: 'ui-monospace, SFMono-Regular, monospace' },
      md: { size: '13px', family: 'ui-monospace, SFMono-Regular, monospace' },
    },
  },
  
  contrast: {
    min: 4.5,  // WCAG AA
    enhanced: 7, // WCAG AAA
  },
  
  focus: {
    ringWidth: '2px',
    ringColor: 'var(--focus-ring-color, #3fb950)',
    ringOffset: '2px',
  },
} as const;

// ════════════════════════════════════════════════════════════════════════════
// Error Prevention Tokens
// ════════════════════════════════════════════════════════════════════════════

export const errorPreventionTokens = {
  inline: {
    errorBg: 'var(--inline-error-bg, #2d1b1b)',
    errorBorder: 'var(--inline-error-border, #f85149)',
    errorText: 'var(--inline-error-text, #ff7b72)',
    warningBg: 'var(--inline-warning-bg, #2d2a1b)',
    warningBorder: 'var(--inline-warning-border, #d29922)',
    warningText: 'var(--inline-warning-text, #d29922)',
    successBg: 'var(--inline-success-bg, #162a16)',
    successBorder: 'var(--inline-success-border, #3fb950)',
    successText: 'var(--inline-success-text, #56d364)',
  },
  
  confirmation: {
    destructive: {
      bg: 'var(--confirm-destructive-bg, #2d1b1b)',
      border: 'var(--confirm-destructive-border, #f85149)',
      text: 'var(--confirm-destructive-text, #ff7b72)',
      confirmBtn: 'var(--confirm-destructive-btn, #da3633)',
      cancelBtn: 'var(--confirm-cancel-btn, #1c2128)',
    },
    neutral: {
      bg: 'var(--confirm-neutral-bg, #161b22)',
      border: 'var(--confirm-neutral-border, #2d3140)',
      text: 'var(--confirm-neutral-text, #e1e4e8)',
      confirmBtn: 'var(--confirm-neutral-btn, #238636)',
      cancelBtn: 'var(--confirm-cancel-btn, #1c2128)',
    },
  },
  
  validation: {
    inlineDelay: 300,  // ms debounce
    onBlur: true,
    onSubmit: true,
  },
} as const;

// ════════════════════════════════════════════════════════════════════════════
// Smart Framing Tokens
// ════════════════════════════════════════════════════════════════════════════

export const framingTokens = {
  // Primary action verbs
  cta: {
    continue: 'Continue',
    continueReview: 'Continue review',
    continueDeploy: 'Continue deployment',
    continueSetup: 'Continue setup',
    continueConfig: 'Continue configuration',
    saveAndContinue: 'Save and continue',
    // Never use: "Start", "Sign up", "Sign in", "Begin", "Get started"
  },
  
  // Loss framing for critical actions
  lossFrame: {
    deploy: 'This deploy will lose: {items}',
    configChange: 'This change will lose: {items}',
    dataDelete: 'You will lose: {items}',
    featureDisable: 'Disabling will lose: {items}',
  },
  
  // Value-first framing
  valueFirst: {
    preview: 'See your {value} before you commit',
    results: 'Your {metric} improved by {delta}%',
    benefit: 'Get {benefit} by completing this step',
  },
} as const;

// ════════════════════════════════════════════════════════════════════════════
// Contrast Effect / Price Anchoring Tokens
// ════════════════════════════════════════════════════════════════════════════

export const contrastTokens = {
  priceAnchor: {
    high: 'var(--anchor-high, $1,900)',
    target: 'var(--anchor-target, $50)',
    badge: 'var(--anchor-badge, Just 2.6%)',
  },
  
  planAnchor: {
    enterprise: 'Enterprise — $500/mo',
    team: 'Team — $50/mo',
    individual: 'Individual — $15/mo',
  },
  
  effortAnchor: {
    fullRebuild: '45 min',
    incrementalBuild: '2 min',
    manualConfig: '30 min',
    autoConfig: '30 sec',
  },
} as const;

// ════════════════════════════════════════════════════════════════════════════
// IKEA Effect / Endowment Effect Tokens
// ════════════════════════════════════════════════════════════════════════════

export const ownershipTokens = {
  builderFlow: {
    steps: ['Pick stack', 'Configure CI', 'Preview deploy', 'Then authenticate'],
    progressSteps: ['Stack ✓', 'CI ✓', 'Preview ✓', 'Auth'],
    preAuthSteps: 3,
  },
  
  endowment: {
    progressGiven: '20%',
    message: 'You\'ve already completed the first step',
  },
  
  ownershipLanguage: {
    yourConfig: 'Your configuration',
    yourProject: 'Your project',
    yourDeploy: 'Your deployment',
    yourConfigFile: 'Your config file',
  },
} as const;

// ════════════════════════════════════════════════════════════════════════════
// Never Start at Zero / Goal Gradient Tokens
// ════════════════════════════════════════════════════════════════════════════

export const zeroProgressTokens = {
  minimumProgress: 20,
  progressLabels: {
    zero: 'Standing still',
    twenty: 'Momentum building',
    fifty: 'Halfway there',
    eighty: 'Almost there',
    hundred: 'Complete',
  },
  
  progressRing: {
    minValue: 20,
    maxValue: 100,
    strokeWidth: 4,
    size: 48,
  },
  
  checkmark: {
    completed: '✓',
    pending: '○',
    current: '◉',
  },
} as const;

// ════════════════════════════════════════════════════════════════════════════
// Token Registry Export
// ════════════════════════════════════════════════════════════════════════════

export const sdlcTokens = {
  progress: progressTokens,
  lossFrame: lossFrameTokens,
  smartDefaults: smartDefaultsTokens,
  decisionFatigue: decisionFatigueTokens,
  headStart: headStartTokens,
  builder: builderTokens,
  hierarchy: hierarchyTokens,
  errorPrevention: errorPreventionTokens,
  framing: framingTokens,
  contrast: contrastTokens,
  ownership: ownershipTokens,
  zeroProgress: zeroProgressTokens,
} as const;

// Type helpers
export type ProgressTokens = typeof progressTokens;
export type LossFrameTokens = typeof lossFrameTokens;
export type SmartDefaultsTokens = typeof smartDefaultsTokens;
export type DecisionFatigueTokens = typeof decisionFatigueTokens;
export type HeadStartTokens = typeof headStartTokens;
export type BuilderTokens = typeof builderTokens;
export type HierarchyTokens = typeof hierarchyTokens;
export type ErrorPreventionTokens = typeof errorPreventionTokens;
export type FramingTokens = typeof framingTokens;
export type ContrastTokens = typeof contrastTokens;
export type OwnershipTokens = typeof ownershipTokens;
export type ZeroProgressTokens = typeof zeroProgressTokens;
export type SdlcTokens = typeof sdlcTokens;