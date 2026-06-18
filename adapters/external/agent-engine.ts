/**
 * Agent Engine — real ReAct loop in TypeScript.
 * 
 * This is the actual working engine that:
 * 1. Sends prompt + tools to LLM
 * 2. Parses tool calls from response
 * 3. Executes tools
 * 4. Feeds results back to LLM
 * 5. Repeats until LLM gives final answer
 * 
 * Works standalone without Rust core.
 */

import { LlmProvider, type LlmMessage, type LlmTool, type LlmProviderConfig } from './llm-provider.js';
import type { AgentEnginePort, StreamChunk, SessionStats, AgentState } from '../../domain/ports/agent-engine.js';
import { executeTool, getToolDefinitions } from '../tools/tool-executor.js';

export interface AgentEngineConfig extends LlmProviderConfig {
  /** Maximum iterations before forced stop. */
  maxIterations?: number;
  /** System prompt (persona). */
  systemPrompt?: string;
  /** Enable verbose logging. */
  verbose?: boolean;
}

export class AgentEngine implements AgentEnginePort {
  private llm: LlmProvider;
  private config: AgentEngineConfig;
  private messages: LlmMessage[] = [];
  private tools: LlmTool[] = [];
  private stats: SessionStats = { totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0, requestCount: 0 };
  private state: AgentState = 'idle';
  private agentId: string = '';

  constructor(config: AgentEngineConfig) {
    this.config = {
      maxIterations: 10,
      verbose: false,
      ...config,
    };
    this.llm = new LlmProvider(config);
    this.tools = getToolDefinitions();
  }

  async initialize(id: string, description: string, prompt: string): Promise<string> {
    this.agentId = id;
    this.messages = [];
    this.stats = { totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0, requestCount: 0 };
    this.state = 'idle';

    // Set system prompt
    const systemContent = prompt || this.config.systemPrompt || 'You are a helpful AI assistant.';
    this.messages.push({ role: 'system', content: systemContent });

    return `Agent '${id}' initialized with ${this.tools.length} tools`;
  }

  /**
   * Run agent — full ReAct loop.
   */
  async run(prompt: string): Promise<string> {
    this.messages.push({ role: 'user', content: prompt });
    this.state = 'thinking';

    for (let iteration = 0; iteration < (this.config.maxIterations || 10); iteration++) {
      if (this.config.verbose) {
        process.stderr.write(`\n[Iteration ${iteration + 1}] Thinking...\n`);
      }

      // Call LLM
      this.state = 'thinking';
      const response = await this.llm.complete(this.messages, this.tools);
      this.stats.requestCount++;
      this.stats.totalInputTokens += response.usage.inputTokens;
      this.stats.totalOutputTokens += response.usage.outputTokens;

      // Track cost (rough estimate: $3/M input, $15/M output for Claude Sonnet)
      this.stats.totalCostUsd += (response.usage.inputTokens * 3 / 1_000_000)
        + (response.usage.outputTokens * 15 / 1_000_000);

      // If LLM returned text only (no tool calls) — final answer
      if (!response.toolCalls || response.toolCalls.length === 0) {
        const finalAnswer = response.content || '';
        this.messages.push({ role: 'assistant', content: finalAnswer });
        this.state = 'idle';
        return finalAnswer;
      }

      // LLM wants to call tools
      // Add assistant message with tool_calls (OpenAI native format)
      this.messages.push({
        role: 'assistant',
        content: response.content || null,
        tool_calls: response.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: tc.arguments,
          },
        })),
      });

      // Execute each tool call
      for (const toolCall of response.toolCalls) {
        this.state = 'calling_tool';
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

        // Add tool result to messages
        this.messages.push({
          role: 'tool',
          content: toolResult,
          tool_call_id: toolCall.id,
        });
      }

      this.state = 'observing';
    }

    this.state = 'idle';
    return 'Maximum iterations reached without a final answer.';
  }

  /**
   * Run with streaming — yields chunks as they arrive.
   */
  async *runStreaming(prompt: string): AsyncGenerator<StreamChunk> {
    this.messages.push({ role: 'user', content: prompt });
    this.state = 'thinking';

    for (let iteration = 0; iteration < (this.config.maxIterations || 10); iteration++) {
      yield { type: 'thinking', content: `Iteration ${iteration + 1}` };

      let fullContent = '';
      let toolCallsAccumulated: Array<{ id: string; name: string; arguments: string }> = [];
      let currentToolCall: { id: string; name: string; arguments: string } | null = null;

      // Stream LLM response
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

      this.stats.requestCount++;
      // Estimate tokens from text length (rough)
      const estInput = Math.floor(this.messages.reduce((sum, m) => sum + (m.content?.length || 0), 0) / 4);
      const estOutput = Math.floor(fullContent.length / 4);
      this.stats.totalInputTokens += estInput;
      this.stats.totalOutputTokens += estOutput;

      // If no tool calls — final answer
      if (toolCallsAccumulated.length === 0) {
        this.messages.push({ role: 'assistant', content: fullContent });
        yield { type: 'done', content: fullContent };
        this.state = 'idle';
        return;
      }

      // Add assistant message with tool_calls (OpenAI native format)
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
        yield { type: 'tool_call', content: `${toolCall.name}(...)` };

        let toolResult: string;
        try {
          const args = JSON.parse(toolCall.arguments);
          toolResult = await executeTool(toolCall.name, args);
        } catch (err: any) {
          toolResult = `Error: ${err.message}`;
        }

        // Truncate very long tool results
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

    yield { type: 'error', content: 'Maximum iterations reached' };
    this.state = 'idle';
  }

  async getState(): Promise<AgentState> { return this.state; }
  async getStats(): Promise<SessionStats> { return { ...this.stats }; }
  async setBudget(maxTokens: number, budgetUsd: number): Promise<void> {
    // Store for future budget checks
  }
}
