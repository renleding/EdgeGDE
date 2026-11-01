// orca-ade - Worktree manager, agent assignment, fan-out execution, result collection

// Types
export type * from './types';

// Worktree
export { WorktreeManagerImpl, createWorktreeManager } from './worktree';

// Mission
export { MissionCompiler, ScopeValidator, FanoutProtocol } from './mission';

// Fanout
export { ParallelCoordinator } from './fanout';

// Version
export const VERSION = '0.1.0';