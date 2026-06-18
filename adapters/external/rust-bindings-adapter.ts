/**
 * Rust Bindings Adapter — connects TypeScript to the Rust core via NAPI-RS.
 * v2.0 — Uses real AgentEngine as fallback when NAPI module is not available.
 * 
 * Priority:
 * 1. Try loading native NAPI module (Rust core)
 * 2. Fall back to TypeScript AgentEngine (real LLM API calls)
 */

import type { AgentEnginePort, StreamChunk, SessionStats, AgentState } from '../../domain/ports/agent-engine.js';
import { AgentEngine, type AgentEngineConfig } from './agent-engine.js';

export interface RustBindingsAdapterConfig {
  /** LLM API base URL (e.g., https://openrouter.ai/api/v1/chat/completions) */
  baseUrl?: string;
  /** LLM API key */
  apiKey?: string;
  /** Model name */
  model?: string;
  /** Max iterations for ReAct loop */
  maxIterations?: number;
  /** Verbose logging */
  verbose?: boolean;
}

export class RustBindingsAdapter implements AgentEnginePort {
  private engine: AgentEngine | null = null;
  private nativeAgent: any = null;
  private useNative = false;
  private adapterConfig: RustBindingsAdapterConfig;
  private currentPersona = { id: '', description: '', prompt: '' };

  constructor(config: RustBindingsAdapterConfig = {}) {
    this.adapterConfig = config;
  }

  async initialize(id: string, description: string, prompt: string): Promise<string> {
    this.currentPersona = { id, description, prompt };

    // Try native NAPI first
    if (!this.nativeAgent) {
      try {
        const { createRequire } = await import('node:module');
        const require = createRequire(import.meta.url);
        const candidates = [
          '../../core/target/release/imzx_core.linux-arm64-gnu.node',
          '../../core/target/release/imzx_core.android-arm64.node',
          '../../core/target/debug/imzx_core.linux-arm64-gnu.node',
        ];
        for (const c of candidates) {
          try {
            const mod = require(c);
            this.nativeAgent = new mod.TsAgent(id, description, prompt);
            this.useNative = true;
            return `[NAPI-RS] Agent '${id}' initialized with Rust core`;
          } catch { /* try next */ }
        }
      } catch { /* no native module */ }
    } else if (this.useNative) {
      // Reinitialize native agent
      try {
        const { createRequire } = await import('node:module');
        const require = createRequire(import.meta.url);
        const mod = require('../../core/target/release/imzx_core.linux-arm64-gnu.node');
        this.nativeAgent = new mod.TsAgent(id, description, prompt);
        return `[NAPI-RS] Agent '${id}' re-initialized`;
      } catch { /* fall through */ }
    }

    // Fall back to TypeScript engine
    const config = this.resolveConfig();
    this.engine = new AgentEngine({
      ...config,
      systemPrompt: prompt,
    });
    await this.engine.initialize(id, description, prompt);

    return `[TypeScript] Agent '${id}' initialized with ${config.model} (tools: 6)`;
  }

  async run(prompt: string): Promise<string> {
    if (this.useNative && this.nativeAgent) {
      return this.nativeAgent.run(prompt);
    }
    if (!this.engine) throw new Error('Agent not initialized');
    return this.engine.run(prompt);
  }

  async *runStreaming?(prompt: string): AsyncGenerator<StreamChunk> {
    if (!this.engine) throw new Error('Agent not initialized');
    yield* this.engine.runStreaming(prompt);
  }

  async getState(): Promise<AgentState> {
    if (this.useNative && this.nativeAgent) {
      return (await this.nativeAgent.getState()).toLowerCase();
    }
    return this.engine?.getState() || 'idle';
  }

  async getStats(): Promise<SessionStats> {
    if (this.useNative && this.nativeAgent) {
      const raw = JSON.parse(await this.nativeAgent.getStats());
      return {
        totalInputTokens: raw.total_input_tokens,
        totalOutputTokens: raw.total_output_tokens,
        totalCostUsd: raw.total_cost_usd,
        requestCount: raw.request_count,
      };
    }
    return this.engine?.getStats() || { totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0, requestCount: 0 };
  }

  async setBudget(maxTokens: number, budgetUsd: number): Promise<void> {
    if (this.useNative && this.nativeAgent) {
      await this.nativeAgent.setBudget(maxTokens, budgetUsd);
    }
    await this.engine?.setBudget(maxTokens, budgetUsd);
  }

  /** Resolve LLM config from adapter config, env vars, or defaults. */
  private resolveConfig(): AgentEngineConfig {
    const baseUrl = this.adapterConfig.baseUrl
      || process.env.IMZX_LLM_BASE_URL
      || process.env.OPENROUTER_API_URL
      || 'https://openrouter.ai/api/v1/chat/completions';

    const apiKey = this.adapterConfig.apiKey
      || process.env.IMZX_API_KEY
      || process.env.OPENROUTER_API_KEY
      || process.env.ANTHROPIC_API_KEY
      || process.env.OPENAI_API_KEY
      || '';

    const model = this.adapterConfig.model
      || process.env.IMZX_MODEL
      || 'anthropic/claude-sonnet-4';

    return {
      baseUrl,
      apiKey,
      model,
      maxIterations: this.adapterConfig.maxIterations || 10,
      verbose: this.adapterConfig.verbose || false,
    };
  }
}
