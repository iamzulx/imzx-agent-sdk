/**
 * CLI Handler — full-featured command-line interface.
 * v2.0 — Subcommands, streaming, interactive REPL, colored output.
 *
 * Usage:
 *   imzx run "What is Rust?"              # Single prompt
 *   imzx chat                             # Interactive REPL
 *   imzx serve --port 3000                # Start REST API
 *   imzx mcp connect <server>             # Connect MCP server
 *   imzx personas list                    # List personas
 *   imzx stats                            # Show session stats
 */

import * as path from 'node:path';
import * as readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { AgentService, type RunOptions } from '../../application/agent-service.js';
import { GetPersonaUseCase } from '../../application/use-cases/get-persona.js';
import { FilePersonaRepository } from '../../adapters/persistence/file-persona-repository.js';
import { RustBindingsAdapter } from '../../adapters/external/rust-bindings-adapter.js';

// --- ANSI Colors ---
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgBlue: '\x1b[44m',
};

export class CliHandler {
  private readonly agentService: AgentService;
  private readonly personaDir: string;
  private readonly verbose: boolean;

  constructor(personaDir: string, options: { verbose?: boolean } = {}) {
    // Load .env file
    loadDotenv({ path: path.resolve(process.cwd(), '.env') });

    const personaRepository = new FilePersonaRepository(personaDir);
    const agentEngine = new RustBindingsAdapter({
      verbose: options.verbose,
    });
    const getPersonaUseCase = new GetPersonaUseCase(personaRepository);

    this.agentService = new AgentService(getPersonaUseCase, agentEngine);
    this.personaDir = personaDir;
    this.verbose = options.verbose ?? false;
  }

  /**
   * Main entry point — route to subcommands.
   */
  async handle(args: string[]): Promise<void> {
    const command = args[0];

    switch (command) {
      case 'run':
        return this.handleRun(args.slice(1));
      case 'chat':
        return this.handleChat(args.slice(1));
      case 'serve':
        return this.handleServe(args.slice(1));
      case 'personas':
        return this.handlePersonas(args.slice(1));
      case 'stats':
        return this.handleStats();
      case 'mcp':
        return this.handleMcp(args.slice(1));
      case 'help':
      case '--help':
      case '-h':
        return this.showHelp();
      default:
        // Treat first arg as prompt (backwards compatible)
        if (command && !command.startsWith('-')) {
          return this.handleRun(args);
        }
        this.showHelp();
        process.exit(1);
    }
  }

  // --- Subcommands ---

  /**
   * `imzx run <prompt> [--persona <name>] [--stream] [--budget-tokens N] [--budget-usd N]`
   */
  private async handleRun(args: string[]): Promise<void> {
    const { prompt, options, persona } = this.parseRunArgs(args);

    if (!prompt) {
      console.error(`${c.red}Error: No prompt provided${c.reset}`);
      console.log(`Usage: imzx run "your prompt" [--persona general-purpose]`);
      process.exit(1);
    }

    const personaName = persona || 'general-purpose';
    const runOptions: RunOptions = {
      streaming: options.stream ?? true,
      budget: {
        maxTokens: options['budget-tokens'] ? parseInt(options['budget-tokens']) : undefined,
        budgetUsd: options['budget-usd'] ? parseFloat(options['budget-usd']) : undefined,
      },
    };

    // Streaming output handler
    if (runOptions.streaming) {
      runOptions.onChunk = (chunk) => {
        if (chunk.type === 'text') {
          process.stdout.write(chunk.content);
        } else if (chunk.type === 'tool_call') {
          process.stdout.write(`\n${c.cyan}[Tool: ${chunk.content}]${c.reset} `);
        } else if (chunk.type === 'tool_result') {
          process.stdout.write(`${c.dim}✓${c.reset}`);
        } else if (chunk.type === 'thinking') {
          if (this.verbose) {
            process.stdout.write(`${c.dim}[thinking: ${chunk.content.substring(0, 80)}...]${c.reset}`);
          }
        } else if (chunk.type === 'error') {
          process.stderr.write(`\n${c.red}[Error: ${chunk.content}]${c.reset}\n`);
        } else if (chunk.type === 'done') {
          process.stdout.write('\n');
        }
      };
    }

    // Banner
    console.log(`${c.bold}${c.blue}╔══════════════════════════════════════╗${c.reset}`);
    console.log(`${c.bold}${c.blue}║     imzx-agent-sdk v0.3.0           ║${c.reset}`);
    console.log(`${c.bold}${c.blue}╚══════════════════════════════════════╝${c.reset}`);
    console.log(`${c.dim}Persona: ${personaName} | Streaming: ${runOptions.streaming ? 'ON' : 'OFF'}${c.reset}`);
    console.log(`${c.dim}Budget: ${runOptions.budget?.maxTokens ?? '500K'} tokens, $${runOptions.budget?.budgetUsd ?? '5.00'}${c.reset}`);
    console.log('');

    try {
      const startTime = Date.now();
      const response = await this.agentService.execute(personaName, prompt, runOptions);
      const elapsed = Date.now() - startTime;

      // If not streaming, print the full response
      if (!runOptions.streaming) {
        console.log(`\n${c.green}--- Response ---${c.reset}`);
        console.log(response);
      }

      // Stats footer
      const stats = await this.agentService.getStats();
      if (stats) {
        console.log(`\n${c.dim}────────────────────────────────────`);
        console.log(`Tokens: ${stats.totalInputTokens} in / ${stats.totalOutputTokens} out | Cost: $${stats.totalCostUsd.toFixed(4)} | ${elapsed}ms${c.reset}`);
      }
    } catch (err: any) {
      console.error(`\n${c.red}✗ Error: ${err.message || String(err)}${c.reset}`);
      process.exit(1);
    }
  }

