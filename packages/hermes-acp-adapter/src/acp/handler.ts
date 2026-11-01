// ACP Protocol Handler - stdio JSON-RPC 2.0

import {
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCNotification,
  JSONRPCError,
  InitializeRequest,
  InitializeResponse,
  NewSessionRequest,
  NewSessionResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  PromptRequest,
  PromptResponse,
  SessionNotification,
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
  AgentCapabilities,
  Implementation,
  AuthMethod,
  SessionId,
  ContentBlock,
  StopReason,
  Usage,
  SessionUpdate,
} from './types';

export interface ACPHandler {
  handleInitialize(params: InitializeRequest): Promise<InitializeResponse>;
  handleNewSession(params: NewSessionRequest): Promise<NewSessionResponse>;
  handleLoadSession(params: LoadSessionRequest): Promise<LoadSessionResponse>;
  handlePrompt(params: PromptRequest): Promise<PromptResponse>;
  handleReadTextFile(params: ReadTextFileRequest): Promise<ReadTextFileResponse>;
  handleWriteTextFile(params: WriteTextFileRequest): Promise<WriteTextFileResponse>;
  handleCreateTerminal(params: CreateTerminalRequest): Promise<CreateTerminalResponse>;
  handleTerminalOutput(params: TerminalOutputRequest): Promise<TerminalOutputResponse>;
  handleReleaseTerminal(params: ReleaseTerminalRequest): Promise<void>;
  handleWaitForTerminalExit(params: WaitForTerminalExitRequest): Promise<WaitForTerminalExitResponse>;
  handleKillTerminal(params: KillTerminalRequest): Promise<void>;
}

export class ACPProtocolHandler {
  private handler: ACPHandler;
  private requestId = 0;
  private pendingRequests = new Map<number | string, (response: JSONRPCResponse) => void>();
  private sessionId: SessionId | null = null;

  constructor(handler: ACPHandler) {
    this.handler = handler;
  }

