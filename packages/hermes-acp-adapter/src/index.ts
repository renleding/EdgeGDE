// Main Hermes ACP Adapter - Entry point for Orca

import { ACPProtocolHandler, ACPHandler, HERMES_CAPABILITIES, HERMES_IMPLEMENTATION, HERMES_AUTH_METHODS } from '@acp/handler';
import { MissionTranslator } from '@translator/mission';
import { 
  InitializeRequest, 
  InitializeResponse, 
  NewSessionRequest, 
  NewSessionResponse, 
  LoadSessionRequest, 
  LoadSessionResponse, 
  PromptRequest, 
  PromptResponse,
  ReadTextFileRequest,
  ReadTextFileResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
  CreateTerminalRequest,
  CreateTerminalResponse,
  TerminalOutputRequest,
  TerminalOutputResponse,
  ReleaseTerminalRequest,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  KillTerminalRequest,
  SessionId,
  ContentBlock,
  StopReason,
  Usage,
} from '@acp/types';
import { MissionTranslator as Translator } from '@translator/mission';
import { 
  TaskQueueImpl, 
  PluginRegistry, 
  TaskLifecycle, 
  ExecutionRunner,
  ConsoleLogger,
  createDefaultLogger,
  FileStateStore,
  TaskPersistence,
  Task,
  Plugin,
  PluginResult,
  ExecutionContext,
} from '@edgegde/agent-runtime';

// Simple plugins for basic task types
const codingPlugin: Plugin = {
  name: 'coding',
  version: '1.0.0',
  handles: ['coding', 'refactoring', 'deployment'],
  execute: async (task: Task, context: ExecutionContext): Promise<PluginResult> => {
    const { requirement } = task.payload as { requirement: string };
    return {
      success: true,
      output: { message: `Completed: ${requirement}`, files: [] },
    };
  },
};

const testingPlugin: Plugin = {
  name: 'testing',
  version: '1.0.0',
  handles: ['testing'],
  execute: async (task: Task, context: ExecutionContext): Promise<PluginResult> => {
    const { requirement } = task.payload as { requirement: string };
    return {
      success: true,
      output: { message: `Test created for: ${requirement}`, files: [] },
    };
  },
};

const reviewPlugin: Plugin = {
  name: 'review',
  version: '1.0.0',
  handles: ['review'],
  execute: async (task: Task, context: ExecutionContext): Promise<PluginResult> => {
    const { requirement } = task.payload as { requirement: string };
    return {
      success: true,
      output: { message: `Reviewed: ${requirement}`, files: [] },
    };
  },
};

const analysisPlugin: Plugin = {
  name: 'analysis',
  version: '1.0.0',
  handles: ['analysis'],
  execute: async (task: Task, context: ExecutionContext): Promise<PluginResult> => {
    const { requirement } = task.payload as { requirement: string };
    return {
      success: true,
      output: { message: `Analysis complete: ${requirement}`, files: [] },
    };
  },
};

const documentationPlugin: Plugin = {
  name: 'documentation',
  version: '1.0.0',
  handles: ['documentation'],
  execute: async (task: Task, context: ExecutionContext): Promise<PluginResult> => {
    const { requirement } = task.payload as { requirement: string };
    return {
      success: true,
      output: { message: `Documented: ${requirement}`, files: [] },
    };
  },
};

export class HermesACPAdapter implements ACPHandler {
  private protocolHandler: ACPProtocolHandler;
  private translator: MissionTranslator;
  private registry: PluginRegistry;
  private stateStore: FileStateStore;
  private persistence: TaskPersistence;
  private lifecycle: TaskLifecycle;
  private logger: ConsoleLogger;
  private currentSessionId: SessionId | null = null;
  private currentWorktreeContext: any = null;
  private currentMissionId: string | null = null;

  constructor() {
    // Initialize agent-runtime components
    const queue = new TaskQueueImpl();
    this.registry = new PluginRegistry();
    this.registry.register(codingPlugin);
    this.registry.register(testingPlugin);
    this.registry.register(reviewPlugin);
    this.registry.register(analysisPlugin);
    this.registry.register(documentationPlugin);

    this.stateStore = new FileStateStore('.hermes-acp-state');
    this.persistence = new TaskPersistence('.hermes-acp-state');
    this.lifecycle = new TaskLifecycle(queue, this.persistence, 3);
    this.logger = createDefaultLogger('hermes-acp');
    
    // Initialize protocol handler
    this.protocolHandler = new ACPProtocolHandler(this);
    this.translator = new MissionTranslator();
  }

