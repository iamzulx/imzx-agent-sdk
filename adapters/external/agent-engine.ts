/**
 * Agent Engine — real ReAct loop in TypeScript.
 * v0.4.0 — Phase 1 complete: function calling, budget, cost, memory, retry, persona.
 *
 * Features:
 * - OpenAI native function calling format
 * - Budget enforcement (token + USD limits)
 * - Real cost tracking from API usage
 * - Conversation memory (persists across calls)
 * - Error recovery (exponential backoff retry)
 * - Proper persona/system prompt injection
 */

import { LlmProvider, type LlmMessage, type LlmTool, type LlmProviderConfig } from './llm-provider.js';
import type { AgentEnginePort, StreamChunk, SessionStats, AgentState } from '../../domain/ports/agent-engine.js';
import { executeTool, getToolDefinitions } from '../tools/tool-executor.js';
import { buildSystemPrompt } from '../tools/prompts.js';
import { AgentBrain } from '../memory/agent-brain.js';
import type { TelemetryCollector } from '../tools/telemetry.js';
import type { CheckpointManager } from '../memory/conversation-checkpoint.js';

export interface AgentEngineConfig extends LlmProviderConfig {
  maxIterations?: number;
  systemPrompt?: string;
  verbose?: boolean;
  /** Max tokens per session (default: 500,000) */
  maxTokens?: number;
  /** Max cost per session in USD (default: 5.00) */
  budgetUsd?: number;
  /** Retry attempts on LLM API failure (default: 3) */
  retryAttempts?: number;
}

// --- Cost rates per 1M tokens (common models) ---
const COST_RATES: Record<string, { input: number; output: number }> = {
  'anthropic/claude-sonnet-4': { input: 3, output: 15 },
  'anthropic/claude-opus-4': { input: 15, output: 75 },
  'openai/gpt-4o': { input: 2.5, output: 10 },
  'openai/gpt-4o-mini': { input: 0.15, output: 0.6 },
  'openai/gpt-4-turbo': { input: 10, output: 30 },
  'meta-llama/Llama-3.3-70B': { input: 0.88, output: 0.88 },
  'google/gemini-2.5-pro': { input: 1.25, output: 10 },
  'mistralai/mistral-large': { input: 2, output: 6 },
  'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },  // Groq
  'default': { input: 3, output: 15 },
};

export class AgentEngine implements AgentEnginePort {
  private llm: LlmProvider;
  private config: AgentEngineConfig & { maxIterations: number; verbose: boolean; systemPrompt: string; maxTokens: number; budgetUsd: number; retryAttempts: number };
  private messages: LlmMessage[] = [];
  private tools: LlmTool[] = [];
  private stats: SessionStats = { totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0, requestCount: 0 };
  private state: AgentState = 'idle';
  private agentId: string = '';
  private personaPrompt: string = '';
  /** Self-improving brain — memory, reflection, skills, self-modification. */
  public brain: AgentBrain;
  private telemetry: TelemetryCollector | null = null;
  private checkpointMgr: CheckpointManager | null = null;
  // [C7 FIX] Plugin manager for pre/post LLM hooks
  private pluginManager: import('../tools/plugin-system.js').PluginManager | null = null;

  constructor(config: AgentEngineConfig) {
    this.config = {
      maxIterations: 10,
      verbose: false,
      systemPrompt: 'You are a helpful AI assistant. You have access to tools — use them when needed.',
      maxTokens: 500_000,
      budgetUsd: 5.0,
      retryAttempts: 3,
      ...config,
    };
    this.llm = new LlmProvider(config);
    this.tools = getToolDefinitions();
    this.brain = new AgentBrain();
    // Lazy-init telemetry and checkpoint (dynamic imports to avoid hard deps)
    // [C4 FIX] Log init errors instead of silently swallowing
    this.initOptionalModules().catch((err) => {
      console.warn(`[agent-engine] Optional module init warning: ${err?.message || err}`);
    });
  }

