// ACP Protocol Types - Based on Orca ACP schema-v1.21.0

// JSON-RPC 2.0
export interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: JSONRPCError;
}

export interface JSONRPCNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}

// Initialize
export interface InitializeRequest {
  protocolVersion: number;
  clientCapabilities?: ClientCapabilities;
  clientInfo?: Implementation;
}

export interface InitializeResponse {
  protocolVersion: number;
  agentCapabilities?: AgentCapabilities;
  authMethods?: AuthMethod[];
  agentInfo?: Implementation;
}

export interface ClientCapabilities {
  fs?: { readTextFile?: boolean; writeTextFile?: boolean };
  terminal?: boolean;
  session?: ClientSessionCapabilities;
  plan?: Record<string, unknown>;
  auth?: { terminal?: boolean };
  elicitation?: { form?: Record<string, unknown>; url?: Record<string, unknown> };
  nes?: ClientNesCapabilities;
  positionEncodings?: PositionEncodingKind[];
}

export interface ClientSessionCapabilities {
  compaction?: Record<string, unknown>;
  configOptions?: Record<string, unknown>;
}

export interface ClientNesCapabilities {
  jump?: Record<string, unknown>;
  rename?: Record<string, unknown>;
  searchAndReplace?: Record<string, unknown>;
}

export type PositionEncodingKind = 'utf-16' | 'utf-32' | 'utf-8';

export interface AgentCapabilities {
  loadSession?: boolean;
  promptCapabilities?: PromptCapabilities;
  mcpCapabilities?: MCPCapabilities;
  sessionCapabilities?: SessionCapabilities;
  auth?: AgentAuthCapabilities;
  providers?: Record<string, unknown>;
  nes?: NesCapabilities;
  positionEncoding?: PositionEncodingKind;
}

export interface PromptCapabilities {
  image?: boolean;
  audio?: boolean;
  embeddedContext?: boolean;
}

export interface MCPCapabilities {
  http?: boolean;
  sse?: boolean;
  acp?: boolean;
}

export interface SessionCapabilities {
  list?: Record<string, unknown>;
  delete?: Record<string, unknown>;
  additionalDirectories?: Record<string, unknown>;
  fork?: Record<string, unknown>;
  resume?: Record<string, unknown>;
  close?: Record<string, unknown>;
}

export interface AgentAuthCapabilities {
  logout?: Record<string, unknown>;
}

export interface NesCapabilities {
  events?: NesEventCapabilities;
  context?: NesContextCapabilities;
}

export interface NesEventCapabilities {
  document?: NesDocumentEventCapabilities;
}

export interface NesDocumentEventCapabilities {
  didOpen?: Record<string, unknown>;
  didChange?: Record<string, unknown>;
  didClose?: Record<string, unknown>;
  didSave?: Record<string, unknown>;
  didFocus?: Record<string, unknown>;
}

export interface NesContextCapabilities {
  recentFiles?: { maxCount?: number };
  relatedSnippets?: Record<string, unknown>;
  editHistory?: { maxCount?: number };
  userActions?: { maxCount?: number };
  openFiles?: Record<string, unknown>;
  diagnostics?: Record<string, unknown>;
}

export interface Implementation {
  name: string;
  title?: string;
  version: string;
}