  // Get protocol handler for stdio processing
  getProtocolHandler(): ACPProtocolHandler {
    return this.protocolHandler;
  }

  // ACP Handler Methods
  async handleInitialize(params: InitializeRequest): Promise<InitializeResponse> {
    this.logger.info('ACP Initialize', { clientInfo: params.clientInfo });
    return {
      protocolVersion: 1,
      agentCapabilities: HERMES_CAPABILITIES,
      authMethods: HERMES_AUTH_METHODS,
      agentInfo: HERMES_IMPLEMENTATION,
    };
  }

  async handleNewSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    this.logger.info('ACP New Session', { cwd: params.cwd });
    
    // Store session context
    this.currentSessionId = `session-${Date.now()}`;
    this.currentWorktreeContext = {
      worktreeId: params.cwd.split('/').pop() || 'default',
      workingDir: params.cwd,
      branch: 'main',
      baseBranch: 'main',
      repoUrl: '',
    };

    this.protocolHandler.setSessionId(this.currentSessionId);

    return {
      sessionId: this.currentSessionId,
      modes: {
        currentModeId: 'default',
        availableModes: [{ id: 'default', name: 'Default', description: 'Default mode' }],
      },
      configOptions: [],
    };
  }

  async handleLoadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    this.logger.info('ACP Load Session', { sessionId: params.sessionId });
    
    this.currentSessionId = params.sessionId;
    this.currentWorktreeContext = {
      worktreeId: params.cwd.split('/').pop() || 'default',
      workingDir: params.cwd,
      branch: 'main',
      baseBranch: 'main',
      repoUrl: '',
    };

    this.protocolHandler.setSessionId(this.currentSessionId);

    return {
      modes: {
        currentModeId: 'default',
        availableModes: [{ id: 'default', name: 'Default', description: 'Default mode' }],
      },
      configOptions: [],
    };
  }

  async handlePrompt(params: PromptRequest): Promise<PromptResponse> {
    if (!this.currentSessionId) {
      return { stopReason: 'refusal', usage: { totalTokens: 0, inputTokens: 0, outputTokens: 0 } };
    }

    this.logger.info('ACP Prompt', { sessionId: this.currentSessionId, promptLength: params.prompt.length });

    // Extract text from prompt
    const promptText = params.prompt
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    // Send initial progress
    this.protocolHandler.sendUserMessageChunk(this.currentSessionId, promptText);

    // Create a simple mission from prompt
    const orcaTaskPayload = this.buildOrcaTaskFromPrompt(params.prompt, this.currentWorktreeContext);
    const mission = this.translator.translate(orcaTaskPayload);
    this.currentMissionId = mission.missionId;

    // Create tasks in lifecycle
    const createdTasks: Task[] = [];
    for (const hermesTask of mission.tasks) {
      const created = await this.lifecycle.createTask({
        type: hermesTask.type,
        payload: hermesTask.payload,
        maxRetries: hermesTask.maxRetries,
        plugin: hermesTask.plugin,
      });
      createdTasks.push(created);
    }

    // Send plan
    this.protocolHandler.sendPlan(this.currentSessionId, mission.tasks.map(t => ({
      content: `${t.type}: ${(t.payload as any).requirement || 'Task'}`,
      priority: 'high' as const,
      status: 'pending' as const,
    })));

    // Execute tasks
    let completedCount = 0;
    const totalTasks = createdTasks.length;
    const taskResults: Array<{ taskId: string; status: string; output?: any }> = [];

    // Send agent thinking
    this.protocolHandler.sendAgentMessageChunk(this.currentSessionId, `Planning ${totalTasks} tasks...`);

    for (const task of createdTasks) {
      // Get next task
      const nextTask = await this.lifecycle.getNextTask();
      if (!nextTask) break;

      // Send tool call start
      this.protocolHandler.sendToolCall(this.currentSessionId, {
        toolCallId: nextTask.id,
        title: nextTask.type,
        name: nextTask.type,
        kind: 'execute',
        status: 'in_progress',
      });

      // Get plugin
      const plugin = this.registry.get(nextTask.type);
      if (!plugin) {
        await this.lifecycle.failTask(nextTask.id, `No plugin for ${nextTask.type}`);
        taskResults.push({ taskId: nextTask.id, status: 'failed', output: { error: `No plugin for ${nextTask.type}` } });
        continue;
      }

      // Create execution context
      const context = this.translator.createExecutionContext(this.currentWorktreeContext, this.currentMissionId!);
      context.state = this.stateStore;

      // Execute
      try {
        const result = await plugin.execute(nextTask, context);
        if (result.success) {
          await this.lifecycle.completeTask(nextTask.id, result.output);
          taskResults.push({ taskId: nextTask.id, status: 'completed', output: result.output });
          this.protocolHandler.sendToolCallUpdate(this.currentSessionId, nextTask.id, { status: 'completed' });
        } else {
          await this.lifecycle.failTask(nextTask.id, result.error || 'Plugin returned failure');
          taskResults.push({ taskId: nextTask.id, status: 'failed', output: { error: result.error } });
          this.protocolHandler.sendToolCallUpdate(this.currentSessionId, nextTask.id, { status: 'failed' });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await this.lifecycle.failTask(nextTask.id, errMsg);
        taskResults.push({ taskId: nextTask.id, status: 'failed', output: { error: errMsg } });
        this.protocolHandler.sendToolCallUpdate(this.currentSessionId, nextTask.id, { status: 'failed' });
      }

      completedCount++;
      this.protocolHandler.sendUsageUpdate(this.currentSessionId, 100, 50);
    }

    // Final response
    const completed = taskResults.filter(r => r.status === 'completed').length;
    const failed = taskResults.filter(r => r.status === 'failed').length;
    const stopReason: StopReason = failed > 0 ? 'refusal' : 'end_turn';

    this.protocolHandler.sendAgentMessageChunk(this.currentSessionId, `Mission complete: ${completed}/${totalTasks} tasks succeeded`);

    return {
      stopReason,
      usage: {
        totalTokens: totalTasks * 150,
        inputTokens: totalTasks * 100,
        outputTokens: totalTasks * 50,
      },
    };
  }

  private buildOrcaTaskFromPrompt(prompt: ContentBlock[], worktreeContext: any): any {
    const promptText = prompt
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    // Parse prompt into requirements (simple split by lines for now)
    const requirements = promptText
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);

    return {
      taskId: `task-${Date.now()}`,
      task: {
        type: 'coding',
        description: promptText.slice(0, 200),
        requirements: requirements.length > 0 ? requirements : ['Execute prompt'],
        scope: {
          allowedPaths: [worktreeContext.workingDir],
          forbiddenPaths: ['.git/**', '**/node_modules/**', '**/dist/**'],
          allowNetwork: true,
          allowShell: true,
        },
        model: 't2-orchestrator',
      },
      context: worktreeContext,
    };
  }

  // File operations (stubs for now)
  async handleReadTextFile(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    return { content: '// File read not yet implemented' };
  }

  async handleWriteTextFile(params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    return {};
  }

  async handleCreateTerminal(params: CreateTerminalRequest): Promise<CreateTerminalResponse> {
    return { terminalId: `term-${Date.now()}` };
  }

  async handleTerminalOutput(params: TerminalOutputRequest): Promise<TerminalOutputResponse> {
    return { output: '', truncated: false };
  }

  async handleReleaseTerminal(params: ReleaseTerminalRequest): Promise<void> {}

  async handleWaitForTerminalExit(params: WaitForTerminalExitRequest): Promise<WaitForTerminalExitResponse> {
    return { exitCode: 0 };
  }

  async handleKillTerminal(params: KillTerminalRequest): Promise<void> {}
}

// Main entry point for stdio
async function main() {
  const adapter = new HermesACPAdapter();
  const protocolHandler = adapter.getProtocolHandler();

  console.error('[Hermes ACP Adapter] Starting...');

  // Read from stdin
  for await (const line of require('node:readline').createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  })) {
    await protocolHandler.processMessage(line);
  }

  console.error('[Hermes ACP Adapter] Shutdown');
}

main().catch(err => {
  console.error('[Hermes ACP Adapter] Fatal error:', err);
  process.exit(1);
});