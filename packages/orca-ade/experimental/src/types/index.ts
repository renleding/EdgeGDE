// Core types for orca-ade

export interface WorktreeConfig {
  basePath: string;
  maxWorktrees: number;
  agentPrefix: string;
}

export interface Worktree {
  id: string;
  agentId: string;
  path: string;
  branch: string;
  status: WorktreeStatus;
  createdAt: number;
  lastUsedAt: number;
  currentMission?: string;
}

export type WorktreeStatus = 'free' | 'allocated' | 'busy' | 'error';

export interface Mission {
  id: string;
  name: string;
  description: string;
  tasks: MissionTask[];
  scope: MissionScope;
  strategy: FanoutStrategy;
  createdAt: number;
  status: MissionStatus;
}

export type MissionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'partial';

export interface MissionTask {
  id: string;
  name: string;
  type: string;
  payload: unknown;
  dependsOn: string[];
  scope: TaskScope;
  verification?: VerificationCriteria;
}

export interface MissionScope {
  allowedPaths: string[];
  forbiddenPaths: string[];
  allowNetwork: boolean;
  allowShell: boolean;
}

export interface TaskScope {
  paths: string[];
  allowNetwork: boolean;
  allowShell: boolean;
}

export interface VerificationCriteria {
  type: 'test_command' | 'script' | 'http_check' | 'state_check';
  command?: string;
  script?: string;
  endpoint?: string;
  path?: string;
  expected: unknown;
  timeout?: number;
}

export type FanoutStrategy = 'parallel' | 'complementary';

export interface FanoutMission {
  parentMissionId: string;
  childMissions: Mission[];
  scopeManifests: ScopeManifest[];
  zeroOverlapValidated: boolean;
}

export interface ScopeManifest {
  missionId: string;
  paths: string[];
  exclusive: boolean;
}

export interface AgentAssignment {
  worktreeId: string;
  agentId: string;
  missionId: string;
  taskIds: string[];
  assignedAt: number;
}

export interface ExecutionResult {
  missionId: string;
  status: MissionStatus;
  taskResults: TaskResult[];
  mergedChanges: MergedChange[];
  duration: number;
  completedAt: number;
}

export interface TaskResult {
  taskId: string;
  status: 'completed' | 'failed' | 'skipped';
  output?: unknown;
  error?: string;
  duration: number;
  worktreeId: string;
}

export interface MergedChange {
  path: string;
  sourceWorktree: string;
  operation: 'create' | 'update' | 'delete';
  content?: string;
  conflicts?: MergeConflict[];
}

export interface MergeConflict {
  path: string;
  baseContent: string;
  incomingContent: string;
  currentContent: string;
}

export interface WorktreeManagerConfig {
  basePath: string;
  maxWorktrees: number;
  agentPrefix: string;
  gitRemote: string;
}

export interface WorktreeManager {
  createWorktree(agentId: string): Promise<Worktree>;
  getOrCreateWorktree(agentId: string): Promise<Worktree>;
  allocateWorktree(agentId: string, missionId: string): Promise<Worktree>;
  releaseWorktree(worktreeId: string): Promise<void>;
  deleteWorktree(worktreeId: string): Promise<void>;
  findByAgent(agentId: string): Worktree | undefined;
  getWorktree(id: string): Worktree | undefined;
  getAllWorktrees(): Worktree[];
  getFreeWorktrees(): Worktree[];
  getAllocatedWorktrees(): Worktree[];
  getStats(): {
    total: number;
    free: number;
    allocated: number;
    busy: number;
    error: number;
  };
}

export interface FanoutConfig {
  strategy: FanoutStrategy;
  validateZeroOverlap: boolean;
  maxParallel: number;
}

export interface MissionCompilerConfig {
  designGraph: DesignGraph;
  scopeRules: ScopeRule[];
}

export interface DesignGraph {
  nodes: DesignNode[];
  edges: DesignEdge[];
}

export interface DesignNode {
  id: string;
  type: string;
  config: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface DesignEdge {
  from: string;
  to: string;
  type: string;
}

export interface ScopeRule {
  pattern: string;
  exclusive: boolean;
  allowNetwork: boolean;
  allowShell: boolean;
}