import { z } from 'zod';
import { VerificationCriteria, VerificationResult } from '../types';

// Node.js globals
declare const process: { cwd(): string };
declare const setTimeout: (fn: () => void, ms: number) => number;

// Verification criteria schema
export const VerificationCriteriaSchema = z.object({
  type: z.enum(['test_command', 'script', 'http_check', 'state_check']),
  command: z.string().optional(),
  script: z.string().optional(),
  endpoint: z.string().optional(),
  path: z.string().optional(),
  expected: z.unknown(),
  timeout: z.number().positive().default(30000)
});

export type VerificationCriteriaInput = z.infer<typeof VerificationCriteriaSchema>;

export interface RunnerConfig {
  defaultTimeout: number;
  maxRetries: number;
  workingDir: string;
}

export interface ExecutionContext {
  workingDir: string;
  env: Record<string, string>;
  previousOutputs: Record<string, unknown>;
  pageState?: unknown;
}

export class VerificationRunner {
  private config: RunnerConfig;

  constructor(config: Partial<RunnerConfig> = {}) {
    this.config = {
      defaultTimeout: config.defaultTimeout ?? 30000,
      maxRetries: config.maxRetries ?? 3,
      workingDir: config.workingDir ?? process.cwd()
    };
  }

  /**
   * Run verification criteria against execution context
   */
  async run(criteria: VerificationCriteriaInput, context: ExecutionContext): Promise<VerificationResult> {
    const validated = VerificationCriteriaSchema.parse(criteria);
    const timeout = validated.timeout || this.config.defaultTimeout;

    try {
      switch (validated.type) {
        case 'test_command':
          return await this.runTestCommand(validated.command!, context, timeout);
        case 'script':
          return await this.runScript(validated.script!, context, timeout);
        case 'http_check':
          return await this.runHttpCheck(validated.endpoint!, validated.expected, context, timeout);
        case 'state_check':
          return await this.runStateCheck(validated.path!, validated.expected, context, timeout);
        default:
          throw new Error(`Unknown verification type: ${validated.type}`);
      }
    } catch (error) {
      return {
        passed: false,
        evidence: { error: error instanceof Error ? error.message : String(error) },
        duration_ms: 0
      };
    }
  }

  /**
   * Run a test command (e.g., bun test, vitest, npm test)
   */
  private async runTestCommand(command: string, context: ExecutionContext, timeout: number): Promise<VerificationResult> {
    const start = Date.now();
    
    // In a real implementation, this would spawn the process
    // For now, we simulate the structure
    const result = await this.executeWithTimeout(
      () => this.simulateCommand(command, context),
      timeout
    );

    return {
      passed: result.exitCode === 0,
      evidence: {
        command,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode
      },
      duration_ms: Date.now() - start
    };
  }

  /**
   * Run a script file
   */
  private async runScript(script: string, context: ExecutionContext, timeout: number): Promise<VerificationResult> {
    const start = Date.now();
    
    const result = await this.executeWithTimeout(
      () => this.simulateCommand(`bun run ${script}`, context),
      timeout
    );

    return {
      passed: result.exitCode === 0,
      evidence: {
        script,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode
      },
      duration_ms: Date.now() - start
    };
  }

  /**
   * Run an HTTP check against an endpoint
   */
  private async runHttpCheck(endpoint: string, expected: unknown, context: ExecutionContext, timeout: number): Promise<VerificationResult> {
    const start = Date.now();
    
    try {
      // In real implementation, use fetch
      const response = await this.executeWithTimeout(
        () => this.simulateHttpRequest(endpoint),
        timeout
      );

      const passed = this.evaluateExpected(response, expected);

      return {
        passed,
        evidence: {
          endpoint,
          status: response.status,
          body: response.body,
          expected,
          match: passed
        },
        duration_ms: Date.now() - start
      };
    } catch (error) {
      return {
        passed: false,
        evidence: {
          endpoint,
          error: error instanceof Error ? error.message : String(error)
        },
        duration_ms: Date.now() - start
      };
    }
  }

  /**
   * Run a state check (e.g., file exists, JSON path matches)
   */
  private async runStateCheck(path: string, expected: unknown, context: ExecutionContext, timeout: number): Promise<VerificationResult> {
    const start = Date.now();
    
    try {
      // In real implementation, read file or query state
      const actual = await this.executeWithTimeout(
        () => this.simulateStateRead(path, context),
        timeout
      );

      const passed = this.evaluateExpected(actual, expected);

      return {
        passed,
        evidence: {
          path,
          actual,
          expected,
          match: passed
        },
        duration_ms: Date.now() - start
      };
    } catch (error) {
      return {
        passed: false,
        evidence: {
          path,
          error: error instanceof Error ? error.message : String(error)
        },
        duration_ms: Date.now() - start
      };
    }
  }