  private async initOptionalModules(): Promise<void> {
    try {
      const { TelemetryCollector } = await import('../tools/telemetry.js');
      this.telemetry = new TelemetryCollector();
    } catch { /* optional */ }
    try {
      const { CheckpointManager } = await import('../memory/conversation-checkpoint.js');
      this.checkpointMgr = new CheckpointManager();
    } catch { /* optional */ }
    // [C7 FIX] Initialize plugin manager for pre/post LLM hooks
    try {
      const { PluginManager } = await import('../tools/plugin-system.js');
      this.pluginManager = new PluginManager();
    } catch { /* optional */ }
  }

  async initialize(id: string, description: string, prompt: string): Promise<string> {
    this.agentId = id;
    this.personaPrompt = prompt || this.config.systemPrompt;

    // [1.4] DON'T clear messages — keep conversation history
    if (this.messages.length === 0) {
      // [S1] Use engineered system prompt with tool guidance
      this.messages = [{ role: 'system', content: buildSystemPrompt(this.personaPrompt) }];
    }

    this.state = 'idle';
    return `Agent '${id}' initialized with ${this.tools.length} tools`;
  }

  // --- [1.4] Conversation memory ---

  /** Get conversation history. */
  getHistory(): LlmMessage[] {
    return [...this.messages];
  }

  /** Clear conversation history and start fresh. */
  clearHistory(): void {
    this.messages = [{ role: 'system', content: buildSystemPrompt(this.personaPrompt) }];
    this.stats = { totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0, requestCount: 0 };
  }

  /** Get number of messages in history (excluding system). */
  getHistoryLength(): number {
    return Math.max(0, this.messages.length - 1);
  }

  // --- [1.2] Budget enforcement ---

  private checkBudget(): void {
    const totalTokens = this.stats.totalInputTokens + this.stats.totalOutputTokens;
    if (totalTokens >= this.config.maxTokens) {
      throw new Error(
        `Budget exceeded: ${totalTokens.toLocaleString()} tokens used (limit: ${this.config.maxTokens.toLocaleString()}). Halting.`
      );
    }
    if (this.stats.totalCostUsd >= this.config.budgetUsd) {
      throw new Error(
        `Budget exceeded: $${this.stats.totalCostUsd.toFixed(4)} spent (limit: $${this.config.budgetUsd.toFixed(2)}). Halting.`
      );
    }
  }

  /** Warn if approaching budget (80% threshold). */
  private budgetWarning(): string | null {
    const totalTokens = this.stats.totalInputTokens + this.stats.totalOutputTokens;
    const tokenPct = totalTokens / this.config.maxTokens;
    const costPct = this.stats.totalCostUsd / this.config.budgetUsd;
    if (tokenPct >= 0.8 || costPct >= 0.8) {
      return `Budget warning: ${Math.round(tokenPct * 100)}% tokens, ${Math.round(costPct * 100)}% cost used`;
    }
    return null;
  }

  // --- [1.3] Real cost tracking ---

  private trackCost(inputTokens: number, outputTokens: number): void {
    this.stats.totalInputTokens += inputTokens;
    this.stats.totalOutputTokens += outputTokens;
    this.stats.requestCount++;

    const modelKey = Object.keys(COST_RATES).find(k => this.config.model.includes(k)) || 'default';
    const rate = COST_RATES[modelKey];
    this.stats.totalCostUsd += (inputTokens * rate.input / 1_000_000)
      + (outputTokens * rate.output / 1_000_000);
  }

  // --- [1.5] Error recovery ---

  private async withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        lastError = err;
        const isRetryable = err.message?.includes('429') || err.message?.includes('500')
          || err.message?.includes('timeout') || err.message?.includes('ECONNRESET')
          || err.message?.includes('fetch failed');

        if (!isRetryable || attempt === this.config.retryAttempts) {
          throw new Error(`${label} failed after ${attempt} attempts: ${err.message}`);
        }

