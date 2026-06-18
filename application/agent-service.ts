/**
 * Application Service — coordinates agent workflow.
 * v2.0 — Added streaming, hooks, budget, multi-agent support.
 */

import type { GetPersonaUseCase } from './use-cases/get-persona.js';
import type { AgentEnginePort, StreamChunk, SessionStats, AgentState } from '../domain/ports/agent-engine.js';
import type { Persona } from '../domain/personas/types.js';

export interface RunOptions {
  /** Enable streaming response. */
  streaming?: boolean;
  /** Budget override for this run. */
  budget?: { maxTokens?: number; budgetUsd?: number };
  /** Callback for stream chunks. */
  onChunk?: (chunk: StreamChunk) => void;
  /** Callback for state changes. */
  onStateChange?: (state: AgentState) => void;
}

/**
 * Agent Service — primary entry point for all interface layers.
 */
export class AgentService {
  private currentPersona: Persona | null = null;

  constructor(
    private readonly getPersonaUseCase: GetPersonaUseCase,
    private readonly agentEngine: AgentEnginePort
  ) {}

  /**
   * Execute agent with full options support.
   */
  async execute(agentId: string, userPrompt: string, options: RunOptions = {}): Promise<string> {
    // Step 1: Fetch persona
    this.currentPersona = await this.getPersonaUseCase.execute(agentId);

    // Step 2: Initialize engine
    await this.agentEngine.initialize(
      agentId,
      this.currentPersona.description,
      this.currentPersona.prompt
    );

    // Step 3: Set budget if provided
    if (options.budget && this.agentEngine.setBudget) {
      await this.agentEngine.setBudget(
        options.budget.maxTokens ?? 500_000,
        options.budget.budgetUsd ?? 5.0
      );
    }

    // Step 4: Run with streaming or synchronous
    if (options.streaming && this.agentEngine.runStreaming) {
      let fullResponse = '';
      for await (const chunk of this.agentEngine.runStreaming(userPrompt)) {
        options.onChunk?.(chunk);
        if (chunk.type === 'text') {
          fullResponse += chunk.content;
        }
      }
      return fullResponse;
    }

    // Synchronous run
    return this.agentEngine.run(userPrompt);
  }

  /**
   * Get current agent statistics.
   */
  async getStats(): Promise<SessionStats | null> {
    if (this.agentEngine.getStats) {
      return this.agentEngine.getStats();
    }
    return null;
  }

  /**
   * Get current agent state.
   */
  async getState(): Promise<AgentState | null> {
    if (this.agentEngine.getState) {
      return this.agentEngine.getState();
    }
    return null;
  }

  /**
   * Get the currently loaded persona.
   */
  getCurrentPersona(): Persona | null {
    return this.currentPersona;
  }
}
