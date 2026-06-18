/**
 * LLM Provider — real OpenAI-compatible API client.
 * Supports: OpenRouter, Anthropic, OpenAI, local servers, any /v1/chat/completions.
 */

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export interface LlmTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmResponse {
  content: string | null;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface LlmStreamChunk {
  type: 'text' | 'tool_call_start' | 'tool_call_args' | 'tool_call_end' | 'done';
  content: string;
  toolCallId?: string;
  toolName?: string;
}

export interface LlmProviderConfig {
  /** API endpoint (e.g., https://openrouter.ai/api/v1/chat/completions) */
  baseUrl: string;
  /** API key */
  apiKey: string;
  /** Model name (e.g., anthropic/claude-sonnet-4) */
  model: string;
  /** Max tokens for response */
  maxTokens?: number;
  /** Temperature (0-1) */
  temperature?: number;
}

export class LlmProvider {
  private config: LlmProviderConfig;

  constructor(config: LlmProviderConfig) {
    this.config = {
      maxTokens: 4096,
      temperature: 0.7,
      ...config,
    };
  }

  /**
   * Synchronous completion — returns full response.
   */
  async complete(messages: LlmMessage[], tools?: LlmTool[]): Promise<LlmResponse> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const response = await fetch(this.config.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
        'HTTP-Referer': 'https://github.com/iamzulx/imzx-agent-sdk',
        'X-Title': 'imzx-agent-sdk',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      const hint = response.status === 401
        ? ' — Check your API key in .env (OPENROUTER_API_KEY or ANTHROPIC_API_KEY)'
        : response.status === 429
        ? ' — Rate limited. Wait a moment and try again.'
        : response.status === 500
        ? ' — Server error. The API provider may be experiencing issues.'
        : '';
      throw new Error(`LLM API error ${response.status}${hint}: ${errorText.substring(0, 200)}`);
    }

    const data = await response.json() as any;
    const choice = data.choices?.[0];

    if (!choice) {
      throw new Error('LLM returned no choices');
    }

    const message = choice.message;
    const toolCalls = message.tool_calls?.map((tc: any) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    })) || [];

    return {
      content: message.content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
      },
    };
  }

  /**
   * Streaming completion — yields chunks as they arrive.
   */
  async *stream(messages: LlmMessage[], tools?: LlmTool[]): AsyncGenerator<LlmStreamChunk> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      stream: true,
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const response = await fetch(this.config.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
        'HTTP-Referer': 'https://github.com/iamzulx/imzx-agent-sdk',
        'X-Title': 'imzx-agent-sdk',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`LLM API error ${response.status}${response.status === 401 ? " — Check API key in .env" : ""}: ${errorText.substring(0, 200)}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let currentToolCall: { id: string; name: string; args: string } | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') {
          yield { type: 'done', content: '' };
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          if (!delta) continue;

          // Text content
          if (delta.content) {
            yield { type: 'text', content: delta.content };
          }

          // Tool calls
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc.function?.name) {
                // New tool call starting
                if (currentToolCall) {
                  yield { type: 'tool_call_end', content: currentToolCall.args, toolCallId: currentToolCall.id, toolName: currentToolCall.name };
                }
                currentToolCall = { id: tc.id || `call_${Date.now()}`, name: tc.function.name, args: '' };
                yield { type: 'tool_call_start', content: tc.function.name, toolCallId: currentToolCall.id, toolName: tc.function.name };
              }
              if (tc.function?.arguments) {
                currentToolCall!.args += tc.function.arguments;
                yield { type: 'tool_call_args', content: tc.function.arguments, toolCallId: currentToolCall!.id };
              }
            }
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }

    // Flush remaining tool call
    if (currentToolCall) {
      yield { type: 'tool_call_end', content: currentToolCall.args, toolCallId: currentToolCall.id, toolName: currentToolCall.name };
    }
    yield { type: 'done', content: '' };
  }
}