  // Main entry point - process incoming JSON-RPC message
  async processMessage(line: string): Promise<void> {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const message = JSON.parse(trimmed);
      
      if ('method' in message && 'id' in message) {
        // Request
        await this.handleRequest(message as JSONRPCRequest);
      } else if ('method' in message && !('id' in message)) {
        // Notification (no response expected)
        await this.handleNotification(message as JSONRPCNotification);
      } else if ('result' in message || 'error' in message) {
        // Response to our request
        this.handleResponse(message as JSONRPCResponse);
      }
    } catch (error) {
      console.error('[ACP] Failed to parse message:', error, 'Line:', line);
    }
  }

  private async handleRequest(request: JSONRPCRequest): Promise<void> {
    const { id, method, params } = request;
    let result: unknown;
    let error: JSONRPCResponse['error'];

    try {
      switch (method) {
        case 'initialize':
          result = await this.handler.handleInitialize(params as InitializeRequest);
          break;
        case 'session/new':
          result = await this.handler.handleNewSession(params as NewSessionRequest);
          break;
        case 'session/load':
          result = await this.handler.handleLoadSession(params as LoadSessionRequest);
          break;
        case 'session/prompt':
          result = await this.handler.handlePrompt(params as PromptRequest);
          break;
        case 'session/readTextFile':
          result = await this.handler.handleReadTextFile(params as ReadTextFileRequest);
          break;
        case 'session/writeTextFile':
          result = await this.handler.handleWriteTextFile(params as WriteTextFileRequest);
          break;
        case 'session/createTerminal':
          result = await this.handler.handleCreateTerminal(params as CreateTerminalRequest);
          break;
        case 'session/terminalOutput':
          result = await this.handler.handleTerminalOutput(params as TerminalOutputRequest);
          break;
        case 'session/releaseTerminal':
          await this.handler.handleReleaseTerminal(params as ReleaseTerminalRequest);
          result = {};
          break;
        case 'session/waitForTerminalExit':
          result = await this.handler.handleWaitForTerminalExit(params as WaitForTerminalExitRequest);
          break;
        case 'session/killTerminal':
          await this.handler.handleKillTerminal(params as KillTerminalRequest);
          result = {};
          break;
        case 'session/setMode':
        case 'session/setModel':
        case 'session/setConfigOption':
        case 'authenticate':
        case 'cancel':
          error = { code: -32601, message: `Method ${method} not implemented` };
          break;
        default:
          error = { code: -32601, message: `Method ${method} not found` };
      }
    } catch (err) {
      error = { code: -32603, message: err instanceof Error ? err.message : 'Internal error' };
    }

    this.sendResponse(id, result, error);
  }

  private async handleNotification(notification: JSONRPCNotification): Promise<void> {
    const { method, params } = notification;
    // Notifications don't have responses
    console.log('[ACP] Notification:', method);
  }

  private handleResponse(response: JSONRPCResponse): void {
    const { id, result, error } = response;
    if (id === null || id === undefined) return;
    const resolver = this.pendingRequests.get(id);
    if (resolver) {
      this.pendingRequests.delete(id);
      resolver(response);
    }
  }

  private sendResponse(id: number | string | null, result?: unknown, error?: JSONRPCError): void {
    if (id === null || id === undefined) return; // Notification, no response

    const response: JSONRPCResponse = {
      jsonrpc: '2.0',
      id,
      ...(error ? { error } : { result }),
    };
    this.write(JSON.stringify(response));
  }

  // Send notification to client (Orca)
  sendNotification(method: string, params: unknown): void {
    const notification: JSONRPCNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };
    this.write(JSON.stringify(notification));
  }

  // Convenience: send session update
  sendSessionUpdate(sessionId: SessionId, update: SessionUpdate): void {
    this.sendNotification('session/update', { sessionId, update });
  }

  // Send user message chunk
  sendUserMessageChunk(sessionId: SessionId, text: string, messageId?: string): void {
    this.sendSessionUpdate(sessionId, {
      sessionUpdate: 'user_message_chunk',
      content: { content: { type: 'text', text }, messageId },
    });
  }

  // Send agent message chunk
  sendAgentMessageChunk(sessionId: SessionId, text: string, messageId?: string): void {
    this.sendSessionUpdate(sessionId, {
      sessionUpdate: 'agent_message_chunk',
      content: { content: { type: 'text', text }, messageId },
    });
  }

  // Send tool call
  sendToolCall(sessionId: SessionId, toolCall: {
    toolCallId: string;
    title: string;
    name?: string;
    kind?: 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'switch_mode' | 'other';
    status?: 'pending' | 'in_progress' | 'completed' | 'failed';
    content?: Array<{ type: 'content' | 'diff' | 'terminal'; content?: { text: string }; diff?: { path: string; oldText?: string; newText: string }; terminal?: { terminalId: string } }>;
    locations?: Array<{ path: string; line?: number }>;
  }): void {
    this.sendSessionUpdate(sessionId, {
      sessionUpdate: 'tool_call',
      toolCall: toolCall as any,
    });
  }

  // Send tool call update
  sendToolCallUpdate(sessionId: SessionId, toolCallId: string, update: Partial<{
    kind: 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'switch_mode' | 'other';
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    title: string;
    name: string;
  }>): void {
    this.sendSessionUpdate(sessionId, {
      sessionUpdate: 'tool_call_update',
      toolCallUpdate: { toolCallId, ...update } as any,
    });
  }

  // Send plan
  sendPlan(sessionId: SessionId, entries: Array<{ content: string; priority: 'high' | 'medium' | 'low'; status: 'pending' | 'in_progress' | 'completed' }>): void {
    this.sendSessionUpdate(sessionId, {
      sessionUpdate: 'plan',
      plan: { entries },
    });
  }

  // Send usage update
  sendUsageUpdate(sessionId: SessionId, used: number, size: number, cost?: { amount: number; currency: string }): void {
    this.sendSessionUpdate(sessionId, {
      sessionUpdate: 'usage_update',
      usageUpdate: { used, size, cost },
    });
  }

  private write(data: string): void {
    // Use process.stdout.write for stdio communication
    const stdout = require('process').stdout;
    stdout.write(data + '\n');
  }

  // Get next request ID for outgoing requests
  nextRequestId(): number {
    return ++this.requestId;
  }

  // Make outgoing request and wait for response
  async request<T>(method: string, params: unknown): Promise<T> {
    const id = this.nextRequestId();
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, (response) => {
        if (response.error) {
          reject(new Error(response.error.message));
        } else {
          resolve(response.result as T);
        }
      });
      this.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  setSessionId(sessionId: SessionId): void {
    this.sessionId = sessionId;
  }

  getSessionId(): SessionId | null {
    return this.sessionId;
  }
}

// Default capabilities for Hermes
export const HERMES_CAPABILITIES: AgentCapabilities = {
  loadSession: true,
  promptCapabilities: {
    image: false,
    audio: false,
    embeddedContext: true,
  },
  mcpCapabilities: {
    http: false,
    sse: false,
    acp: true,
  },
  sessionCapabilities: {
    list: {},
    delete: {},
    additionalDirectories: {},
    fork: {},
    resume: {},
    close: {},
  },
  auth: { logout: {} },
  providers: {},
  nes: {
    events: {
      document: {
        didOpen: {},
        didChange: {},
        didClose: {},
        didSave: {},
        didFocus: {},
      },
    },
    context: {
      recentFiles: { maxCount: 100 },
      relatedSnippets: {},
      editHistory: { maxCount: 100 },
      userActions: { maxCount: 100 },
      openFiles: {},
      diagnostics: {},
    },
  },
  positionEncoding: 'utf-8',
};

export const HERMES_IMPLEMENTATION: Implementation = {
  name: 'hermes',
  title: 'Hermes Agent',
  version: '0.1.0',
};

export const HERMES_AUTH_METHODS: AuthMethod[] = [
  {
    type: 'agent',
    id: 'hermes-default',
    name: 'Hermes Default',
    description: 'Hermes built-in authentication via LiteLLM proxy',
  },
];