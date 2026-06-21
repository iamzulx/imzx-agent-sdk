/**
 * Anthropic SDK Adapter — wraps @anthropic-ai/sdk for type-safe integration.
 * [v0.8.0] Replaces custom fetch with official SDK when available.
 *
 * Falls back to custom fetch (existing LlmProvider) if SDK is not installed.
 *
 * Usage:
 *   const adapter = new AnthropicSdkAdapter();
 *   if (adapter.isAvailable()) {
 *     const response = await adapter.complete(messages, tools);
 *   }
 */

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | Array<{ type: string; [key: string]: unknown }>;
}

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AnthropicResponse {
  content: string | null;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  usage: { inputTokens: number; outputTokens: number };
  stopReason?: string;
}

export class AnthropicSdkAdapter {
  private client: any = null;
  private available: boolean = false;

  /** Check if @anthropic-ai/sdk is installed and initialize client. */
  async initialize(): Promise<boolean> {
    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      this.client = new Anthropic();
      this.available = true;
      return true;
    } catch {
      this.available = false;
      return false;
    }
  }

  isAvailable(): boolean {
    return this.available && this.client !== null;
  }

  /**
   * Non-streaming completion using the official SDK.
   */
  async complete(
    messages: AnthropicMessage[],
    tools?: AnthropicTool[],
    options?: { model?: string; maxTokens?: number; temperature?: number; systemPrompt?: string }
  ): Promise<AnthropicResponse> {
    if (!this.client) throw new Error('AnthropicSdkAdapter not initialized. Call initialize() first.');

    const params: Record<string, unknown> = {
      model: options?.model || process.env.IMZX_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: options?.maxTokens || 4096,
      messages,
    };

    if (options?.temperature !== undefined) params.temperature = options.temperature;
    if (options?.systemPrompt) params.system = options.systemPrompt;
    if (tools && tools.length > 0) params.tools = tools;

    const response = await this.client.messages.create(params);

    const textBlock = response.content.find((b: any) => b.type === 'text');
    const toolBlocks = response.content.filter((b: any) => b.type === 'tool_use');

    return {
      content: textBlock?.text ?? null,
      toolCalls: toolBlocks.length > 0
        ? toolBlocks.map((b: any) => ({
            id: b.id,
            name: b.name,
            arguments: JSON.stringify(b.input),
          }))
        : undefined,
      usage: {
        inputTokens: response.usage?.input_tokens || 0,
        outputTokens: response.usage?.output_tokens || 0,
      },
      stopReason: response.stop_reason,
    };
  }

  /**
   * Streaming completion using the official SDK.
   * Yields text deltas and tool use events in real-time.
   */
  async *stream(
    messages: AnthropicMessage[],
    tools?: AnthropicTool[],
    options?: { model?: string; maxTokens?: number; systemPrompt?: string }
  ): AsyncGenerator<{ type: string; content: string; toolCallId?: string; toolName?: string }> {
    if (!this.client) throw new Error('AnthropicSdkAdapter not initialized.');

    const params: Record<string, unknown> = {
      model: options?.model || 'claude-sonnet-4-20250514',
      max_tokens: options?.maxTokens || 4096,
      messages,
      stream: true,
    };

    if (options?.systemPrompt) params.system = options.systemPrompt;
    if (tools && tools.length > 0) params.tools = tools;

    const stream = await this.client.messages.create(params);

    const toolBuffers = new Map<number, { id: string; name: string; rawJson: string }>();

    for await (const event of stream) {
      switch (event.type) {
        case 'content_block_start':
          if (event.content_block?.type === 'tool_use') {
            toolBuffers.set(event.index, {
              id: event.content_block.id,
              name: event.content_block.name,
              rawJson: '',
            });
            yield { type: 'tool_call_start', content: event.content_block.name, toolCallId: event.content_block.id, toolName: event.content_block.name };
          }
          break;

        case 'content_block_delta':
          if (event.delta?.type === 'text_delta') {
            yield { type: 'text', content: event.delta.text };
          } else if (event.delta?.type === 'input_json_delta') {
            const tb = toolBuffers.get(event.index);
            if (tb) {
              tb.rawJson += event.delta.partial_json;
              yield { type: 'tool_call_args', content: event.delta.partial_json, toolCallId: tb.id };
            }
          }
          break;

        case 'content_block_stop':
          if (toolBuffers.has(event.index)) {
            const tb = toolBuffers.get(event.index)!;
            yield { type: 'tool_call_end', content: tb.rawJson, toolCallId: tb.id, toolName: tb.name };
            toolBuffers.delete(event.index);
          }
          break;
      }
    }

    yield { type: 'done', content: '' };
  }
}