  /**
   * Evaluate if actual matches expected (supports various expected formats)
   */
  private evaluateExpected(actual: unknown, expected: unknown): boolean {
    // Exact match
    if (JSON.stringify(actual) === JSON.stringify(expected)) return true;

    // Expected is a predicate object
    if (expected && typeof expected === 'object') {
      const exp = expected as Record<string, unknown>;
      
      // { equals: value }
      if ('equals' in exp) {
        return JSON.stringify(actual) === JSON.stringify(exp.equals);
      }
      
      // { contains: value }
      if ('contains' in exp) {
        const actualStr = JSON.stringify(actual);
        const containsStr = JSON.stringify(exp.contains);
        return actualStr.includes(containsStr);
      }
      
      // { matches: regex }
      if ('matches' in exp && typeof exp.matches === 'string') {
        try {
          const regex = new RegExp(exp.matches);
          return regex.test(JSON.stringify(actual));
        } catch {
          return false;
        }
      }
      
      // { gt: number } / { lt: number } / { gte: number } / { lte: number }
      if (typeof actual === 'number') {
        if ('gt' in exp && actual <= (exp.gt as number)) return false;
        if ('lt' in exp && actual >= (exp.lt as number)) return false;
        if ('gte' in exp && actual < (exp.gte as number)) return false;
        if ('lte' in exp && actual > (exp.lte as number)) return false;
      }
    }

    return false;
  }

  /**
   * Execute with timeout
   */
  private async executeWithTimeout<T>(fn: () => Promise<T>, timeout: number): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout)
      )
    ]);
  }

  // Simulation methods (replace with real implementations)
  private async simulateCommand(command: string, context: ExecutionContext): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    // Simulate command execution
    return {
      exitCode: 0,
      stdout: `Simulated output for: ${command}`,
      stderr: ''
    };
  }

  private async simulateHttpRequest(endpoint: string): Promise<{ status: number; body: unknown }> {
    return { status: 200, body: { ok: true } };
  }

  private async simulateStateRead(path: string, context: ExecutionContext): Promise<unknown> {
    return { path, exists: true };
  }
}

// Code→Validate Loop Implementation
export interface LoopConfig {
  initialContent: string;
  writePath: string;
  criteria: VerificationCriteriaInput;
  adjustCallback: (content: string, failure: VerificationResult) => string;
  iterationLimit?: number;
  governanceGate?: (content: string) => Promise<{ allowed: boolean; report: unknown }>;
}

export interface LoopResult {
  status: 'completed' | 'escalated' | 'rejected';
  finalContent?: string;
  iterations: number;
  lastFailure?: VerificationResult;
  governanceReport?: unknown;
}

export class CodeValidateLoop {
  private config: Required<LoopConfig>;

  constructor(config: LoopConfig) {
    this.config = {
      initialContent: config.initialContent,
      writePath: config.writePath,
      criteria: config.criteria,
      adjustCallback: config.adjustCallback,
      iterationLimit: config.iterationLimit ?? 5,
      governanceGate: config.governanceGate ?? (async () => ({ allowed: true, report: {} }))
    };
  }

  async execute(runner: VerificationRunner, context: ExecutionContext): Promise<LoopResult> {
    let content = this.config.initialContent;
    let iterations = 0;

    while (iterations < this.config.iterationLimit) {
      iterations++;

      // Governance gate check before write
      const gateResult = await this.config.governanceGate(content);
      if (!gateResult.allowed) {
        return {
          status: 'rejected',
          iterations,
          governanceReport: gateResult.report
        };
      }

      // Write content (in real implementation, write to file)
      // await writeFile(this.config.writePath, content);

      // Verify
      const verification = await runner.run(this.config.criteria, context);
      
      if (verification.passed) {
        return {
          status: 'completed',
          finalContent: content,
          iterations
        };
      }

      // Adjust callback
      content = this.config.adjustCallback(content, verification);
    }

    // Exhausted iterations
    const lastVerification = await runner.run(this.config.criteria, context);
    return {
      status: 'escalated',
      iterations,
      lastFailure: lastVerification
    };
  }
}

export const verificationRunner = new VerificationRunner();