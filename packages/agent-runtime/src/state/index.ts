import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_STATE_DIR = path.join(process.cwd(), '.agent-runtime', 'state');

// Logger interface
export interface Logger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
  debug: (msg: string, meta?: Record<string, unknown>) => void;
}

// StateStore interface
export interface StateStore {
  get: <T>(key: string) => Promise<T | null>;
  set: <T>(key: string, value: T) => Promise<void>;
  delete: (key: string) => Promise<void>;
  list: (prefix: string) => Promise<string[]>;
}

export class FileStateStore implements StateStore {
  private dir: string;
  private cache: Map<string, unknown> = new Map();

  constructor(dir: string = DEFAULT_STATE_DIR) {
    this.dir = dir;
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (this.cache.has(key)) {
      return this.cache.get(key) as T | null;
    }
    const filePath = path.join(this.dir, `${key}.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const value = JSON.parse(content);
      this.cache.set(key, value);
      return value as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.cache.set(key, value);
    const filePath = path.join(this.dir, `${key}.json`);
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
    const filePath = path.join(this.dir, `${key}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  async list(prefix: string): Promise<string[]> {
    if (!fs.existsSync(this.dir)) return [];
    const files = fs.readdirSync(this.dir);
    return files
      .filter((f: string) => f.startsWith(prefix) && f.endsWith('.json'))
      .map(f => f.slice(0, -5));
  }
}

export class TaskPersistence {
  private store: FileStateStore;
  private tasksKey = 'tasks';
  private queueKey = 'queue';
  private runningKey = 'running';

  constructor(stateDir?: string) {
    this.store = new FileStateStore(stateDir);
  }

  async saveTask(task: any): Promise<void> {
    const tasks = await this.getAllTasks();
    tasks.set(task.id, task);
    await this.store.set(this.tasksKey, Object.fromEntries(tasks));
  }

  async getTask(id: string): Promise<any | null> {
    const tasks = await this.getAllTasks();
    return tasks.get(id) || null;
  }

  async getAllTasks(): Promise<Map<string, any>> {
    const data = await this.store.get<Record<string, any>>(this.tasksKey);
    if (!data) return new Map();
    const map = new Map<string, any>();
    for (const [id, task] of Object.entries(data)) {
      map.set(id, task);
    }
    return map;
  }

  async deleteTask(id: string): Promise<void> {
    const tasks = await this.getAllTasks();
    tasks.delete(id);
    await this.store.set(this.tasksKey, Object.fromEntries(tasks));
  }

  async getQueue(): Promise<string[]> {
    return (await this.store.get<string[]>(this.queueKey)) || [];
  }

  async saveQueue(queue: string[]): Promise<void> {
    await this.store.set(this.queueKey, queue);
  }

  async getRunning(): Promise<string[]> {
    return (await this.store.get<string[]>(this.runningKey)) || [];
  }

  async saveRunning(running: string[]): Promise<void> {
    await this.store.set(this.runningKey, running);
  }

  async addToQueue(taskId: string): Promise<void> {
    const queue = await this.getQueue();
    if (!queue.includes(taskId)) {
      queue.push(taskId);
      await this.saveQueue(queue);
    }
  }

  async removeFromQueue(taskId: string): Promise<void> {
    const queue = await this.getQueue();
    const idx = queue.indexOf(taskId);
    if (idx >= 0) {
      queue.splice(idx, 1);
      await this.saveQueue(queue);
    }
  }

  async addToRunning(taskId: string): Promise<void> {
    const running = await this.getRunning();
    if (!running.includes(taskId)) {
      running.push(taskId);
      await this.saveRunning(running);
    }
  }

  async removeFromRunning(taskId: string): Promise<void> {
    const running = await this.getRunning();
    const idx = running.indexOf(taskId);
    if (idx >= 0) {
      running.splice(idx, 1);
      await this.saveRunning(running);
    }
  }
}

export class ConsoleLogger {
  constructor(private prefix: string) {}

  private format(level: string, msg: string, meta?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level}] [${this.prefix}] ${msg}${metaStr}`;
  }

  info(msg: string, meta?: Record<string, unknown>): void {
    console.log(this.format('INFO', msg, meta));
  }

  warn(msg: string, meta?: Record<string, unknown>): void {
    console.warn(this.format('WARN', msg, meta));
  }

  error(msg: string, meta?: Record<string, unknown>): void {
    console.error(this.format('ERROR', msg, meta));
  }

  debug(msg: string, meta?: Record<string, unknown>): void {
    console.debug(this.format('DEBUG', msg, meta));
  }
}

export function createDefaultLogger(prefix: string = 'runtime'): ConsoleLogger {
  return new ConsoleLogger(prefix);
}

// In-memory state store for testing/simulation
export class InMemoryStateStore {
  private data: Map<string, unknown> = new Map();

  async get<T>(key: string): Promise<T | null> {
    return (this.data.get(key) as T | null) || null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async list(prefix: string): Promise<string[]> {
    return Array.from(this.data.keys()).filter(k => k.startsWith(prefix));
  }
}

// Logger type export
export interface Logger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
  debug: (msg: string, meta?: Record<string, unknown>) => void;
}