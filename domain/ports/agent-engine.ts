/**
 * Port interface for interacting with the LLM/Agent engine.
 * Provides an abstraction over the low-level implementation (Rust, WASM, etc.).
 */
export interface AgentEnginePort {
  /**
   * Initializes an agent with a given persona.
   * @param id - The agent/persona ID
   * @param description - The persona description
   * @param prompt - The system persona prompt
   * @returns Promise resolving to a status message
   */
  initialize(id: string, description: string, prompt: string): Promise<string>;

  /**
   * Runs an agent with a given input prompt.
   * @param prompt - The user query
   * @returns Promise resolving to the agent's response
   */
  run(prompt: string): Promise<string>;
}