export interface AuthMethodTerminal {
  type: 'terminal';
  id: string;
  name: string;
  description?: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface AuthMethodAgent {
  type: 'agent';
  id: string;
  name: string;
  description?: string;
}

export type AuthMethod = AuthMethodTerminal | AuthMethodAgent;

// Session Management
export interface NewSessionRequest {
  cwd: string;
  additionalDirectories?: string[];
  mcpServers: MCPServer[];
}

export interface NewSessionResponse {
  sessionId: string;
  modes?: SessionModeState;
  configOptions?: SessionConfigOption[];
}

export interface LoadSessionRequest {
  mcpServers: MCPServer[];
  cwd: string;
  additionalDirectories?: string[];
  sessionId: string;
}

export interface LoadSessionResponse {
  modes?: SessionModeState;
  configOptions?: SessionConfigOption[];
}

export interface ResumeSessionRequest {
  sessionId: string;
  cwd: string;
  additionalDirectories?: string[];
  mcpServers?: MCPServer[];
}

export interface ResumeSessionResponse {
  modes?: SessionModeState;
  configOptions?: SessionConfigOption[];
}

export type SessionId = string;

export interface MCPServerHttp {
  type: 'http';
  name: string;
  url: string;
  headers: HttpHeader[];
}

export interface MCPServerSSE {
  type: 'sse';
  name: string;
  url: string;
  headers: HttpHeader[];
}

export interface MCPServerACP {
  type: 'acp';
  name: string;
  serverId: string;
}

export interface MCPServerStdio {
  type: 'stdio';
  name: string;
  command: string;
  args: string[];
  env: EnvVariable[];
}

export type MCPServer = MCPServerHttp | MCPServerSSE | MCPServerACP | MCPServerStdio;

export interface HttpHeader {
  name: string;
  value: string;
}

export interface EnvVariable {
  name: string;
  value: string;
}

export interface SessionMode {
  id: string;
  name: string;
  description?: string;
}

export interface SessionModeState {
  currentModeId: string;
  availableModes: SessionMode[];
}

export interface SessionConfigOptionCategory {
  type: 'select' | 'boolean';
  currentValue: string | boolean;
  options?: SessionConfigSelectOption[] | SessionConfigSelectGroup[];
}

export interface SessionConfigSelectOption {
  value: string;
  name: string;
  description?: string;
}

export interface SessionConfigSelectGroup {
  group: string;
  name: string;
  options: SessionConfigSelectOption[];
}

export type SessionConfigOption = SessionConfigOptionCategory;

// Prompt/Execution
export interface PromptRequest {
  sessionId: string;
  prompt: ContentBlock[];
}

export interface PromptResponse {
  stopReason: StopReason;
  usage?: Usage;
}

export type StopReason = 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled';

export interface Usage {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  thoughtTokens?: number;
  cachedReadTokens?: number;
  cachedWriteTokens?: number;
}

export interface ContentBlock {
  type: 'text' | 'image' | 'audio' | 'resource_link' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
  uri?: string;
  annotations?: Annotations;
}

export interface Annotations {
  audience?: Role[];
  lastModified?: string;
  priority?: number;
}

export type Role = 'assistant' | 'user';

// Session Updates (Notifications)
export interface SessionNotification {
  sessionId: string;
  update: SessionUpdate;
}

export type SessionUpdate =
  | { sessionUpdate: 'user_message_chunk'; content: ContentChunk }
  | { sessionUpdate: 'agent_message_chunk'; content: ContentChunk }
  | { sessionUpdate: 'agent_thought_chunk'; content: ContentChunk }
  | { sessionUpdate: 'tool_call'; toolCall: ToolCall }
  | { sessionUpdate: 'tool_call_update'; toolCallUpdate: ToolCallUpdate }
  | { sessionUpdate: 'plan'; plan: Plan }
  | { sessionUpdate: 'plan_update'; planUpdate: PlanUpdate }
  | { sessionUpdate: 'plan_removed'; planRemoved: PlanRemoved }
  | { sessionUpdate: 'available_commands_update'; availableCommandsUpdate: AvailableCommandsUpdate }
  | { sessionUpdate: 'current_mode_update'; currentModeUpdate: CurrentModeUpdate }
  | { sessionUpdate: 'config_option_update'; configOptionUpdate: ConfigOptionUpdate }
  | { sessionUpdate: 'session_info_update'; sessionInfoUpdate: SessionInfoUpdate }
  | { sessionUpdate: 'usage_update'; usageUpdate: UsageUpdate }
  | { sessionUpdate: 'compaction_update'; compactionUpdate: CompactionUpdate }
  | { sessionUpdate: 'compaction_summary_chunk'; compactionSummaryChunk: CompactionSummaryChunk };

export interface ContentChunk {
  content: ContentBlock;
  messageId?: string;
}

export interface ToolCall {
  toolCallId: string;
  title: string;
  name?: string;
  kind?: ToolKind;
  status?: ToolCallStatus;
  content?: ToolCallContent[];
  locations?: ToolCallLocation[];
  rawInput?: unknown;
  rawOutput?: unknown;
}

export interface ToolCallUpdate {
  toolCallId: string;
  kind?: ToolKind;
  status?: ToolCallStatus;
  title?: string;
  name?: string;
  content?: ToolCallContent[];
  locations?: ToolCallLocation[];
  rawInput?: unknown;
  rawOutput?: unknown;
}

export type ToolKind = 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'switch_mode' | 'other';

export type ToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface ToolCallContent {
  type: 'content' | 'diff' | 'terminal';
  content?: { annotations?: Annotations; text: string };
  diff?: { path: string; oldText?: string; newText: string };
  terminal?: { terminalId: string };
}

export interface ToolCallLocation {
  path: string;
  line?: number;
}

export interface Plan {
  entries: PlanEntry[];
}

export interface PlanEntry {
  content: string;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'completed';
}

export interface PlanUpdate {
  plan: { type: 'items'; planId: string; entries: PlanEntry[] } | { type: 'file'; planId: string; uri: string } | { type: 'markdown'; planId: string; content: string };
}

export interface PlanRemoved {
  planId: string;
}

export interface AvailableCommandsUpdate {
  availableCommands: AvailableCommand[];
}

export interface AvailableCommand {
  name: string;
  description: string;
  input?: { hint: string };
}

export interface CurrentModeUpdate {
  currentModeId: string;
}

export interface ConfigOptionUpdate {
  configOptions: SessionConfigOption[];
}

export interface SessionInfoUpdate {
  title?: string;
  updatedAt?: string;
}

export interface UsageUpdate {
  used: number;
  size: number;
  cost?: { amount: number; currency: string };
}

export interface CompactionUpdate {
  compactionId: string;
  status: 'in_progress' | 'completed' | 'failed' | 'cancelled';
  summary?: ContentBlock[];
  error?: string;
}

export interface CompactionSummaryChunk {
  compactionId: string;
  content: ContentBlock;
}

// File Operations
export interface ReadTextFileRequest {
  sessionId: string;
  path: string;
  line?: number;
  limit?: number;
}

export interface ReadTextFileResponse {
  content: string;
}

export interface WriteTextFileRequest {
  sessionId: string;
  path: string;
  content: string;
}

export interface WriteTextFileResponse {}

// Terminal
export interface CreateTerminalRequest {
  sessionId: string;
  command: string;
  args?: string[];
  env?: EnvVariable[];
  cwd?: string;
  outputByteLimit?: number;
}

export interface CreateTerminalResponse {
  terminalId: string;
}

export interface TerminalOutputRequest {
  sessionId: string;
  terminalId: string;
}

export interface TerminalOutputResponse {
  output: string;
  truncated: boolean;
  exitStatus?: { exitCode?: number; signal?: string };
}

export interface ReleaseTerminalRequest {
  sessionId: string;
  terminalId: string;
}

export interface WaitForTerminalExitRequest {
  sessionId: string;
  terminalId: string;
}

export interface WaitForTerminalExitResponse {
  exitCode?: number;
  signal?: string;
}

export interface KillTerminalRequest {
  sessionId: string;
  terminalId: string;
}

// Hermes-specific types for mission translation
export interface OrcaTaskPayload {
  taskId: string;
  task: {
    type: string;
    description: string;
    requirements: string[];
    scope: TaskScope;
    model?: string;
    config?: {
      maxRetries?: number;
      timeout?: number;
    };
  };
  context: WorktreeContext;
}

export interface WorktreeContext {
  worktreeId: string;
  workingDir: string;
  branch: string;
  baseBranch: string;
  repoUrl: string;
}

export interface TaskScope {
  allowedPaths: string[];
  forbiddenPaths: string[];
  allowNetwork: boolean;
  allowShell: boolean;
}