        const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
        if (this.config.verbose) {
          process.stderr.write(`  [Retry ${attempt}/${this.config.retryAttempts}] ${label}: ${err.message} — waiting ${delay}ms\n`);
        }
        await new Promise(r => setTimeout(r, delay));
      }
    }
    throw lastError!;
  }

  // --- Main ReAct loop ---

  async run(prompt: string): Promise<string> {
    // [Brain] Process user message for learning signals
    this.brain.processUserMessage(prompt);
    this.brain.onTaskStart();

    this.messages.push({ role: 'user', content: prompt });
    this.state = 'thinking';

    // [Brain] Enhance system prompt with memory, reflections, skills
    const enhancedSystem = this.brain.buildEnhancedPrompt(
      this.messages[0]?.content || '',
      prompt
    );
    if (this.messages[0]?.role === 'system') {
      this.messages[0].content = enhancedSystem;
    }

    for (let iteration = 0; iteration < this.config.maxIterations; iteration++) {
      if (this.config.verbose) {
        process.stderr.write(`\n[Iteration ${iteration + 1}] Thinking...\n`);
      }

      // [S2] Check budget before each iteration
      this.checkBudget();

      // [S3] Compact context if needed
      this.compactIfNeeded();

      // Call LLM with retry
      this.state = 'thinking';

      // [C7 FIX] Run pre_llm_call plugin hook — allows plugins to modify messages before LLM call
      let hookMessages = [...this.messages];
      if (this.pluginManager) {
        try {
          const preCtx = await this.pluginManager.runHook('pre_llm_call', {
            hook: 'pre_llm_call',
            messages: hookMessages,
          });
          if (preCtx.messages) hookMessages = preCtx.messages as LlmMessage[];
        } catch { /* hook errors don't block LLM call */ }
      }

      const response = await this.withRetry(
        () => this.llm.complete(hookMessages, this.tools),
        'LLM call'
      );

      // [C7 FIX] Run post_llm_call plugin hook — allows plugins to inspect/modify response
      if (this.pluginManager) {
        try {
          await this.pluginManager.runHook('post_llm_call', {
            hook: 'post_llm_call',
            messages: hookMessages,
            response: { content: response.content, toolCalls: response.toolCalls },
          });
        } catch { /* hook errors don't block response */ }
      }

      // [1.3] Track real cost
      this.trackCost(response.usage.inputTokens, response.usage.outputTokens);

      // Telemetry: record LLM call span
      try {
        if (this.telemetry) {
          this.telemetry.startTrace();
          this.telemetry.recordLlmCall({
            model: this.config.model,
            provider: 'openrouter',
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
            latencyMs: 0,
            estimatedCostUsd: this.stats.totalCostUsd,
            success: true,
          });
        }
      } catch { /* optional */ }

      // If LLM returned text only (no tool calls) — final answer
      if (!response.toolCalls || response.toolCalls.length === 0) {
        const finalAnswer = response.content || '';
        this.messages.push({ role: 'assistant', content: finalAnswer });
        this.state = 'idle';
        await this.brain.onTaskEnd(prompt, finalAnswer, 'success'); // [Brain] task done
        return finalAnswer;
      }

      // Add assistant message with tool_calls (OpenAI native format)
      this.messages.push({
        role: 'assistant',
        content: response.content || null,
        tool_calls: response.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });

      // Execute each tool call
      for (const toolCall of response.toolCalls) {
        this.state = 'calling_tool';
        this.brain.onToolUse(toolCall.name); // [Brain] track tool use
        if (this.config.verbose) {
          process.stderr.write(`  [Tool] ${toolCall.name}(${toolCall.arguments.substring(0, 100)})\n`);
        }

        let toolResult: string;
        try {
          const args = JSON.parse(toolCall.arguments);
          toolResult = await executeTool(toolCall.name, args);
        } catch (err: any) {
          toolResult = `Error: ${err.message}`;
        }

        // Telemetry: record tool call span
        try {
          if (this.telemetry) {
            this.telemetry.recordToolCall({
              name: toolCall.name,
              durationMs: 0,
              success: !toolResult.startsWith('Error:'),
              error: toolResult.startsWith('Error:') ? toolResult : undefined,
            });
          }
        } catch { /* optional */ }

        // Truncate long results
        if (toolResult.length > 50000) {
          toolResult = toolResult.substring(0, 50000) + '\n... (truncated)';
        }

        this.messages.push({
          role: 'tool',
          content: toolResult,
          tool_call_id: toolCall.id,
        });
      }

      this.state = 'observing';
    }

    this.state = 'idle';
    // Auto-checkpoint
    try {
      if (this.checkpointMgr) {
        this.checkpointMgr.maybeAutoCheckpoint(this.messages, {
          inputTokens: this.stats.totalInputTokens,
          outputTokens: this.stats.totalOutputTokens,
          costUsd: this.stats.totalCostUsd,
          requests: this.stats.requestCount,
        });
      }
    } catch { /* optional */ }
    await this.brain.onTaskEnd(prompt, 'Maximum iterations reached', 'failure'); // [Brain] task failed
    return 'Maximum iterations reached without a final answer.';
  }

  // --- Streaming ---

  async *runStreaming(prompt: string): AsyncGenerator<StreamChunk> {
    // [Brain] Process user message for learning signals (mirrors run())
    this.brain.processUserMessage(prompt);
    this.brain.onTaskStart();

    this.messages.push({ role: 'user', content: prompt });
    this.state = 'thinking';

    // [Brain] Enhance system prompt with memory, reflections, skills
    const enhancedSystem = this.brain.buildEnhancedPrompt(
      this.messages[0]?.content || '',
      prompt
    );
    if (this.messages[0]?.role === 'system') {
      this.messages[0].content = enhancedSystem;
    }

    for (let iteration = 0; iteration < this.config.maxIterations; iteration++) {
      yield { type: 'thinking', content: `Iteration ${iteration + 1}` };

      // [1.2] Budget check
      try {
        this.checkBudget();
      } catch (err: any) {
        yield { type: 'error', content: err.message };
        this.state = 'idle';
        return;
      }

      // Budget warning
      const warning = this.budgetWarning();
      if (warning) {
        yield { type: 'thinking', content: warning };
      }

      let fullContent = '';
      let toolCallsAccumulated: Array<{ id: string; name: string; arguments: string }> = [];
      let currentToolCall: { id: string; name: string; arguments: string } | null = null;

      // Stream LLM response (retry not applicable to generators — catch errors)
      try {
        for await (const chunk of this.llm.stream(this.messages, this.tools)) {
          if (chunk.type === 'text') {
            fullContent += chunk.content;
            yield { type: 'text', content: chunk.content };
          } else if (chunk.type === 'tool_call_start') {
            currentToolCall = { id: chunk.toolCallId || '', name: chunk.content, arguments: '' };
            yield { type: 'tool_call', content: chunk.content };
          } else if (chunk.type === 'tool_call_args' && currentToolCall) {
            currentToolCall.arguments += chunk.content;
          } else if (chunk.type === 'tool_call_end' && currentToolCall) {
            currentToolCall.arguments = chunk.content || currentToolCall.arguments;
            toolCallsAccumulated.push(currentToolCall);
            currentToolCall = null;
          }
        }
      } catch (err: any) {
        yield { type: 'error', content: err.message };
        this.state = 'idle';
        return;
      }

      // [1.3] Estimate cost for streaming (API doesn't return usage in stream)
      // [C6 FIX] Better token estimation — chars/3.75 is more accurate for mixed English/code
      const totalMsgChars = this.messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
      const estInput = Math.ceil(totalMsgChars / 3.75);
      const estOutput = Math.ceil(fullContent.length / 3.75);
      this.trackCost(estInput, estOutput);

      // If no tool calls — final answer
      if (toolCallsAccumulated.length === 0) {
        this.messages.push({ role: 'assistant', content: fullContent });
        this.state = 'idle';
        await this.brain.onTaskEnd(prompt, fullContent, 'success'); // [Brain] task done
        yield { type: 'done', content: fullContent };
        return;
      }

      // Add assistant message with tool_calls
      this.messages.push({
        role: 'assistant',
        content: fullContent || null,
        tool_calls: toolCallsAccumulated.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });

      // Execute tools
      for (const toolCall of toolCallsAccumulated) {
        this.state = 'calling_tool';
        this.brain.onToolUse(toolCall.name); // [Brain] track tool use
        yield { type: 'tool_call', content: `${toolCall.name}(...)` };

        let toolResult: string;
        try {
          const args = JSON.parse(toolCall.arguments);
          toolResult = await executeTool(toolCall.name, args);
        } catch (err: any) {
          toolResult = `Error: ${err.message}`;
        }

        const truncated = toolResult.length > 10000
          ? toolResult.substring(0, 10000) + '\n... (truncated)'
          : toolResult;

        this.messages.push({
          role: 'tool',
          content: truncated,
          tool_call_id: toolCall.id,
        });

        yield { type: 'tool_result', content: `✓ ${toolCall.name}` };
      }
    }

    await this.brain.onTaskEnd(prompt, 'Maximum iterations reached', 'failure'); // [Brain] task failed
    yield { type: 'error', content: 'Maximum iterations reached' };
    this.state = 'idle';
  }

  // --- [S3] Context window management ---

  /** Check if context is getting too large and compact if needed. */
  private compactIfNeeded(): void {
    const totalChars = this.messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
    const estimatedTokens = Math.ceil(totalChars / 3.75); // [C6 FIX] Better ratio
    const maxContextTokens = 100_000; // Conservative limit for most models

    if (estimatedTokens > maxContextTokens * 0.8) {
      // Keep: system prompt (first), last 6 messages (recent context)
      // Remove: middle messages (old context)
      const system = this.messages[0];
      const recent = this.messages.slice(-6);
      const removed = this.messages.length - 1 - recent.length;

      if (removed > 0) {
        const removedChars = this.messages.slice(1, -6).reduce((sum, m) => sum + (m.content?.length || 0), 0);
        const summary = `[Context compacted: ${removed} messages (~${Math.floor(removedChars / 4)} tokens) removed to stay within context window]`;
        this.messages = [system, { role: 'system', content: summary }, ...recent];
      }
    }
  }

  // --- Port interface ---

  async getState(): Promise<AgentState> { return this.state; }
  async getStats(): Promise<SessionStats> { return { ...this.stats }; }

  async setBudget(maxTokens: number, budgetUsd: number): Promise<void> {
    this.config.maxTokens = maxTokens;
    this.config.budgetUsd = budgetUsd;
  }

  // --- [3.3] State save/restore ---

  /** Serialize agent state to JSON string. */
  saveState(): string {
    return JSON.stringify({
      agentId: this.agentId,
      personaPrompt: this.personaPrompt,
      messages: this.messages,
      stats: this.stats,
      model: this.config.model,
      maxTokens: this.config.maxTokens,
      budgetUsd: this.config.budgetUsd,
      savedAt: new Date().toISOString(),
    }, null, 2);
  }

  /** Restore agent state from JSON string. */
  /** [H3 FIX] Validates state before loading — prevents deserialization attacks. */
  loadState(json: string): void {
    let state: any;
    try { state = JSON.parse(json); } catch { throw new Error('Invalid state JSON'); }
    if (typeof state !== 'object' || state === null) throw new Error('State must be an object');
    this.agentId = typeof state.agentId === 'string' ? state.agentId : '';
    this.personaPrompt = typeof state.personaPrompt === 'string' ? state.personaPrompt : '';
    this.messages = Array.isArray(state.messages) ? state.messages : [];
    this.stats = {
      totalInputTokens: typeof state.stats?.totalInputTokens === 'number' ? state.stats.totalInputTokens : 0,
      totalOutputTokens: typeof state.stats?.totalOutputTokens === 'number' ? state.stats.totalOutputTokens : 0,
      totalCostUsd: typeof state.stats?.totalCostUsd === 'number' ? state.stats.totalCostUsd : 0,
      requestCount: typeof state.stats?.requestCount === 'number' ? state.stats.requestCount : 0,
    };
    if (typeof state.maxTokens === 'number' && state.maxTokens > 0 && state.maxTokens <= 10_000_000) this.config.maxTokens = state.maxTokens;
    if (typeof state.budgetUsd === 'number' && state.budgetUsd > 0 && state.budgetUsd <= 1000) this.config.budgetUsd = state.budgetUsd;
  }

  /** Save state to file. */
  async saveStateToFile(filePath: string): Promise<void> {
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, this.saveState(), 'utf-8');
  }

  /** Load state from file. */
  async loadStateFromFile(filePath: string): Promise<void> {
    const { readFile } = await import('node:fs/promises');
    const data = await readFile(filePath, 'utf-8');
    this.loadState(data);
  }
}
