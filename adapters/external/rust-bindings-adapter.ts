import { AgentEnginePort } from '../../domain/ports/agent-engine';
import { Persona } from '../../domain/personas/types';

// Import the Rust core bindings
// Note: This assumes 'imzxCore' is available in the runtime environment
const imzxCore = require('@imzx/core-bindings') as any;

/**
 * Adapter that bridges the application layer with the Rust core via FFI bindings.
 * Implements the AgentEnginePort interface to provide a testable contract.
 */
export class RustBindingsAdapter implements AgentEnginePort {
  /**
   * Initialize the agent in the Rust core.
   * @param id - Agent ID
   * @param description - Persona description
   * @param prompt - System prompt
   */
  async initialize(id: string, description: string, prompt: string): Promise<string> {
    // Ensure the Rust core is available
    if (!imzxCore || typeof imzxCore.agentNew !== 'function') {
      throw new Error('Rust core bindings not available or missing agentNew method');
    }

    // Delegate to the FFI layer
    return imzxCore.agentNew(id, description, prompt);
  }

  /**
   * Run the agent with a user prompt.
   * @param prompt - User input
   */
  async run(prompt: string): Promise<string> {
    if (!imzxCore || typeof imzxCore.agentRun !== 'function') {
      throw new Error('Rust core bindings not available or missing agentRun method');
    }

    return imzxCore.agentRun(prompt);
  }
}
