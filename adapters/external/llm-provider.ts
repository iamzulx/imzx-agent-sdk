/**
 * LLM Provider — multi-provider API client.
 * Supports: OpenRouter, Anthropic native, Google Gemini, Ollama, OpenAI-compatible.
 * v0.6.0: Added Anthropic/Gemini/Ollama native support, auto-detection, model routing.
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

export type LlmProviderType = 'openai-compatible' | 'anthropic' | 'google' | 'ollama';

export interface LlmProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  providerType?: LlmProviderType;
  maxTokens?: number;
  temperature?: number;
  routing?: {
    simpleModel?: string;
    complexModel?: string;
    costThreshold?: number;
  };
}

/** Auto-detect provider from API key prefix or base URL. */
function detectProviderType(apiKey: string, baseUrl: string): LlmProviderType {
  if (apiKey.startsWith('sk-ant-')) return 'anthropic';
  if (apiKey.startsWith('AIza')) return 'google';
  if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1') || baseUrl.includes('11434')) return 'ollama';
  if (baseUrl.includes('anthropic.com')) return 'anthropic';
  if (baseUrl.includes('generativelanguage.googleapis.com')) return 'google';
  return 'openai-compatible';
}

export class LlmProvider {
  private config: LlmProviderConfig;
  private providerType: LlmProviderType;

  /** Auto-detect provider from environment variables. */
  static fromEnv(): LlmProviderConfig {
    // Anthropic native
    if (process.env.ANTHROPIC_API_KEY && !process.env.IMZX_LLM_BASE_URL && !process.env.OPENROUTER_API_KEY) {
      const model = process.env.IMZX_MODEL || 'claude-sonnet-4-20250514';
      return {
        baseUrl: 'https://api.anthropic.com/v1/messages',
        apiKey: process.env.ANTHROPIC_API_KEY,
        model,
        providerType: 'anthropic',
      };
    }

    // Google Gemini
    if (process.env.GOOGLE_API_KEY) {
      const model = process.env.IMZX_MODEL || 'gemini-2.0-flash';
      return {
        baseUrl: `https://generativelanguage.googleapis.com/v1beta/models/${model}`,
        apiKey: process.env.GOOGLE_API_KEY,
        model,
        providerType: 'google',
      };
    }

    // Ollama local
    if (process.env.OLLAMA_HOST || process.env.IMZX_LOCAL_MODEL) {
      const model = process.env.IMZX_LOCAL_MODEL || 'llama3.2';
      return {
        baseUrl: process.env.OLLAMA_HOST || 'http://localhost:11434',
        apiKey: 'ollama',
        model,
        providerType: 'ollama',
      };
    }

    const baseUrl = process.env.IMZX_LLM_BASE_URL
      || (process.env.OPENAI_API_KEY ? 'https://api.openai.com/v1/chat/completions' : null)
      || (process.env.GROQ_API_KEY ? 'https://api.groq.com/openai/v1/chat/completions' : null)
      || (process.env.TOGETHER_API_KEY ? 'https://api.together.xyz/v1/chat/completions' : null)
      || 'https://openrouter.ai/api/v1/chat/completions';

    const apiKey = process.env.IMZX_API_KEY
      || process.env.OPENAI_API_KEY
      || process.env.OPENROUTER_API_KEY
      || process.env.ANTHROPIC_API_KEY
      || process.env.GROQ_API_KEY
      || process.env.TOGETHER_API_KEY
      || '';

    const model = process.env.IMZX_MODEL
      || (process.env.GROQ_API_KEY ? 'llama-3.3-70b-versatile' : null)
      || (process.env.TOGETHER_API_KEY ? 'meta-llama/Llama-3.3-70B-Instruct-Turbo' : null)
      || (process.env.OPENAI_API_KEY ? 'gpt-4o' : null)
      || 'anthropic/claude-sonnet-4';

    return { baseUrl, apiKey, model };
  }

  constructor(config: LlmProviderConfig) {
    this.config = {
      maxTokens: 4096,
      temperature: 0.7,
      ...config,
    };
    this.providerType = config.providerType || detectProviderType(config.apiKey, config.baseUrl);
  }

  /** Route to appropriate model based on task complexity. */
  selectModel(taskComplexity: 'simple' | 'complex'): string {
    if (!this.config.routing) return this.config.model;
    return taskComplexity === 'complex'
      ? (this.config.routing.complexModel || this.config.model)
      : (this.config.routing.simpleModel || this.config.model);
  }

  /**
   * Synchronous completion — routes to provider-specific implementation.
   */
  async complete(messages: LlmMessage[], tools?: LlmTool[]): Promise<LlmResponse> {
    switch (this.providerType) {
      case 'anthropic':
        return this.completeAnthropic(messages, tools);
      case 'google':
        return this.completeGoogle(messages, tools);
      case 'ollama':
        return this.completeOllama(messages, tools);
      default:
        return this.completeOpenAI(messages, tools);
    }
  }

  /**
   * Streaming completion — yields chunks as they arrive.
   */
  async *stream(messages: LlmMessage[], tools?: LlmTool[]): AsyncGenerator<LlmStreamChunk> {
    if (this.providerType === 'anthropic') {
      yield* this.streamAnthropic(messages, tools);
      return;
    }
    yield* this.streamOpenAI(messages, tools);
  }

