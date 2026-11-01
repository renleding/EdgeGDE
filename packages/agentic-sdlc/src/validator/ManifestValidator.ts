import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { z } from 'zod';
import {
  PortfolioManifest,
  Project,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  ProjectHealthStatus,
  GateCheckResult,
  GovernanceGates
} from '../types';

// Node.js types
declare const process: { cwd(): string };

// Zod schemas for validation
const ProjectSchema = z.object({
  project: z.string(),
  status: z.enum(['planned', 'active', 'archived']),
  priority: z.enum(['high', 'medium', 'low']),
  docs: z.boolean(),
  app: z.boolean(),
  package: z.boolean(),
  openspec: z.boolean().optional().default(false),
  owner: z.string(),
  lifecycle: z.object({
    stage: z.enum(['idea', 'planned', 'scaffolded', 'active', 'production', 'archived'])
  }),
  health: z.object({
    docs_complete: z.boolean(),
    openspec_complete: z.boolean(),
    architecture_reviewed: z.boolean(),
    implementation_started: z.boolean(),
    ci_cd_enabled: z.boolean(),
    owner_assigned: z.boolean()
  }),
  aliases: z.array(z.string()).optional()
});

const PortfolioManifestSchema = z.object({
  version: z.union([z.string(), z.number()]).transform(v => String(v)),
  generated: z.union([z.string(), z.date()]).transform(v => v instanceof Date ? v.toISOString() : String(v)),
  portfolio: z.array(ProjectSchema),
  metadata: z.object({
    totals: z.object({
      projects: z.number(),
      docs_only: z.number(),
      app_only: z.number(),
      package_only: z.number(),
      aligned: z.number()
    }),
    lifecycle_distribution: z.record(z.number()),
    health_summary: z.record(z.number()),
    next_actions: z.array(z.union([z.string(), z.object({}).passthrough()])).transform(arr => 
      arr.map(item => typeof item === 'string' ? item : JSON.stringify(item))
    ),
    governance_gates: z.object({
      scaffolded_requires: z.record(z.boolean()),
      active_requires: z.record(z.boolean()),
      production_requires: z.record(z.boolean()),
      implementation_gate: z.object({
        worktree_required: z.boolean(),
        milestone_required: z.boolean(),
        owner_required: z.boolean(),
        architecture_review_required: z.boolean()
      }).optional()
    }).optional()
  })
});

export class ManifestValidator {
  private manifest: PortfolioManifest | null = null;
  private manifestPath: string;
  private gates: GovernanceGates | null = null;

  constructor(manifestPath?: string) {
    this.manifestPath = manifestPath || this.findManifestPath();
  }

  private findManifestPath(): string {
    const candidates = [
      '/Users/warren/hermes-master/05_DOCS/portfolio/portfolio-manifest.yaml',
      '/Users/warren/Documents/_HQ_AI/EdgeGDE/portfolio-manifest.yaml',
      process.cwd() + '/portfolio-manifest.yaml'
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    throw new Error('Portfolio manifest not found');
  }

  /**
   * Load and parse the portfolio manifest
   */
  load(): PortfolioManifest {
    const content = fs.readFileSync(this.manifestPath, 'utf-8');
    const parsed = yaml.load(content) as PortfolioManifest & { governance_gates?: GovernanceGates };
    
    // Validate with Zod
    const result = PortfolioManifestSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`Manifest validation failed: ${result.error.message}`);
    }
    
