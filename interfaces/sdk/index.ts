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
export { AuthManager, getAuthManager } from '../../adapters/security/auth-manager.js';
export type { StoredKey, AuthEvent, KeyGenerationResult, KeyScope } from '../../adapters/security/auth-manager.js';
export { HitlManager, getHitlManager } from '../../adapters/tools/hitl-manager.js';
export type { ApprovalRequest, RiskLevel, ApprovalStatus, HitlRule } from '../../adapters/tools/hitl-manager.js';
export { LlmJudge, getLlmJudge, RUBRICS } from '../../adapters/tools/llm-judge.js';
export type { EvaluationRubric, EvaluationResult, CriterionScore } from '../../adapters/tools/llm-judge.js';
export { CostEstimator, getCostEstimator } from '../../adapters/tools/cost-planner.js';
export type { ModelPricing, TaskCostEstimate, ModelComparison } from '../../adapters/tools/cost-planner.js';
export { PolicyEngine, getPolicyEngine } from '../../adapters/security/policy-engine.js';
export type { Policy, PolicyContext, PolicyDecision } from '../../adapters/security/policy-engine.js';
export { ChainTopology, StarTopology, MeshTopology, createTopology } from '../../adapters/tools/topology.js';
export type { Agent, TopologyResult, TopologyType } from '../../adapters/tools/topology.js';
export { AgentLifecycleManager } from '../../adapters/tools/agent-lifecycle.js';
export type { AgentState, LifecycleEvent, HealthStatus } from '../../adapters/tools/agent-lifecycle.js';
export { SlmRouter, getSlmRouter, SLM_CATALOG } from '../../adapters/tools/slm-router.js';
export type { SLMConfig, TaskCategory } from '../../adapters/tools/slm-router.js';
export { CuaBrowser, getCuaToolDefinitions } from '../../adapters/tools/cua-browser.js';
export type { BrowserConfig, PageContent, ScreenshotResult } from '../../adapters/tools/cua-browser.js';
export { RAGPipeline, getRAGPipeline } from '../../adapters/tools/rag-pipeline.js';
export type { Document as RAGDocument, RetrievalResult, RAGConfig } from '../../adapters/tools/rag-pipeline.js';
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
      // [C1 FIX] Use proper async queue pattern to avoid race condition
      const queue: StreamChunk[] = [];
      let resolve: (() => void) | null = null;
      let done = false;
      let error: Error | null = null;

      const notify = () => {
        if (resolve) { const r = resolve; resolve = null; r(); }
      };

      // Start streaming in background
      const runPromise = agentService.execute(defaultPersona, prompt, {
        ...options,
        streaming: true,
        budget: options.budget || config.budget,
        onChunk: (chunk) => {
          queue.push(chunk);
          notify();
        },
      }).then(() => {
        done = true;
        notify();
      }).catch((err) => {
        error = err;
        done = true;
        notify();
      });

      // Yield chunks as they arrive — check queue BEFORE awaiting
      while (true) {
        while (queue.length > 0) {
          const chunk = queue.shift()!;
          if (chunk.type === 'done') { await runPromise; return; }
          yield chunk;
        }
        if (error) {
          yield { type: 'error' as any, content: (error as Error).message };
          return;
        }
        if (done) { await runPromise; return; }
        await new Promise<void>(r => { resolve = r; });
      }
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
