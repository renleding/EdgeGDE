import { execSync } from 'child_process';
import { 
  Mission, 
  TaskResult, 
  ExecutionResult, 
  MergedChange, 
  MergeConflict,
  Worktree,
  FanoutConfig,
  AgentAssignment
} from '../types';
import { WorktreeManagerImpl } from '../worktree';
import { MissionCompiler, ScopeValidator, FanoutProtocol } from '../mission';

export class ParallelCoordinator {
  private worktreeManager: WorktreeManagerImpl;
  private config: FanoutConfig;
  private assignments: Map<string, AgentAssignment> = new Map();

  constructor(worktreeManager: WorktreeManagerImpl, config: FanoutConfig) {
    this.worktreeManager = worktreeManager;
    this.config = config;
  }

  async executeMission(mission: any): Promise<ExecutionResult> {
    const startTime = Date.now();
    const compiler = new MissionCompiler({ 
      designGraph: { nodes: [], edges: [] }, 
      scopeRules: [] 
    });

    // Fanout the mission
    const childMissions = FanoutProtocol.fanout(mission, this.config.strategy);
    
    // Validate scope overlaps
    const scopeManifests = this.buildScopeManifests(childMissions);
    if (this.config.validateZeroOverlap) {
      if (!ScopeValidator.validateZeroOverlap(scopeManifests)) {
        throw new Error('Scope overlap detected - missions have conflicting paths');
      }
    }

    // Assign worktrees
    const assignments = await this.assignWorktrees(childMissions);
    
    // Execute in parallel (limited by maxParallel)
    const taskResults = await this.executeParallel(childMissions, assignments);
    
    // Merge results
    const mergedChanges = await this.mergeResults(taskResults);
    
    // Determine overall status
    const failed = taskResults.filter(r => r.status === 'failed').length;
    const status: any = failed > 0 ? 'partial' : 'completed';

    return {
      missionId: mission.id,
      status,
      taskResults,
      mergedChanges,
      duration: Date.now() - startTime,
      completedAt: Date.now(),
    };
  }

  private buildScopeManifests(childMissions: any[]): any[] {
    return childMissions.map(m => ({
      missionId: m.id,
      paths: m.scope?.allowedPaths || [],
      exclusive: true,
    }));
  }

  private async assignWorktrees(childMissions: any[]): Promise<AgentAssignment[]> {
    const assignments: AgentAssignment[] = [];
    const availableWorktrees = this.worktreeManager.getFreeWorktrees();
    
    if (availableWorktrees.length < childMissions.length) {
      throw new Error(`Not enough free worktrees (need ${childMissions.length}, have ${availableWorktrees.length})`);
    }

    for (let i = 0; i < childMissions.length; i++) {
      const worktree = availableWorktrees[i];
      if (!worktree) continue;
      const mission = childMissions[i];
      
      await this.worktreeManager.allocateWorktree(worktree.agentId, mission.parentMissionId);
      
      const assignment: AgentAssignment = {
        worktreeId: worktree.id,
        agentId: worktree.agentId,
        missionId: mission.id,
        taskIds: mission.tasks.map((t: any) => t.id),
        assignedAt: Date.now(),
      };
      
      this.assignments.set(mission.id, assignment);
      assignments.push(assignment);
    }
    
    return assignments;
  }

  private async executeParallel(childMissions: any[], assignments: AgentAssignment[]): Promise<any[]> {
    const results: any[] = [];
    const executing: Promise<any>[] = [];
    const semaphore = this.config.maxParallel || 3;
    
    for (const assignment of assignments) {
      const mission = childMissions.find(m => m.id === assignment.missionId);
      if (!mission) continue;

      const promise = this.executeInWorktree(assignment, mission);
      executing.push(promise);

      if (executing.length >= semaphore) {
        const completed = await Promise.race(executing);
        results.push(completed);
        const idx = executing.findIndex(p => p === completed);
        if (idx >= 0) executing.splice(idx, 1);
      }
    }

    // Wait for remaining
    while (executing.length > 0) {
      const completed = await Promise.race(executing);
      results.push(completed);
      const idx = executing.findIndex(p => p === completed);
      if (idx >= 0) executing.splice(idx, 1);
    }

    return results;
  }

  private async executeInWorktree(assignment: AgentAssignment, mission: any): Promise<any> {
    const worktree = this.worktreeManager.getWorktree(assignment.worktreeId);
    if (!worktree) throw new Error(`Worktree ${assignment.worktreeId} not found`);

    worktree.status = 'busy';
    
    try {
      // In real implementation, this would invoke the agent-runtime
      // For now, simulate execution
      const taskResults: any[] = [];
      
      for (const task of mission.tasks) {
        const start = Date.now();
        // Simulate task execution
        await this.sleep(100);
        taskResults.push({
          taskId: task.id,
          status: 'completed',
          output: { simulated: true },
          duration: Date.now() - start,
          worktreeId: worktree.id,
        });
      }

      return {
        missionId: mission.id,
        worktreeId: worktree.id,
        taskResults,
      };
    } finally {
      worktree.status = 'free';
      await this.worktreeManager.releaseWorktree(worktree.id);
    }
  }

  private async mergeResults(taskResults: any[]): Promise<any[]> {
    const mergedChanges: any[] = [];
    
    for (const result of taskResults) {
      for (const taskResult of result.taskResults) {
        if (taskResult.output && typeof taskResult.output === 'object') {
          for (const [path, content] of Object.entries(taskResult.output as Record<string, any>)) {
            mergedChanges.push({
              path,
              sourceWorktree: result.worktreeId,
              operation: 'update',
              content: JSON.stringify(content),
            });
          }
        }
      }
    }
    return mergedChanges;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export { FanoutProtocol } from '../mission';
export { ScopeValidator } from '../mission';