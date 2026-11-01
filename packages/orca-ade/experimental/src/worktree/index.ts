import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import {
  Worktree,
  WorktreeStatus,
  WorktreeManagerConfig,
  WorktreeManager,
  WorktreeManagerConfig as Config
} from '../types';

export class WorktreeManagerImpl implements WorktreeManager {
  private config: WorktreeManagerConfig;
  private worktrees: Map<string, Worktree> = new Map();
  private allocated: Set<string> = new Set();

  constructor(config: WorktreeManagerConfig) {
    this.config = config;
    this.ensureBasePath();
    this.discoverExistingWorktrees();
  }

  private ensureBasePath(): void {
    if (!fs.existsSync(this.config.basePath)) {
      fs.mkdirSync(this.config.basePath, { recursive: true });
    }
  }

  private discoverExistingWorktrees(): void {
    if (!fs.existsSync(this.config.basePath)) return;

    const dirs = fs.readdirSync(this.config.basePath);
    for (const dir of dirs) {
      const fullPath = path.join(this.config.basePath, dir);
      if (fs.existsSync(path.join(fullPath, '.git'))) {
        try {
          const branch = execSync('git branch --show-current', { 
            cwd: fullPath, 
            encoding: 'utf-8' 
          }).trim();
          
          const worktree: Worktree = {
            id: dir,
            agentId: dir.replace(this.config.agentPrefix + '-', ''),
            path: fullPath,
            branch,
            status: 'free',
            createdAt: fs.statSync(fullPath).birthtimeMs,
            lastUsedAt: Date.now(),
          };
          this.worktrees.set(dir, worktree);
        } catch {
          // Not a valid git worktree, skip
        }
      }
    }
  }

  async createWorktree(agentId: string): Promise<Worktree> {
    const worktreeId = `${this.config.agentPrefix}-${agentId}`;
    const worktreePath = path.join(this.config.basePath, worktreeId);
    const branch = `work/${agentId}-${Date.now()}`;

    if (fs.existsSync(worktreePath)) {
      throw new Error(`Worktree ${worktreeId} already exists`);
    }

    // Create worktree
    execSync(`git worktree add -b ${branch} "${worktreePath}"`, {
      cwd: path.dirname(this.config.basePath),
      stdio: 'pipe'
    });

    const worktree: Worktree = {
      id: worktreeId,
      agentId,
      path: worktreePath,
      branch,
      status: 'free',
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    };

    this.worktrees.set(worktreeId, worktree);
    return worktree;
  }

  async getOrCreateWorktree(agentId: string): Promise<Worktree> {
    const existing = this.findByAgent(agentId);
    if (existing) return existing;

    if (this.worktrees.size >= this.config.maxWorktrees) {
      throw new Error(`Max worktrees (${this.config.maxWorktrees}) reached`);
    }

    return this.createWorktree(agentId);
  }

  async allocateWorktree(agentId: string, missionId: string): Promise<Worktree> {
    const worktree = await this.getOrCreateWorktree(agentId);
    
    if (worktree.status !== 'free') {
      throw new Error(`Worktree ${worktree.id} is not free (status: ${worktree.status})`);
    }

    worktree.status = 'allocated';
    worktree.currentMission = missionId;
    worktree.lastUsedAt = Date.now();
    this.allocated.add(worktree.id);

    return worktree;
  }

  async releaseWorktree(worktreeId: string): Promise<void> {
    const worktree = this.worktrees.get(worktreeId);
    if (!worktree) return;

    worktree.status = 'free';
    worktree.currentMission = undefined;
    this.allocated.delete(worktreeId);
  }

  async deleteWorktree(worktreeId: string): Promise<void> {
    const worktree = this.worktrees.get(worktreeId);
    if (!worktree) return;

    if (worktree.status !== 'free') {
      throw new Error(`Cannot delete non-free worktree ${worktreeId}`);
    }

    execSync(`git worktree remove "${worktree.path}"`, { stdio: 'pipe' });
    execSync(`git branch -D ${worktree.branch}`, { stdio: 'pipe' });
    
    this.worktrees.delete(worktreeId);
    this.allocated.delete(worktreeId);
  }

  findByAgent(agentId: string): Worktree | undefined {
    for (const wt of this.worktrees.values()) {
      if (wt.agentId === agentId) return wt;
    }
    return undefined;
  }

  getWorktree(id: string): Worktree | undefined {
    return this.worktrees.get(id);
  }

  getAllWorktrees(): Worktree[] {
    return Array.from(this.worktrees.values());
  }

  getFreeWorktrees(): Worktree[] {
    return Array.from(this.worktrees.values()).filter(w => w.status === 'free');
  }

  getAllocatedWorktrees(): Worktree[] {
    return Array.from(this.worktrees.values()).filter(w => w.status === 'allocated' || w.status === 'busy');
  }

  getStats() {
    const all = this.getAllWorktrees();
    return {
      total: all.length,
      free: all.filter(w => w.status === 'free').length,
      allocated: all.filter(w => w.status === 'allocated').length,
      busy: all.filter(w => w.status === 'busy').length,
      error: all.filter(w => w.status === 'error').length,
    };
  }
}

// Export factory function
export function createWorktreeManager(config: WorktreeManagerConfig): WorktreeManagerImpl {
  return new WorktreeManagerImpl(config);
}