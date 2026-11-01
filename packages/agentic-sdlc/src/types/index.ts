// Core types for agentic-sdlc
// Shared across validator, gate, runner, openspec, ci

export interface PortfolioManifest {
  version: string;
  generated: string;
  portfolio: Project[];
  metadata: PortfolioMetadata;
}

export interface Project {
  project: string;
  status: 'planned' | 'active' | 'archived';
  priority: 'high' | 'medium' | 'low';
  docs: boolean;
  app: boolean;
  package: boolean;
  openspec: boolean;
  owner: string;
  lifecycle: {
    stage: 'idea' | 'planned' | 'scaffolded' | 'active' | 'production' | 'archived';
  };
  health: {
    docs_complete: boolean;
    openspec_complete: boolean;
    architecture_reviewed: boolean;
    implementation_started: boolean;
    ci_cd_enabled: boolean;
    owner_assigned: boolean;
  };
  aliases?: string[];
}

export interface PortfolioMetadata {
  totals: {
    projects: number;
    docs_only: number;
    app_only: number;
    package_only: number;
    aligned: number;
  };
  lifecycle_distribution: Record<string, number>;
  health_summary: Record<string, number>;
  next_actions: string[];
  governance_gates?: GovernanceGates;
}

export interface GovernanceGates {
  scaffolded_requires: Record<string, boolean>;
  active_requires: Record<string, boolean>;
  production_requires: Record<string, boolean>;
  implementation_gate?: ImplementationGate;
}

export interface ImplementationGate {
  worktree_required: boolean;
  milestone_required: boolean;
  owner_required: boolean;
  architecture_review_required: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  project?: string;
}

export interface ValidationError {
  code: string;
  message: string;
  path: string;
  severity: 'error' | 'warning';
}

export interface ValidationWarning {
  code: string;
  message: string;
  path: string;
}

export interface GateCheckResult {
  gate: string;
  passed: boolean;
  details: string;
  required: boolean;
}

export interface ProjectHealthStatus {
  project: string;
  stage: string;
  owner: string;
  checks: GateCheckResult[];
  overall: 'pass' | 'fail' | 'warning';
}

export interface CI_CD_Config {
  project: string;
  stages: CI_Stage[];
  branch_protection: BranchProtection;
}

export interface CI_Stage {
  name: string;
  commands: string[];
  dependencies: string[];
  required: boolean;
}

export interface BranchProtection {
  main: string[];
  work_branches: string[];
}

export interface WorktreeAllocation {
  agent: string;
  project: string;
  branch: string;
  start_week: number;
  end_week: number;
}

// Verification types
export interface VerificationCriteria {
  type: 'test_command' | 'script' | 'http_check' | 'state_check';
  command?: string;
  script?: string;
  endpoint?: string;
  path?: string;
  expected: unknown;
  timeout?: number;
}

export interface VerificationResult {
  passed: boolean;
  evidence: unknown;
  diff?: unknown;
  duration_ms: number;
}