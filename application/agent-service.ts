import type { GetPersonaUseCase } from './use-cases/get-persona.js';
import type { AgentEnginePort } from '../domain/ports/agent-engine.js';
import type { Persona } from '../domain/personas/types.js';

/**
 * Application Service: Coordinates the workflow for running an agent.
 * This is the primary entry point for the CLI/UI layers to interact with the system.
 */
export class AgentService {
  constructor(
    private readonly getPersonaUseCase: GetPersonaUseCase,
    private readonly agentEngine: AgentEnginePort
  ) {}

  /**
   * Executes the full agent workflow:
   * 1. Retrieve the persona definition from persistence
   * 2. Initialize the agent engine with that persona
   * 3. Execute the agent with the user prompt
   *
   * @param agentId - The identifier for the persona/agent configuration
   * @param userPrompt - The user's input query
   * @returns Promise resolving to the agent's response
   */
  async execute(agentId: string, userPrompt: string): Promise<string> {
    // Step 1: Fetch Persona (Domain Logic)
    const persona: Persona = await this.getPersonaUseCase.execute(agentId);

    // Step 2: Initialize Engine (Infrastructure)
    await this.agentEngine.initialize(
      agentId,
      persona.description,
      persona.prompt
    );

    // Step 3: Run Agent (Infrastructure)
    const response = await this.agentEngine.run(userPrompt);

    return response;
  }
}
