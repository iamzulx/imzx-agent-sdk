import { GetPersonaUseCase } from './use-cases/get-persona';
import { AgentEnginePort } from '../domain/ports/agent-engine';
import { Persona } from '../domain/personas/types';

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
    const initResult = await this.agentEngine.initialize(
      agentId,
      persona.description,
      persona.prompt
    );
    // Log removed from application layer to prevent info leakage
    // If logging is needed, use a dedicated Logger adapter


    // Step 3: Run Agent (Infrastructure)
    const response = await this.agentEngine.run(userPrompt);

    return response;
  }
}