    this.manifest = result.data;
    // Governance gates are at root level, not in metadata
    this.gates = parsed.governance_gates || null;
    return this.manifest;
  }

  /**
   * Get the loaded manifest (loads if not already loaded)
   */
  getManifest(): PortfolioManifest {
    if (!this.manifest) {
      this.load();
    }
    return this.manifest!;
  }

  /**
   * Get governance gates
   */
  getGates(): GovernanceGates | null {
    if (!this.gates) {
      this.getManifest();
    }
    return this.gates;
  }

  /**
   * Validate all projects in the portfolio
   */
  validateAll(): ValidationResult[] {
    const manifest = this.getManifest();
    const results: ValidationResult[] = [];

    for (const project of manifest.portfolio) {
      results.push(this.validateProject(project));
    }

    return results;
  }

  /**
   * Validate a single project
   */
  validateProject(project: Project): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Schema validation
    const schemaResult = ProjectSchema.safeParse(project);
    if (!schemaResult.success) {
      for (const issue of schemaResult.error.issues) {
        errors.push({
          code: 'SCHEMA_VALIDATION',
          message: issue.message,
          path: issue.path.join('.'),
          severity: 'error'
        });
      }
    }

    // Business logic validations
    this.validateOwner(project, errors, warnings);
    this.validateLifecycle(project, errors, warnings);
    this.validateHealthConsistency(project, errors, warnings);
    this.validateGateRequirements(project, errors, warnings);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      project: project.project
    };
  }

  private validateOwner(project: Project, errors: ValidationError[], warnings: ValidationWarning[]): void {
    if (project.owner === 'unassigned') {
      warnings.push({
        code: 'OWNER_UNASSIGNED',
        message: `Project ${project.project} has no assigned owner`,
        path: 'owner'
      });
    }
    
    if (project.health.owner_assigned && project.owner === 'unassigned') {
      errors.push({
        code: 'OWNER_MISMATCH',
        message: 'health.owner_assigned is true but owner is unassigned',
        path: 'health.owner_assigned',
        severity: 'error'
      });
    }
  }

  private validateLifecycle(project: Project, errors: ValidationError[], warnings: ValidationWarning[]): void {
    const stage = project.lifecycle.stage;
    const status = project.status;

    // Status/stage consistency
    const stageToStatus: Record<string, string> = {
      'idea': 'planned',
      'planned': 'planned',
      'scaffolded': 'planned',
      'active': 'active',
      'production': 'active',
      'archived': 'archived'
    };

    const expectedStatus = stageToStatus[stage];
    if (expectedStatus && status !== expectedStatus) {
      warnings.push({
        code: 'STATUS_STAGE_MISMATCH',
        message: `Stage ${stage} typically maps to status ${expectedStatus}, but status is ${status}`,
        path: 'lifecycle.stage'
      });
    }
  }

  private validateHealthConsistency(project: Project, errors: ValidationError[], warnings: ValidationWarning[]): void {
    const { health } = project;

    // If docs_complete is true, docs should be true
    if (health.docs_complete && !project.docs) {
      errors.push({
        code: 'HEALTH_DOCS_MISMATCH',
        message: 'health.docs_complete is true but project.docs is false',
        path: 'health.docs_complete',
        severity: 'error'
      });
    }

    // If openspec_complete is true, openspec should be true
    if (health.openspec_complete && !project.openspec) {
      errors.push({
        code: 'HEALTH_OPENSPEC_MISMATCH',
        message: 'health.openspec_complete is true but project.openspec is false',
        path: 'health.openspec_complete',
        severity: 'error'
      });
    }

    // If implementation_started, at least app or package should be true
    if (project.health.implementation_started && !project.app && !project.package) {
      warnings.push({
        code: 'IMPLEMENTATION_NO_CODE',
        message: 'implementation_started is true but neither app nor package exists',
        path: 'health.implementation_started'
      });
    }
  }

  private validateGateRequirements(project: Project, errors: ValidationError[], warnings: ValidationWarning[]): void {
    if (!this.gates) return;

    const stage = project.lifecycle.stage;
    let requiredGates: Record<string, boolean> | null = null;

    if (stage === 'scaffolded') {
      requiredGates = this.gates.scaffolded_requires;
    } else if (stage === 'active') {
      requiredGates = this.gates.active_requires;
    } else if (stage === 'production') {
      requiredGates = this.gates.production_requires;
    }

    if (!requiredGates) return;

    for (const [gate, required] of Object.entries(requiredGates)) {
      if (!required) continue;

      let checkResult: boolean;
      let details: string;

      switch (gate) {
        case 'owner_assigned':
          checkResult = project.owner !== 'unassigned';
          details = checkResult ? `Owner: ${project.owner}` : 'Owner is unassigned';
          break;
        case 'architecture_review':
          checkResult = project.health.architecture_reviewed;
          details = checkResult ? 'Architecture review completed' : 'Architecture review not completed';
          break;
        case 'openspec_link':
          checkResult = project.openspec;
          details = checkResult ? 'OpenSpec linked' : 'No OpenSpec linkage';
          break;
        case 'scaffold':
          checkResult = project.app || project.package;
          details = checkResult ? 'Scaffold exists (app/package)' : 'No scaffold (app/package)';
          break;
        case 'ci_cd_enabled':
          checkResult = project.health.ci_cd_enabled;
          details = checkResult ? 'CI/CD enabled' : 'CI/CD not enabled';
          break;
        case 'docs_complete':
          checkResult = project.health.docs_complete;
          details = checkResult ? 'Docs complete' : 'Docs incomplete';
          break;
        default:
          checkResult = false;
          details = `Unknown gate: ${gate}`;
      }

      if (!checkResult) {
        errors.push({
          code: `GATE_${gate.toUpperCase()}_FAILED`,
          message: `Gate "${gate}" failed: ${details}`,
          path: `health.${gate}`,
          severity: 'error'
        });
      }
    }
  }

  /**
   * Get project health status with gate check results
   */
  getProjectHealth(projectName: string): ProjectHealthStatus | null {
    const manifest = this.getManifest();
    const project = manifest.portfolio.find(p => p.project === projectName);
    if (!project) return null;

    const checks: GateCheckResult[] = [];
    const gates = this.getGates();

    if (gates) {
      const stage = project.lifecycle.stage;
      let requiredGates: Record<string, boolean> | null = null;

      if (stage === 'scaffolded') requiredGates = gates.scaffolded_requires;
      else if (stage === 'active') requiredGates = gates.active_requires;
      else if (stage === 'production') requiredGates = gates.production_requires;

      if (requiredGates) {
        for (const [gate, required] of Object.entries(requiredGates)) {
          if (!required) continue;

          let passed = false;
          let details = '';

          switch (gate) {
            case 'owner_assigned':
              passed = project.owner !== 'unassigned';
              details = passed ? `Owner: ${project.owner}` : 'Owner is unassigned';
              break;
            case 'architecture_review':
              passed = project.health.architecture_reviewed;
              details = passed ? 'Architecture review completed' : 'Architecture review not completed';
              break;
            case 'openspec_link':
              passed = project.openspec;
              details = passed ? 'OpenSpec linked' : 'No OpenSpec linkage';
              break;
            case 'scaffold':
              passed = project.app || project.package;
              details = passed ? 'Scaffold exists (app/package)' : 'No scaffold (app/package)';
              break;
            case 'ci_cd_enabled':
              passed = project.health.ci_cd_enabled;
              details = passed ? 'CI/CD enabled' : 'CI/CD not enabled';
              break;
            case 'docs_complete':
              passed = project.health.docs_complete;
              details = passed ? 'Docs complete' : 'Docs incomplete';
              break;
          }

          checks.push({ gate, passed, details, required });
        }
      }
    }

    const failedRequired = checks.filter(c => c.required && !c.passed).length;
    let overall: 'pass' | 'fail' | 'warning' = 'pass';
    if (failedRequired > 0) overall = 'fail';
    else if (checks.some(c => c.required && c.passed === false)) overall = 'warning';

    return {
      project: projectName,
      stage: project.lifecycle.stage,
      owner: project.owner,
      checks,
      overall
    };
  }

  /**
   * Get all projects that can transition to next stage
   */
  getTransitionCandidates(): { project: string; from: string; to: string; ready: boolean }[] {
    const manifest = this.getManifest();
    const candidates: { project: string; from: string; to: string; ready: boolean }[] = [];

    const stageOrder = ['idea', 'planned', 'scaffolded', 'active', 'production', 'archived'];

    for (const project of manifest.portfolio) {
      const currentIndex = stageOrder.indexOf(project.lifecycle.stage);
      if (currentIndex === -1 || currentIndex === stageOrder.length - 1) continue;

      const nextStage = stageOrder[currentIndex + 1];
      const health = this.getProjectHealth(project.project);
      const ready = health?.overall === 'pass';

      candidates.push({
        project: project.project,
        from: project.lifecycle.stage,
        to: nextStage,
        ready
      });
    }

    return candidates;
  }

  /**
   * Export manifest as JSON (for programmatic use)
   */
  toJSON(): string {
    return JSON.stringify(this.getManifest(), null, 2);
  }
}

// Export singleton instance
export const manifestValidator = new ManifestValidator();