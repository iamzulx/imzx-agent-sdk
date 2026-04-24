import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AgentService } from '../../../application/agent-service';
import { FilePersonaRepository } from '../../../adapters/persistence/file-persona-repository';
import { RustBindingsAdapter } from '../../../adapters/external/rust-bindings-adapter';

/**
 * CLI Handler: Presentation layer interface for the command-line interface.
 * This class is responsible only for:
 * 1. Parsing and validating command-line arguments
 * 2. Displaying prompts and results to the user
 * 3. Handling user input/output formatting
 *
 * Business logic is delegated to the Application Service layer.
 */
export class CliHandler {
  private readonly agentService: AgentService;
  private readonly personaDir: string;

  constructor(personaDir: string) {
    // Create infrastructure adapters
    const personaRepository = new FilePersonaRepository(personaDir);
    const agentEngine = new RustBindingsAdapter();

    // Create use case
    const getPersonaUseCase = new (await import('../../application/use-cases/get-persona')).GetPersonaUseCase(personaRepository);

    // Compose application service
    this.agentService = new AgentService(getPersonaUseCase, agentEngine);
    this.personaDir = personaDir;
  }

  /**
   * Main entry point for CLI execution.
   * @param args - Command line arguments (process.argv.slice(2))
   */
  async handle(args: string[]): Promise<void> {
    // Validate arguments
    if (args.length < 1) {
      this.showUsage();
      process.exit(1);
    }

    const prompt = args[0];
    const agentName = args[1] || 'general-purpose';

    // Validate agent name to prevent path traversal
    if (!/^[a-zA-Z0-9_-]+$/.test(agentName)) {
      console.error(`[ERROR] Invalid agent name: ${agentName}. Only alphanumeric, underscores, and hyphens are allowed.`);
      process.exit(1);
    }

    try {
      // Delegate business logic to application layer
      const response = await this.agentService.execute(agentName, prompt);

      // Presentation layer: format and display output
      console.log('\n--- Agent Response ---');
      console.log(response);
      console.log('----------------------\n');
    } catch (err: any) {
      // Presentation layer: handle and display errors
      if (err.code === 'ENOENT') {
        console.error(`[ERROR] Persona '${agentName}.json' not found in ${this.personaDir}`);
      } else {
        console.error(`[ERROR] ${err.message || String(err)}`);
      }
      process.exit(1);
    }
  }

  /**
   * Display usage information.
   */
  private showUsage(): void {
    console.log('Usage: node cli-handler.ts <prompt> [agent_name]');
    console.log('  <prompt>    The user query to send to the agent');
    console.log('  [agent_name] Optional: name of the persona to use (defaults to "general-purpose")');
  }
}