  /**
   * `imzx chat [--persona <name>]` — interactive REPL mode.
   */
  private async handleChat(args: string[]): Promise<void> {
    const persona = this.getArg(args, '--persona') || 'general-purpose';

    console.log(`${c.bold}${c.blue}╔══════════════════════════════════════╗${c.reset}`);
    console.log(`${c.bold}${c.blue}║     imzx-agent-sdk — Chat Mode      ║${c.reset}`);
    console.log(`${c.bold}${c.blue}╚══════════════════════════════════════╝${c.reset}`);
    console.log(`${c.dim}Persona: ${persona} | Type 'exit' or Ctrl+C to quit${c.reset}`);
    console.log(`${c.dim}Commands: /stats /clear /persona <name> /help${c.reset}\n`);

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: `${c.green}you> ${c.reset}`,
    });

    let currentPersona = persona;

    const initResult = await this.agentService.execute(currentPersona, '__init__');
    rl.prompt();

    rl.on('line', async (line) => {
      const input = line.trim();

      // Handle commands
      if (input.startsWith('/')) {
        const [cmd, ...rest] = input.split(' ');
        switch (cmd) {
          case '/exit':
          case '/quit':
            console.log(`${c.dim}Goodbye!${c.reset}`);
            process.exit(0);
          case '/stats':
            const stats = await this.agentService.getStats();
            if (stats) {
              console.log(`${c.cyan}Tokens: ${stats.totalInputTokens} in / ${stats.totalOutputTokens} out | Cost: $${stats.totalCostUsd.toFixed(4)} | Requests: ${stats.requestCount}${c.reset}`);
            }
            break;
          case '/clear':
            console.clear();
            break;
          case '/persona':
            if (rest[0]) {
              currentPersona = rest[0];
              console.log(`${c.yellow}Switched to persona: ${currentPersona}${c.reset}`);
            } else {
              console.log(`${c.yellow}Current persona: ${currentPersona}${c.reset}`);
            }
            break;
          case '/help':
            console.log(`${c.cyan}/stats${c.reset} — Show session statistics`);
            console.log(`${c.cyan}/clear${c.reset} — Clear screen`);
            console.log(`${c.cyan}/persona <name>${c.reset} — Switch persona`);
            console.log(`${c.cyan}/exit${c.reset} — Quit chat`);
            break;
          default:
            console.log(`${c.red}Unknown command: ${cmd}${c.reset}`);
        }
        rl.prompt();
        return;
      }

      if (!input) {
        rl.prompt();
        return;
      }

      // Run agent
      try {
        process.stdout.write(`${c.magenta}agent> ${c.reset}`);
        const response = await this.agentService.execute(currentPersona, input, {
          streaming: true,
          onChunk: (chunk) => {
            if (chunk.type === 'text') {
              process.stdout.write(chunk.content);
            } else if (chunk.type === 'tool_call') {
              process.stdout.write(`\n${c.cyan}[Tool: ${chunk.content}]${c.reset} `);
            }
          },
        });
        console.log('\n');
      } catch (err: any) {
        console.error(`${c.red}Error: ${err.message}${c.reset}\n`);
      }

      rl.prompt();
    });

    rl.on('close', () => {
      console.log(`\n${c.dim}Session ended.${c.reset}`);
      process.exit(0);
    });
  }

  /**
   * `imzx serve [--port <port>] [--host <host>]` — start REST API server.
   */
  private async handleServe(args: string[]): Promise<void> {
    const port = parseInt(this.getArg(args, '--port') || '3000');
    const host = this.getArg(args, '--host') || '127.0.0.1';

    // Dynamic import to avoid loading server deps when not needed
    const { createServer } = await import('../api/server.js');
    await createServer(this.agentService, { port, host });
  }

  /**
   * `imzx personas list` — list available personas.
   */
  private async handlePersonas(args: string[]): Promise<void> {
    const subcommand = args[0];

    if (subcommand === 'list' || !subcommand) {
      const { readdir } = await import('node:fs/promises');
      try {
        const files = await readdir(this.personaDir);
        const personas = files.filter(f => f.endsWith('.json'));

        console.log(`${c.bold}Available Personas:${c.reset}\n`);
        for (const file of personas) {
          const name = file.replace('.json', '');
          const { readFile } = await import('node:fs/promises');
          const content = JSON.parse(await readFile(path.join(this.personaDir, file), 'utf-8'));
          console.log(`  ${c.green}${name}${c.reset} — ${content.description || 'No description'}`);
        }
        console.log(`\n${c.dim}Total: ${personas.length} personas${c.reset}`);
      } catch {
        console.error(`${c.red}Cannot read personas directory: ${this.personaDir}${c.reset}`);
      }
    }
  }

  /**
   * `imzx stats` — show current session statistics.
   */
  private async handleStats(): Promise<void> {
    const stats = await this.agentService.getStats();
    if (stats) {
      console.log(`${c.bold}Session Statistics:${c.reset}`);
      console.log(`  Input tokens:  ${stats.totalInputTokens.toLocaleString()}`);
      console.log(`  Output tokens: ${stats.totalOutputTokens.toLocaleString()}`);
      console.log(`  Total cost:    $${stats.totalCostUsd.toFixed(4)}`);
      console.log(`  Requests:      ${stats.requestCount}`);
    } else {
      console.log(`${c.dim}No active session.${c.reset}`);
    }
  }

  /**
   * `imzx mcp connect <server>` — connect to MCP server.
   */
  private async handleMcp(args: string[]): Promise<void> {
    console.log(`${c.yellow}MCP client is available via the McpClient adapter.${c.reset}`);
    console.log(`${c.dim}Use: import { McpClient } from './adapters/external/mcp-adapter.js'${c.reset}`);
  }

  // --- Helpers ---

  private parseRunArgs(args: string[]): { prompt: string; options: Record<string, string>; persona: string } {
    let prompt = '';
    const options: Record<string, string> = {};
    let persona = '';

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--persona' && args[i + 1]) {
        persona = args[++i];
      } else if (arg === '--stream') {
        options.stream = 'true';
      } else if (arg === '--no-stream') {
        options.stream = 'false';
      } else if (arg === '--budget-tokens' && args[i + 1]) {
        options['budget-tokens'] = args[++i];
      } else if (arg === '--budget-usd' && args[i + 1]) {
        options['budget-usd'] = args[++i];
      } else if (arg === '--verbose' || arg === '-v') {
        this.verbose; // already set
      } else if (!arg.startsWith('-')) {
        prompt = arg;
      }
    }

    return { prompt, options, persona };
  }

  private getArg(args: string[], flag: string): string | undefined {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  }

  private showHelp(): void {
    console.log(`${c.bold}${c.blue}imzx-agent-sdk v0.3.0${c.reset} — AI Agent Framework\n`);
    console.log(`${c.bold}Usage:${c.reset}`);
    console.log(`  imzx run <prompt> [options]    Run agent with a prompt`);
    console.log(`  imzx chat [options]            Interactive REPL mode`);
    console.log(`  imzx serve [options]           Start REST API server`);
    console.log(`  imzx personas list             List available personas`);
    console.log(`  imzx stats                     Show session statistics`);
    console.log(`  imzx help                      Show this help\n`);
    console.log(`${c.bold}Options:${c.reset}`);
    console.log(`  --persona <name>     Persona to use (default: general-purpose)`);
    console.log(`  --stream             Enable streaming output (default: on)`);
    console.log(`  --no-stream          Disable streaming output`);
    console.log(`  --budget-tokens N    Max tokens per session (default: 500000)`);
    console.log(`  --budget-usd N       Max cost per session (default: 5.00)`);
    console.log(`  --port <port>        Server port (default: 3000)`);
    console.log(`  --host <host>        Server host (default: 127.0.0.1)`);
    console.log(`  -v, --verbose        Verbose output`);
  }
}

// --- Direct execution ---
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const personaDir = path.resolve(process.cwd(), 'domain/personas');
  const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');
  const handler = new CliHandler(personaDir, { verbose });
  await handler.handle(process.argv.slice(2));
}
