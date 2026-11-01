// agent-runtime - Task lifecycle, plugin interface, execution runner, state persistence

// Types
export type { 
  Task, 
  TaskStatus, 
  Plugin, 
  PluginResult, 
  ExecutionContext,
  Logger,
  StateStore,
  RunnerConfig,
  TaskQueue,
  RuntimeEvents,
  PersistedTask,
  RuntimeState,
  TaskExecutor,
} from './types';
export { TaskQueueImpl, PluginRegistry } from './types';

// State
export { FileStateStore, TaskPersistence, ConsoleLogger, createDefaultLogger } from './state';

// Lifecycle
export { 
  TaskLifecycle, 
  ExecutionRunner,
} from './lifecycle';

// Version
export const VERSION = '0.1.0';