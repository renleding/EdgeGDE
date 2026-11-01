// Mission Translator - Orca TaskPayload → Hermes MissionManifest

import { 
  OrcaTaskPayload, 
  WorktreeContext,
  TaskScope,
  SessionId,
} from '../acp/types';
import { 
  Task, 
  TaskStatus, 
  PluginResult, 
  ExecutionContext,
  RunnerConfig,
} from '@edgegde/agent-runtime';

export interface HermesMissionManifest {
  missionId: string;
  objective: string;
  tasks: HermesTask[];
  constraints: MissionConstraints;
  saga: SagaConfig;
}

export interface HermesTask {
  id: string;
  type: string;
  payload: unknown;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: unknown;
  error?: string;
  retries: number;
  maxRetries: number;
  plugin?: string;
  dependsOn: string[];
}

export interface MissionConstraints {
  allowedPaths: string[];
  forbiddenPaths: string[];
  allowNetwork: boolean;
  allowShell: boolean;
  maxConcurrency: number;
  defaultTimeout: number;
  retryDelay: number;
}

export interface SagaConfig {
  compensationStrategy: 'reverse_order' | 'parallel' | 'manual';
  partialFailurePolicy: 'compensate_all' | 'stop' | 'continue';
}

export class MissionTranslator {
  
  constructor() {
    // No external dependencies needed for basic translation
  }

  translate(orcaPayload: OrcaTaskPayload): HermesMissionManifest {
    const { taskId, task, context } = orcaPayload;
    
    // Build tasks from requirements
    const tasks = this.buildTasks(task.requirements, task.type, task.scope);
    
    // Build constraints from scope
    const constraints = this.buildConstraints(task.scope, context);
    
    // Map model to plugin
    const defaultPlugin = this.mapModel(task.model);
    
    // Apply default plugin to all tasks
    tasks.forEach(t => {
      if (!t.plugin) t.plugin = defaultPlugin;
    });
    
    return {
      missionId: `hermes-${taskId}`,
      objective: task.description,
      tasks,
      constraints,
      saga: {
        compensationStrategy: 'reverse_order',
        partialFailurePolicy: 'compensate_all',
      },
    };
  }

  private buildTasks(requirements: string[], defaultType: string, scope: TaskScope): HermesTask[] {
    const tasks: HermesTask[] = [];
    
    requirements.forEach((req, index) => {
      const taskId = `task-${index + 1}`;
      const taskType = this.inferTaskType(req, defaultType);
      
      tasks.push({
        id: taskId,
        type: taskType,
        payload: { requirement: req },
        status: 'pending',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        retries: 0,
        maxRetries: 3,
        dependsOn: index > 0 ? [`task-${index}`] : [], // Sequential by default
        plugin: undefined, // Will be set after translation
      });
    });
    
    return tasks;
  }

  private inferTaskType(requirement: string, defaultType: string): string {
    const req = requirement.toLowerCase();
    
    if (req.includes('test') || req.includes('spec')) return 'testing';
    if (req.includes('refactor')) return 'refactoring';
    if (req.includes('review') || req.includes('audit')) return 'review';
    if (req.includes('deploy') || req.includes('release') || req.includes('ci')) return 'deployment';
    if (req.includes('analyz') || req.includes('research') || req.includes('investigat')) return 'analysis';
    if (req.includes('document') || req.includes('readme') || req.includes('doc')) return 'documentation';
    
    return defaultType || 'coding';
  }

  private buildConstraints(scope: TaskScope, context: WorktreeContext): MissionConstraints {
    return {
      allowedPaths: scope.allowedPaths.length > 0 ? scope.allowedPaths : [context.workingDir],
      forbiddenPaths: [...scope.forbiddenPaths, '.git/**', '**/node_modules/**', '**/dist/**', '**/build/**'],
      allowNetwork: scope.allowNetwork,
      allowShell: scope.allowShell,
      maxConcurrency: 3,
      defaultTimeout: 300000, // 5 minutes
      retryDelay: 5000,
    };
  }

  private mapModel(model?: string): string {
    // Map Orca model to Hermes plugin
    if (!model || model === 't2-orchestrator') return 'coding';
    if (model.includes('claude')) return 'coding';
    if (model.includes('gpt')) return 'coding';
    if (model.includes('gemini')) return 'coding';
    return 'coding';
  }

  // Create execution context for agent-runtime
  createExecutionContext(
    worktreeContext: WorktreeContext,
    missionId: string
  ): ExecutionContext {
    return {
      taskId: missionId,
      workingDir: worktreeContext.workingDir,
      env: {
        ...process.env,
        ORCA_WORKTREE: worktreeContext.worktreeId,
        ORCA_BRANCH: worktreeContext.branch,
        ORCA_BASE_BRANCH: worktreeContext.baseBranch,
        ORCA_REPO_URL: worktreeContext.repoUrl,
      },
      state: null!, // Will be injected by caller
      logger: {
        info: (msg: string, meta?: Record<string, unknown>) => console.log(`[INFO] ${msg}`, meta ?? ''),
        warn: (msg: string, meta?: Record<string, unknown>) => console.warn(`[WARN] ${msg}`, meta ?? ''),
        error: (msg: string, meta?: Record<string, unknown>) => console.error(`[ERROR] ${msg}`, meta ?? ''),
        debug: (msg: string, meta?: Record<string, unknown>) => console.debug(`[DEBUG] ${msg}`, meta ?? ''),
      },
    };
  }
}