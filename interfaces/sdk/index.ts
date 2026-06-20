/**
 * imzx-agent-sdk — Programmatic SDK.
 * 
 * Usage:
 *   import { createAgent, McpClient } from 'imzx-agent-sdk';
 * 
 *   const agent = await createAgent({
 *     persona: 'general-purpose',
 *     budget: { maxTokens: 100_000, budgetUsd: 1.0 },
 *   });
 * 
 *   // Synchronous
 *   const response = await agent.run('What is Rust?');
 * 
 *   // Streaming
 *   for await (const chunk of agent.stream('Explain ownership')) {
 *     process.stdout.write(chunk.content);
 *   }
 * 
 *   // With hooks
 *   agent.on('pre_tool_use', (event) => {
 *     console.log('Tool called:', event.data.tool_name);
 *   });
 */

import { AgentService, type RunOptions } from '../../application/agent-service.js';
import { GetPersonaUseCase } from '../../application/use-cases/get-persona.js';
import { FilePersonaRepository } from '../../adapters/persistence/file-persona-repository.js';
import { RustBindingsAdapter } from '../../adapters/external/rust-bindings-adapter.js';
import type { StreamChunk, SessionStats, HookEventType, HookEvent } from '../../domain/ports/agent-engine.js';

export { McpClient } from '../../adapters/external/mcp-adapter.js';
export type { StreamChunk, SessionStats, HookEvent };

// New module exports (v0.6.0)
export { A2AAdapter } from '../../adapters/external/a2a-adapter.js';
export { TelemetryCollector } from '../../adapters/tools/telemetry.js';
export { PluginManager } from '../../adapters/tools/plugin-system.js';
export { GitContext } from '../../adapters/tools/git-context.js';
export { ProjectContext } from '../../adapters/tools/project-context.js';
export { TfIdfEmbedder } from '../../adapters/memory/embeddings.js';
export { CheckpointManager } from '../../adapters/memory/conversation-checkpoint.js';
export {
  Orchestrator,
  RouterStrategy,
  HierarchicalStrategy,
  ConsensusStrategy,
  ChainingStrategy,
  EvaluatorOptimizerStrategy,
  ParallelizationStrategy,
} from '../../adapters/tools/orchestration.js';
export type { OrchestrationStrategy } from '../../adapters/tools/orchestration.js';

export interface AgentConfig {
  /** Path to persona directory. Default: ./domain/personas */
  personaDir?: string;
  /** Default persona. Default: general-purpose */
  persona?: string;
  /** Budget limits. */
  budget?: { maxTokens?: number; budgetUsd?: number };
}

export interface AgentInstance {
  /** Run agent synchronously. */
  run(prompt: string, options?: RunOptions): Promise<string>;
  /** Run agent with streaming. */
  stream(prompt: string, options?: Omit<RunOptions, 'streaming'>): AsyncGenerator<StreamChunk>;
  /** Get session statistics. */
  stats(): Promise<SessionStats | null>;
  /** Register a hook event listener. */
  on(event: HookEventType, callback: (event: HookEvent) => void): void;
  /** Get the underlying service (advanced). */
  service(): AgentService;
}

/**
 * Create an agent instance.
 */
export async function createAgent(config: AgentConfig = {}): Promise<AgentInstance> {
  const personaDir = config.personaDir || './domain/personas';
  const defaultPersona = config.persona || 'general-purpose';

  const personaRepository = new FilePersonaRepository(personaDir);
  const agentEngine = new RustBindingsAdapter();
  const getPersonaUseCase = new GetPersonaUseCase(personaRepository);
  const agentService = new AgentService(getPersonaUseCase, agentEngine);

  const hookListeners = new Map<HookEventType, Set<(event: HookEvent) => void>>();

  return {
    async run(prompt: string, options: RunOptions = {}): Promise<string> {
      return agentService.execute(defaultPersona, prompt, {
        ...options,
        budget: options.budget || config.budget,
      });
    },

    async *stream(prompt: string, options: Omit<RunOptions, 'streaming'> = {}): AsyncGenerator<StreamChunk> {
      const chunks: StreamChunk[] = [];
      let resolve: (() => void) | null = null;
      let done = false;
      let error: Error | null = null;

      // Start streaming in background
      const runPromise = agentService.execute(defaultPersona, prompt, {
        ...options,
        streaming: true,
        budget: options.budget || config.budget,
        onChunk: (chunk) => {
          chunks.push(chunk);
          resolve?.();
        },
      }).catch((err) => {
        error = err;
        resolve?.(); // Wake up the waiting loop
      });

      // Yield chunks as they arrive
      while (!done) {
        while (chunks.length > 0) {
          const chunk = chunks.shift()!;
          if (chunk.type === 'done') {
            done = true;
            break;
          }
          yield chunk;
        }
        if (error) {
          yield { type: 'error', content: (error as Error).message };
          done = true;
        } else if (!done) {
          await new Promise<void>(r => { resolve = r; });
        }
      }

      await runPromise;
    },

    async stats(): Promise<SessionStats | null> {
      return agentService.getStats();
    },

    on(event: HookEventType, callback: (event: HookEvent) => void): void {
      if (!hookListeners.has(event)) {
        hookListeners.set(event, new Set());
      }
      hookListeners.get(event)!.add(callback);
    },

    service(): AgentService {
      return agentService;
    },
  };
}
