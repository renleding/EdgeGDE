import { 
  Mission, 
  MissionTask, 
  MissionScope, 
  FanoutStrategy, 
  MissionCompilerConfig,
  DesignGraph,
  ScopeRule,
  ScopeManifest,
  TaskScope
} from '../types';

export class MissionCompiler {
  private scopeRules: ScopeRule[];

  constructor(config: MissionCompilerConfig) {
    this.scopeRules = config.scopeRules;
  }

  compile(designGraph: DesignGraph): Mission {
    const tasks: MissionTask[] = [];
    const scope = this.buildScope(designGraph);

    for (const node of designGraph.nodes) {
      const task = this.compileNode(node, designGraph);
      if (task) tasks.push(task);
    }

    // Validate dependencies form a DAG
    this.validateDAG(tasks);

    const firstNode = designGraph.nodes[0];
    return {
      id: crypto.randomUUID(),
      name: (firstNode?.config?.name as string) || 'Unnamed Mission',
      description: (firstNode?.config?.description as string) || '',
      tasks,
      scope,
      strategy: (firstNode?.config?.strategy as FanoutStrategy) || 'parallel',
      createdAt: Date.now(),
      status: 'pending',
    };
  }

  private compileNode(node: any, graph: any): MissionTask | null {
    const scope = this.getScopeForNode(node.type);
    
    return {
      id: node.id,
      name: node.config.name || node.type,
      type: node.type,
      payload: node.config.payload || {},
      dependsOn: this.getDependencies(node.id, graph),
      scope,
      verification: node.config.verification,
    };
  }

  private getDependencies(nodeId: string, graph: any): string[] {
    return graph.edges
      .filter((e: any) => e.to === nodeId)
      .map((e: any) => e.from);
  }

  private buildScope(graph: any): MissionScope {
    const allPaths = new Set<string>();
    
    for (const node of graph.nodes) {
      const rule = this.scopeRules.find(r => r.pattern === node.type);
      if (rule) {
        for (const path of this.expandPattern(rule.pattern)) {
          allPaths.add(path);
        }
      }
    }

    return {
      allowedPaths: Array.from(allPaths),
      forbiddenPaths: ['.git/**', '**/.env', '**/node_modules/**', '**/dist/**'],
      allowNetwork: graph.nodes.some((n: any) => n.config.allowNetwork),
      allowShell: graph.nodes.some((n: any) => n.config.allowShell),
    };
  }

  private getScopeForNode(nodeType: string): TaskScope {
    const rule = this.scopeRules.find(r => r.pattern === nodeType);
    if (!rule) {
      return {
        paths: ['.'],
        allowNetwork: false,
        allowShell: false,
      };
    }
    return {
      paths: this.expandPattern(rule.pattern),
      allowNetwork: rule.allowNetwork,
      allowShell: rule.allowShell,
    };
  }

  private expandPattern(pattern: string): string[] {
    // Simple pattern expansion - in reality would be more complex
    return pattern === '*' ? ['.'] : [pattern];
  }

  private validateDAG(tasks: MissionTask[]): void {
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (taskId: string) => {
      if (visiting.has(taskId)) {
        throw new Error(`Circular dependency detected involving ${taskId}`);
      }
      if (visited.has(taskId)) return;

      visiting.add(taskId);
      const task = tasks.find(t => t.id === taskId);
      if (task) {
        for (const dep of task.dependsOn) {
          visit(dep);
        }
      }
      visiting.delete(taskId);
      visited.add(taskId);
    }

    for (const task of tasks) {
      if (!visited.has(task.id)) {
        visit(task.id);
      }
    }
  }
}

export class ScopeValidator {
  static validateZeroOverlap(manifests: ScopeManifest[]): boolean {
    const allPaths = new Map<string, string[]>();
    
    for (const manifest of manifests) {
      for (const p of manifest.paths) {
        if (!allPaths.has(p)) {
          allPaths.set(p, []);
        }
        allPaths.get(p)!.push(manifest.missionId);
      }
    }

    for (const [path, missions] of allPaths) {
      const exclusiveMissions = missions.filter((mId: string) => {
        const manifest = manifests.find(man => man.missionId === mId);
        return manifest?.exclusive;
      });
      if (exclusiveMissions.length > 1) {
        return false;
      }
    }
    return true;
  }

  static getOverlaps(manifests: ScopeManifest[]): Map<string, string[]> {
    const overlaps = new Map<string, string[]>();
    const allPaths = new Map<string, string[]>();
    
    for (const manifest of manifests) {
      for (const p of manifest.paths) {
        if (!allPaths.has(p)) {
          allPaths.set(p, []);
        }
        allPaths.get(p)!.push(manifest.missionId);
      }
    }

    for (const [path, missions] of allPaths) {
      if (missions.length > 1) {
        overlaps.set(path, missions);
      }
    }
    return overlaps;
  }
}

export class FanoutProtocol {
  static fanout(mission: Mission, strategy: 'parallel' | 'complementary'): any[] {
    if (strategy === 'parallel') {
      return this.parallelFanout(mission);
    }
    return this.complementaryFanout(mission);
  }

  private static parallelFanout(mission: Mission): any[] {
    // Split tasks into independent groups that can run in parallel
    const independentGroups = this.findIndependentGroups(mission.tasks);
    return independentGroups.map((group, i) => ({
      id: `${mission.id}-fanout-${i}`,
      parentMissionId: mission.id,
      tasks: group,
      scope: mission.scope,
    }));
  }

  private static complementaryFanout(mission: Mission): any[] {
    // Split by scope exclusivity - tasks with different exclusive scopes
    const byScope = new Map<string, MissionTask[]>();
    for (const task of mission.tasks) {
      const scopeKey = task.scope.paths.sort().join(',');
      if (!byScope.has(scopeKey)) byScope.set(scopeKey, []);
      byScope.get(scopeKey)!.push(task);
    }
    return Array.from(byScope.entries()).map(([scope, tasks], i) => ({
      id: `${mission.id}-complement-${i}`,
      parentMissionId: mission.id,
      tasks,
      scope: mission.scope,
    }));
  }

  private static findIndependentGroups(tasks: MissionTask[]): MissionTask[][] {
    // Simple topological grouping - tasks with no dependencies on each other
    const groups: MissionTask[][] = [];
    const remaining = [...tasks];
    
    while (remaining.length > 0) {
      const group: MissionTask[] = [];
      for (let i = 0; i < remaining.length; i++) {
        const task = remaining[i];
        if (!task) continue;
        const depsInGroup = task.dependsOn.some((d: string) => group.some(t => t.id === d));
        const depsInRemaining = task.dependsOn.some((d: string) => remaining.some(t => t && t.id === d));
        
        if (!depsInGroup && !depsInRemaining) {
          group.push(task);
        }
      }
      
      if (group.length === 0) {
        // Add first remaining task to avoid infinite loop
        const firstTask = remaining[0];
        if (firstTask) group.push(firstTask);
      }
      
      for (const t of group) {
        const idx = remaining.indexOf(t);
        if (idx >= 0) remaining.splice(idx, 1);
      }
      groups.push(group);
    }
    return groups;
  }
}

export type { MissionCompilerConfig, DesignGraph, ScopeRule } from '../types';