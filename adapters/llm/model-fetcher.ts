/**
 * Model Fetcher — auto-fetch available models from OpenAI-compatible /v1/models endpoint.
 * Supports: OpenAI, Groq, Together, OpenRouter, Ollama, custom endpoints.
 */

export interface ModelInfo {
  id: string;
  owned_by: string;
  context_length?: number;
  pricing?: { input: number; output: number };
  capabilities?: string[];
}

export interface ProviderModels {
  provider: string;
  baseUrl: string;
  models: ModelInfo[];
  fetched_at: string;
  default_model: string;
}

// Known provider defaults (fallback when /v1/models not available)
const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; models: ModelInfo[]; default: string }> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-4o', owned_by: 'openai', context_length: 128000, capabilities: ['text', 'vision'] },
      { id: 'gpt-4o-mini', owned_by: 'openai', context_length: 128000, capabilities: ['text'] },
      { id: 'gpt-4-turbo', owned_by: 'openai', context_length: 128000, capabilities: ['text', 'vision'] },
      { id: 'o1', owned_by: 'openai', context_length: 200000, capabilities: ['reasoning'] },
      { id: 'o1-mini', owned_by: 'openai', context_length: 128000, capabilities: ['reasoning'] },
      { id: 'gpt-3.5-turbo', owned_by: 'openai', context_length: 16385, capabilities: ['text'] },
    ],
    default: 'gpt-4o',
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    models: [
      { id: 'llama-3.3-70b-versatile', owned_by: 'meta', context_length: 128000 },
      { id: 'llama-3.1-8b-instant', owned_by: 'meta', context_length: 128000 },
      { id: 'mixtral-8x7b-32768', owned_by: 'mistral', context_length: 32768 },
      { id: 'gemma2-9b-it', owned_by: 'google', context_length: 8192 },
    ],
    default: 'llama-3.3-70b-versatile',
  },
  together: {
    baseUrl: 'https://api.together.xyz/v1',
    models: [
      { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', owned_by: 'meta', context_length: 128000 },
      { id: 'mistralai/Mixtral-8x7B-Instruct-v0.1', owned_by: 'mistral', context_length: 32768 },
      { id: 'Qwen/Qwen2.5-72B-Instruct-Turbo', owned_by: 'qwen', context_length: 32768 },
    ],
    default: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [
      { id: 'anthropic/claude-sonnet-4', owned_by: 'anthropic', context_length: 200000 },
      { id: 'openai/gpt-4o', owned_by: 'openai', context_length: 128000 },
      { id: 'google/gemini-2.5-pro', owned_by: 'google', context_length: 1000000 },
      { id: 'meta-llama/llama-3.3-70b-instruct', owned_by: 'meta', context_length: 128000 },
    ],
    default: 'anthropic/claude-sonnet-4',
  },
};

export class ModelFetcher {
  private cache: Map<string, ProviderModels> = new Map();
  private cacheTtl = 3600_000; // 1 hour

  async fetchModels(provider: string, apiKey?: string, baseUrl?: string): Promise<ProviderModels> {
    const cached = this.cache.get(provider);
    if (cached && Date.now() - new Date(cached.fetched_at).getTime() < this.cacheTtl) {
      return cached;
    }

    const providerDef = PROVIDER_DEFAULTS[provider];
    const url = baseUrl || providerDef?.baseUrl;
    if (!url) {
      throw new Error(`Unknown provider: ${provider}. Use --base-url or set a known provider.`);
    }

    try {
      const modelsUrl = `${url}/models`;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      const response = await fetch(modelsUrl, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json() as any;
      const models: ModelInfo[] = (data.data || [])
        .filter((m: any) => m.id && typeof m.id === 'string')
        .map((m: any) => ({
          id: m.id,
          owned_by: m.owned_by || provider,
          context_length: m.context_length || undefined,
        }))
        .sort((a: ModelInfo, b: ModelInfo) => a.id.localeCompare(b.id));

      const result: ProviderModels = {
        provider,
        baseUrl: url,
        models,
        fetched_at: new Date().toISOString(),
        default_model: providerDef?.default || models[0]?.id || '',
      };

      this.cache.set(provider, result);
      return result;
    } catch {
      // Fallback to known defaults
      if (providerDef) {
        const result: ProviderModels = {
          provider,
          baseUrl: providerDef.baseUrl,
          models: providerDef.models,
          fetched_at: new Date().toISOString(),
          default_model: providerDef.default,
        };
        this.cache.set(provider, result);
        return result;
      }
      throw new Error(`Cannot fetch models from ${url}`);
    }
  }

  getProviderDefaults(provider: string): ProviderModels | null {
    const def = PROVIDER_DEFAULTS[provider];
    if (!def) return null;
    return {
      provider,
      baseUrl: def.baseUrl,
      models: def.models,
      fetched_at: new Date().toISOString(),
      default_model: def.default,
    };
  }

  listKnownProviders(): string[] {
    return Object.keys(PROVIDER_DEFAULTS);
  }

  getCached(provider: string): ProviderModels | null {
    return this.cache.get(provider) || null;
  }

  clearCache(): void {
    this.cache.clear();
  }
}