  // --- Anthropic Native API ---

  private async completeAnthropic(messages: LlmMessage[], tools?: LlmTool[]): Promise<LlmResponse> {
    const systemMsg = messages.find(m => m.role === 'system');
    const nonSystem = messages.filter(m => m.role !== 'system');

    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      messages: nonSystem.map(m => {
        // [C13 FIX] Use proper Anthropic tool_result content block format
        if (m.role === 'tool') {
          return {
            role: 'user' as const,
            content: [{
              type: 'tool_result',
              tool_use_id: m.tool_call_id || 'unknown',
              content: m.content || '',
            }],
          };
        }
        return { role: m.role, content: m.content };
      }),
    };

    if (systemMsg) body.system = systemMsg.content;

    if (tools && tools.length > 0) {
      body.tools = tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    }

    const response = await fetch(this.config.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => 'Unknown');
      throw new Error(`Anthropic API error ${response.status}: ${err.substring(0, 200)}`);
    }

    const data = await response.json() as any;
    const content = data.content?.find((b: any) => b.type === 'text')?.text ?? null;
    const toolCalls = data.content?.filter((b: any) => b.type === 'tool_use').map((b: any) => ({
      id: b.id,
      name: b.name,
      arguments: JSON.stringify(b.input),
    })) ?? [];

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        inputTokens: data.usage?.input_tokens || 0,
        outputTokens: data.usage?.output_tokens || 0,
      },
    };
  }

  private async *streamAnthropic(messages: LlmMessage[], tools?: LlmTool[]): AsyncGenerator<LlmStreamChunk> {
    // Anthropic streaming uses SSE similar to OpenAI but with different events
    // For simplicity, fall back to non-streaming then yield
    const response = await this.completeAnthropic(messages, tools);
    if (response.content) yield { type: 'text', content: response.content };
    if (response.toolCalls) {
      for (const tc of response.toolCalls) {
        yield { type: 'tool_call_start', content: tc.name, toolCallId: tc.id, toolName: tc.name };
        yield { type: 'tool_call_args', content: tc.arguments, toolCallId: tc.id };
        yield { type: 'tool_call_end', content: tc.arguments, toolCallId: tc.id, toolName: tc.name };
      }
    }
    yield { type: 'done', content: '' };
  }

  // --- Google Gemini API ---

  private async completeGoogle(messages: LlmMessage[], tools?: LlmTool[]): Promise<LlmResponse> {
    const contents = messages.filter(m => m.role !== 'system').map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: this.config.maxTokens,
        temperature: this.config.temperature,
      },
    };

    // [GT FIX] Pass tools to Google Gemini API (function calling support)
    if (tools && tools.length > 0) {
      body.tools = [{
        functionDeclarations: tools.map(t => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      }];
    }

    const systemMsg = messages.find(m => m.role === 'system');
    if (systemMsg) {
      body.systemInstruction = { parts: [{ text: systemMsg.content }] };
    }

    // [S2 FIX] API key in header instead of URL — prevents exposure in server/proxy logs
    const url = `${this.config.baseUrl}:generateContent`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.config.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => 'Unknown');
      throw new Error(`Google API error ${response.status}: ${err.substring(0, 200)}`);
    }

    const data = await response.json() as any;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
    const usage = data.usageMetadata || {};

    return {
      content: text,
      usage: {
        inputTokens: usage.promptTokenCount || 0,
        outputTokens: usage.candidatesTokenCount || 0,
      },
    };
  }

  // --- Ollama Local API ---

  private async completeOllama(messages: LlmMessage[], tools?: LlmTool[]): Promise<LlmResponse> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: false,
      options: {
        num_predict: this.config.maxTokens,
        temperature: this.config.temperature,
      },
    };

    // [GT FIX] Pass tools to Ollama API (function calling for compatible models)
    if (tools && tools.length > 0) {
      body.tools = tools.map(t => ({
        type: 'function',
        function: {
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        },
      }));
    }

    const response = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => 'Unknown');
      throw new Error(`Ollama error ${response.status}: ${err.substring(0, 200)}`);
    }

    const data = await response.json() as any;
    return {
      content: data.message?.content ?? null,
      usage: {
        inputTokens: data.prompt_eval_count || 0,
        outputTokens: data.eval_count || 0,
      },
    };
  }

  // --- OpenAI-Compatible (OpenRouter, OpenAI, Groq, Together) ---

  private async completeOpenAI(messages: LlmMessage[], tools?: LlmTool[]): Promise<LlmResponse> {
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
        ? ' — Check your API key in .env'
        : response.status === 429
        ? ' — Rate limited. Wait a moment and try again.'
        : response.status === 500
        ? ' — Server error.'
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

  private async *streamOpenAI(messages: LlmMessage[], tools?: LlmTool[]): AsyncGenerator<LlmStreamChunk> {
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
      throw new Error(`LLM API error ${response.status}: ${errorText.substring(0, 200)}`);
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

          if (delta.content) {
            yield { type: 'text', content: delta.content };
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc.function?.name) {
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

    if (currentToolCall) {
      yield { type: 'tool_call_end', content: currentToolCall.args, toolCallId: currentToolCall.id, toolName: currentToolCall.name };
    }
    yield { type: 'done', content: '' };
  }
}
