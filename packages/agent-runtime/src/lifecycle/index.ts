import { EventEmitter } from 'events';
import { 
  Task, 
  TaskStatus, 
  Plugin, 
  PluginResult, 
  ExecutionContext,
  TaskQueueImpl,
  PluginRegistry,
  TaskExecutor,
} from '../types';
import { TaskPersistence, ConsoleLogger, createDefaultLogger, InMemoryStateStore, Logger } from '../state';

export class TaskLifecycle extends EventEmitter {
  private tasks: Map<string, Task> = new Map();
  private queue: TaskQueueImpl;
  private persistence: TaskPersistence;
  private running: Set<string> = new Set();
  private maxConcurrency: number;

  constructor(
    queue: TaskQueueImpl,
    persistence: TaskPersistence,
    maxConcurrency: number = 3
  ) {
    super();
    this.queue = queue;
    this.persistence = persistence;
    this.maxConcurrency = maxConcurrency;
  }

  async createTask(task: Omit<Task, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'retries'>): Promise<Task> {
    const newTask: Task = {
      ...task,
      id: crypto.randomUUID(),
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      retries: 0,
    };
    this.tasks.set(newTask.id, newTask);
    await this.persistence.saveTask(this.toPersisted(newTask));
    await this.queue.enqueue(newTask);
    return newTask;
  }

  async getNextTask(): Promise<Task | null> {
    if (this.running.size >= this.maxConcurrency) {
      return null;
    }
    const task = await this.queue.dequeue();
    if (task) {
      this.running.add(task.id);
      task.status = 'running';
      task.startedAt = Date.now();
      task.updatedAt = Date.now();
      this.tasks.set(task.id, task);
      await this.persistTask(task);
      this.emit('taskStart', task);
    }
    return task;
  }

  async completeTask(taskId: string, result: unknown): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = 'completed';
    task.completedAt = Date.now();
    task.updatedAt = Date.now();
    task.result = result;
    this.running.delete(taskId);
    this.tasks.set(taskId, task);
    await this.persistence.saveTask(this.toPersisted(task));
    this.emit('taskComplete', task);
  }

  async failTask(taskId: string, error: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    if (task.retries < task.maxRetries) {
      task.status = 'retrying';
      task.retries++;
      task.updatedAt = Date.now();
      task.error = error;
      await this.persistence.saveTask(this.toPersisted(task));
      await this.queue.requeue(task);
      this.running.delete(taskId);
      this.emit('taskRetry', task);
    } else {
      task.status = 'failed';
      task.completedAt = Date.now();
      task.updatedAt = Date.now();
      task.error = error;
      this.running.delete(taskId);
      this.tasks.set(taskId, task);
      await this.persistence.saveTask(this.toPersisted(task));
      this.emit('taskFailed', task, error);
    }
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  getRunningCount(): number {
    return this.running.size;
  }

  private toPersisted(task: Task) {
    return {
      id: task.id,
      type: task.type,
      payload: task.payload,
      status: task.status,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      result: task.result,
      error: task.error,
      retries: task.retries,
      maxRetries: task.maxRetries,
      plugin: task.plugin,
    };
  }

  private async persistTask(task: Task): Promise<void> {
    await this.persistence.saveTask(this.toPersisted(task));
  }
}

export class ExecutionRunner {
  private lifecycle: TaskLifecycle;
  private registry: PluginRegistry;
  private logger: ConsoleLogger;

  constructor(lifecycle: TaskLifecycle, registry: PluginRegistry, logger?: ConsoleLogger) {
    this.lifecycle = lifecycle;
    this.registry = registry;
    this.logger = logger || createDefaultLogger('runner');
  }

  async run(): Promise<void> {
    this.logger.info('Execution runner started');
    while (true) {
      const task = await this.lifecycle.getNextTask();
      if (!task) {
        await this.sleep(1000);
        continue;
      }

      this.logger.info('Executing task', { taskId: task.id, type: task.type });

      const plugin = this.registry.get(task.type);
      if (!plugin) {
        this.logger.error('No plugin for task type', { taskId: task.id, type: task.type });
        await this.lifecycle.failTask(task.id, `No plugin registered for type: ${task.type}`);
        continue;
      }

      const context = this.createContext(task);
      try {
        const result = await plugin.execute(task, context);
        if (result.success) {
          await this.lifecycle.completeTask(task.id, result.output);
          this.logger.info('Task completed', { taskId: task.id });
        } else {
          await this.lifecycle.failTask(task.id, result.error || 'Plugin returned failure');
          this.logger.warn('Task failed', { taskId: task.id, error: result.error });
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        await this.lifecycle.failTask(task.id, errMsg);
        this.logger.error('Task error', { taskId: task.id, error: errMsg });
      }
    }
  }

  private createContext(task: Task): ExecutionContext {
    return {
      taskId: task.id,
      workingDir: process.cwd(),
      env: { ...process.env } as Record<string, string>,
      state: new InMemoryStateStore(),
      logger: this.logger,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export type { createDefaultLogger, ConsoleLogger, InMemoryStateStore, Logger } from '../state';