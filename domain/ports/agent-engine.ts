/**
 * Port interface for interacting with the LLM/Agent engine.
 * v2.0 — Added streaming, hooks, subagents, budget management.
 */

/** Chunk of a streamed response. */
export interface StreamChunk {
  type: 'text' | 'tool_call' | 'tool_result' | 'thinking' | 'usage' | 'done' | 'error';
  content: string;
  metadata?: Record<string, unknown>;
}

/** Hook event types matching Rust core. */
export type HookEventType =
  | 'agent_start'
  | 'pre_tool_use'
  | 'post_tool_use'
  | 'agent_end'
  | 'on_iteration'
  | 'on_error'
  | 'on_budget_warning';

export interface HookEvent {
  type: HookEventType;
  data: Record<string, unknown>;
}

/** Session statistics. */
export interface SessionStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  requestCount: number;
}

/** Agent state. */
export type AgentState =
  | 'idle'
  | 'planning'
  | 'thinking'
  | 'calling_tool'
  | 'observing'
  | 'reviewing'
  | 'responding'
  | 'error';

/**
 * Core agent engine port — the contract between domain and infrastructure.
 */
export interface AgentEnginePort {
  /** Initialize agent with persona. */
  initialize(id: string, description: string, prompt: string): Promise<string>;

  /** Run agent synchronously — returns full response. */
  run(prompt: string): Promise<string>;

  /** Run agent with streaming — yields chunks as they arrive. */
  runStreaming?(prompt: string): AsyncIterable<StreamChunk>;

  /** Get current agent state. */
  getState?(): Promise<AgentState>;

  /** Get session statistics. */
  getStats?(): Promise<SessionStats>;

  /** Set budget limits. */
  setBudget?(maxTokens: number, budgetUsd: number): Promise<void>;

  /** Register a hook callback. */
  registerHook?(eventType: HookEventType, callback: (event: HookEvent) => void): void;
}
