// Core types for agent-runtime - NO DUPLICATES

export interface Task {
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
}

export type TaskStatus = 
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'retrying';

export interface Plugin {
  name: string;
  version: string;
  handles: string[];
  execute: (task: Task, context: ExecutionContext) => Promise<PluginResult>;
  validate?: (payload: unknown) => boolean;
}

export interface PluginResult {
  success: boolean;
  output?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface ExecutionContext {
  taskId: string;
  workingDir: string;
  env: Record<string, string>;
  state: StateStore;
  logger: Logger;
}

export interface Logger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
  debug: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface StateStore {
  get: <T>(key: string) => Promise<T | null>;
  set: <T>(key: string, value: T) => Promise<void>;
  delete: (key: string) => Promise<void>;
  list: (prefix: string) => Promise<string[]>;
}

export interface RunnerConfig {
  maxConcurrency: number;
  defaultTimeout: number;
  retryDelay: number;
  stateDir: string;
}

export interface TaskQueue {
  enqueue: (task: Task) => Promise<void>;
  dequeue: () => Promise<Task | null>;
  size: () => Promise<number>;
  requeue: (task: Task) => Promise<void>;
}

export interface RuntimeEvents {
  onTaskStart: (task: Task) => void;
  onTaskComplete: (task: Task, result: PluginResult) => void;
  onTaskFailed: (task: Task, error: string) => void;
  onTaskRetry: (task: Task, attempt: number) => void;
}

export interface PersistedTask {
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
}

export interface RuntimeState {
  tasks: Map<string, PersistedTask>;
  queue: string[];
  running: string[];
  lastUpdate: number;
}

export interface Plugin {
  name: string;
  version: string;
  handles: string[];
  execute: (task: Task, context: ExecutionContext) => Promise<PluginResult>;
  validate?: (payload: unknown) => boolean;
}

export interface PluginResult {
  success: boolean;
  output?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface ExecutionContext {
  taskId: string;
  workingDir: string;
  env: Record<string, string>;
  state: StateStore;
  logger: Logger;
}

export interface Logger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
  debug: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface StateStore {
  get: <T>(key: string) => Promise<T | null>;
  set: <T>(key: string, value: T) => Promise<void>;
  delete: (key: string) => Promise<void>;
  list: (prefix: string) => Promise<string[]>;
}

export interface RunnerConfig {
  maxConcurrency: number;
  defaultTimeout: number;
  retryDelay: number;
  stateDir: string;
}

export interface TaskQueue {
  enqueue: (task: Task) => Promise<void>;
  dequeue: () => Promise<Task | null>;
  size: () => Promise<number>;
  requeue: (task: Task) => Promise<void>;
}

export interface RuntimeEvents {
  onTaskStart: (task: Task) => void;
  onTaskComplete: (task: Task, result: PluginResult) => void;
  onTaskFailed: (task: Task, error: string) => void;
  onTaskRetry: (task: Task, attempt: number) => void;
}

export interface PersistedTask {
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
}

export interface RuntimeState {
  tasks: Map<string, PersistedTask>;
  queue: string[];
  running: string[];
  lastUpdate: number,
}

export class TaskQueueImpl {
  private queue: Task[] = [];

  async enqueue(task: Task): Promise<void> {
    this.queue.push(task);
    this.queue.sort((a, b) => a.createdAt - b.createdAt);
  }

  async dequeue(): Promise<Task | null> {
    return this.queue.shift() || null;
  }

  async size(): Promise<number> {
    return this.queue.length;
  }

  async requeue(task: Task): Promise<void> {
    this.queue.unshift(task);
  }
}

export class PluginRegistry {
  private plugins: Map<string, Plugin> = new Map();

  register(plugin: Plugin): void {
    for (const type of plugin.handles) {
      this.plugins.set(type, plugin);
    }
  }

  get(type: string): Plugin | undefined {
    return this.plugins.get(type);
  }

  list(): Plugin[] {
    return Array.from(this.plugins.values());
  }
}

export interface TaskExecutor {
  execute(task: Task, context: ExecutionContext): Promise<PluginResult>;
}

export interface Plugin {
  name: string;
  version: string;
  handles: string[];
  execute: (task: Task, context: ExecutionContext) => Promise<PluginResult>;
  validate?: (payload: unknown) => boolean;
}

export interface PluginResult {
  success: boolean;
  output?: unknown;
  error?: string;
  metadata?: Record<string, unknown>,
}

export interface ExecutionContext {
  taskId: string,
  workingDir: string,
  env: Record<string, string>,
  state: StateStore,
  logger: Logger,
}

export interface Logger {
  info: (msg: string, meta?: Record<string, unknown>) => void,
  warn: (msg: string, meta?: Record<string, unknown>) => void,
  error: (msg: string, meta?: Record<string, unknown>) => void,
  debug: (msg: string, meta?: Record<string, unknown>) => void,
}

export interface StateStore {
  get: <T>(key: string) => Promise<T | null>,
  set: <T>(key: string, value: T) => Promise<void>,
  delete: (key: string) => Promise<void>,
  list: (prefix: string) => Promise<string[]>,
}

export interface RunnerConfig {
  maxConcurrency: number,
  defaultTimeout: number,
  retryDelay: number,
  stateDir: string,
}

export interface TaskQueue {
  enqueue: (task: Task) => Promise<void>,
  dequeue: () => Promise<Task | null>,
  size: () => Promise<number>,
  requeue: (task: Task) => Promise<void>,
}

export interface RuntimeEvents {
  onTaskStart: (task: Task) => void,
  onTaskComplete: (task: Task, result: PluginResult) => void,
  onTaskFailed: (task: Task, error: string) => void,
  onTaskRetry: (task: Task, attempt: number) => void,
}

export interface PersistedTask {
  id: string,
  type: string,
  payload: unknown,
  status: TaskStatus,
  createdAt: number,
  updatedAt: number,
  startedAt?: number,
  completedAt?: number,
  result?: unknown,
  error?: string,
  retries: number,
  maxRetries: number,
  plugin?: string,
}

export interface RuntimeState {
  tasks: Map<string, PersistedTask>,
  queue: string[],
  running: string[],
  lastUpdate: number,
}