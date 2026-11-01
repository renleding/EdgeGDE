import {
  Project,
  ProjectHealthStatus,
  GateCheckResult,
  GovernanceGates,
  ImplementationGate
} from '../types';
import { manifestValidator } from '../validator/ManifestValidator';

export interface GateEvaluationResult {
  project: string;
  stage: string;
  targetStage: string;
  passed: boolean;
  checks: GateCheckResult[];
  blockers: string[];
  warnings: string[];
}

export interface GateEngineConfig {
  strictMode: boolean;
  allowWarnings: boolean;
}

export class GateEngine {
  private config: GateEngineConfig;

  constructor(config: Partial<GateEngineConfig> = {}) {
    this.config = {
      strictMode: config.strictMode ?? true,
      allowWarnings: config.allowWarnings ?? false
    };
  }

  /**
   * Evaluate if a project can transition to a target stage
   */
  evaluateTransition(projectName: string, targetStage: string): GateEvaluationResult {
    const health = manifestValidator.getProjectHealth(projectName);
    if (!health) {
      return {
        project: projectName,
        stage: 'unknown',
        targetStage,
        passed: false,
        checks: [],
        blockers: [`Project ${projectName} not found in manifest`],
        warnings: []
      };
    }

    const gates = manifestValidator.getGates();
    if (!gates) {
      return {
        project: projectName,
        stage: health.stage,
        targetStage,
        passed: false,
        checks: [],
        blockers: ['No governance gates configured'],
        warnings: []
      };
    }

    // Determine required gates for target stage
    let requiredGates: Record<string, boolean> | null = null;
    if (targetStage === 'scaffolded') requiredGates = gates.scaffolded_requires;
    else if (targetStage === 'active') requiredGates = gates.active_requires;
    else if (targetStage === 'production') requiredGates = gates.production_requires;
    else if (targetStage === 'archived') requiredGates = {}; // No gates for archived

    if (!requiredGates) {
      return {
        project: projectName,
        stage: health.stage,
        targetStage,
        passed: false,
        checks: [],
        blockers: [`Unknown target stage: ${targetStage}`],
        warnings: []
      };
    }

    const checks: GateCheckResult[] = [];
    const blockers: string[] = [];
    const warnings: string[] = [];

    for (const [gate, required] of Object.entries(requiredGates)) {
      if (!required) continue;

      const check = health.checks.find(c => c.gate === gate);
      if (check) {
        checks.push(check);
        if (!check.passed) {
          if (this.config.strictMode) {
            blockers.push(`Gate "${gate}" failed: ${check.details}`);
          } else {
            warnings.push(`Gate "${gate}" failed: ${check.details}`);
          }
        }
      } else {
        // Gate not evaluated yet - check directly
        const project = manifestValidator.getManifest().portfolio.find(p => p.project === projectName);
        if (project) {
          const result = this.evaluateGate(project, gate);
          checks.push({ gate, passed: result.passed, details: result.details, required: true });
          if (!result.passed) {
            if (this.config.strictMode) {
              blockers.push(`Gate "${gate}" failed: ${result.details}`);
            } else {
              warnings.push(`Gate "${gate}" failed: ${result.details}`);
            }
          }
        }
      }
    }

    // Check implementation gate if configured
    if (gates.implementation_gate) {
      const implGate = gates.implementation_gate;
      const implChecks = this.evaluateImplementationGate(health, implGate);
      for (const ic of implChecks) {
        checks.push(ic);
        if (!ic.passed && this.config.strictMode) {
          blockers.push(`Implementation gate "${ic.gate}" failed: ${ic.details}`);
        } else if (!ic.passed) {
          warnings.push(`Implementation gate "${ic.gate}" failed: ${ic.details}`);
        }
      }
    }

    const passed = blockers.length === 0;

    return {
      project: projectName,
      stage: health.stage,
      targetStage,
      passed,
      checks,
      blockers,
      warnings
    };
  }

  /**
   * Evaluate a single gate for a project
   */
  private evaluateGate(project: Project, gate: string): { passed: boolean; details: string } {
    switch (gate) {
      case 'owner_assigned':
        return {
          passed: project.owner !== 'unassigned',
          details: project.owner !== 'unassigned' ? `Owner: ${project.owner}` : 'Owner is unassigned'
        };
      case 'architecture_review':
        return {
          passed: project.health.architecture_reviewed,
          details: project.health.architecture_reviewed ? 'Architecture review completed' : 'Architecture review not completed'
        };
      case 'openspec_link':
        return {
          passed: project.openspec,
          details: project.openspec ? 'OpenSpec linked' : 'No OpenSpec linkage'
        };
      case 'scaffold':
        return {
          passed: project.app || project.package,
          details: (project.app || project.package) ? 'Scaffold exists (app/package)' : 'No scaffold (app/package)'
        };
      case 'ci_cd_enabled':
        return {
          passed: project.health.ci_cd_enabled,
          details: project.health.ci_cd_enabled ? 'CI/CD enabled' : 'CI/CD not enabled'
        };
      case 'docs_complete':
        return {
          passed: project.health.docs_complete,
          details: project.health.docs_complete ? 'Docs complete' : 'Docs incomplete'
        };
      default:
        return { passed: false, details: `Unknown gate: ${gate}` };
    }
  }

  /**
   * Evaluate implementation gate requirements
   */
  private evaluateImplementationGate(health: ProjectHealthStatus, gate: ImplementationGate): GateCheckResult[] {
    const checks: GateCheckResult[] = [];

    // Note: These would require additional data sources (worktree status, milestone tracking)
    // For now, we document the requirements

    if (gate.worktree_required) {
      checks.push({
        gate: 'worktree_allocated',
        passed: false, // Would check worktree allocation
        details: 'Worktree allocation required for Active transition',
        required: true
      });
    }

    if (gate.milestone_required) {
      checks.push({
        gate: 'milestone_defined',
        passed: false, // Would check milestone definition
        details: 'Milestone definition required for Active transition',
        required: true
      });
    }

    if (gate.owner_required) {
      checks.push({
        gate: 'owner_confirmed',
        passed: health.owner !== 'unassigned',
        details: health.owner !== 'unassigned' ? `Owner: ${health.owner}` : 'Owner must be confirmed',
        required: true
      });
    }

    if (gate.architecture_review_required) {
      checks.push({
        gate: 'architecture_review_signed',
        passed: health.checks.some(c => c.gate === 'architecture_review' && c.passed),
        details: 'Architecture review must be signed off',
        required: true
      });
    }

    return checks;
  }

  /**
   * Get all projects that are ready for stage transition
   */
  getReadyForTransition(): GateEvaluationResult[] {
    const manifest = manifestValidator.getManifest();
    const results: GateEvaluationResult[] = [];

    const stageOrder = ['idea', 'planned', 'scaffolded', 'active', 'production', 'archived'];

    for (const project of manifest.portfolio) {
      const currentIndex = stageOrder.indexOf(project.lifecycle.stage);
      if (currentIndex === -1 || currentIndex === stageOrder.length - 1) continue;

      const nextStage = stageOrder[currentIndex + 1];
      const evaluation = this.evaluateTransition(project.project, nextStage);
      
      if (evaluation.passed) {
        results.push(evaluation);
      }
    }

    return results;
  }
}

export const gateEngine = new GateEngine();