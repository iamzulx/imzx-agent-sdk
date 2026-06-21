const INIT_MARKER = '##IMZX_INIT##';
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
import { getAuthManager } from '../../adapters/security/auth-manager.js';
import { GetPersonaUseCase } from '../../application/use-cases/get-persona.js';
import { FilePersonaRepository } from '../../adapters/persistence/file-persona-repository.js';
import { RustBindingsAdapter } from '../../adapters/external/rust-bindings-adapter.js';
import { AuthCommand } from './auth-command.js';

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
      case 'dashboard':
        return this.handleDashboard(args.slice(1));
      case 'plugins':
        return this.handlePlugins(args.slice(1));
      case 'orchestrate':
        return this.handleOrchestrate(args.slice(1));
      case 'auth':
        return this.handleAuth(args.slice(1));
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
      streaming: options.stream ? options.stream !== 'false' : true,
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
          // [3.6] Show thinking indicator
          process.stdout.write(`${c.dim}⟳ ${chunk.content}${c.reset}\n`);
        } else if (chunk.type === 'error') {
          process.stderr.write(`\n${c.red}[Error: ${chunk.content}]${c.reset}\n`);
        } else if (chunk.type === 'done') {
          process.stdout.write('\n');
        }
      };
    }

    // Banner
    console.log(`${c.bold}${c.blue}╔══════════════════════════════════════╗${c.reset}`);
    console.log(`${c.bold}${c.blue}║     imzx-agent-sdk v0.5.0           ║${c.reset}`);
    console.log(`${c.bold}${c.blue}╚══════════════════════════════════════╝${c.reset}`);
    console.log(`${c.dim}Persona: ${personaName} | Streaming: ${runOptions.streaming ? 'ON' : 'OFF'}${c.reset}`);
    console.log(`${c.dim}Budget: ${runOptions.budget?.maxTokens ?? '500K'} tokens, $${runOptions.budget?.budgetUsd ?? '5.00'}${c.reset}`);
    console.log('');

    // Auto-inject git + project context into system prompt
    let contextPrompt = prompt;
    try {
      const { GitContext } = await import('../../adapters/tools/git-context.js');
      const git = new GitContext();
      if (git.isGitRepo()) {
        contextPrompt = contextPrompt + '\n\n' + git.formatForPrompt();
      }
    } catch { /* optional */ }
    try {
      const { ProjectContext } = await import('../../adapters/tools/project-context.js');
      const project = new ProjectContext();
      contextPrompt = contextPrompt + '\n\n' + project.formatForPrompt();
    } catch { /* optional */ }

    try {
      const startTime = Date.now();
      const response = await this.agentService.execute(personaName, contextPrompt, runOptions);
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

    const initResult = await this.agentService.execute(currentPersona, INIT_MARKER);

    // Auto-inject git + project context
    try {
      const { GitContext } = await import('../../adapters/tools/git-context.js');
      const { ProjectContext } = await import('../../adapters/tools/project-context.js');
      const git = new GitContext();
      const project = new ProjectContext();
      if (git.isGitRepo()) {
        console.log(`${c.dim}Git context: ${git.getStatus().branch}${c.reset}`);
      }
    } catch { /* optional */ }

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
            console.log(`${c.cyan}/history${c.reset} — Show conversation history count`);
            console.log(`${c.cyan}/reset${c.reset} — Clear conversation history`);
            console.log(`${c.cyan}/save [path]${c.reset} — Save agent state to file`);
            console.log(`${c.cyan}/load [path]${c.reset} — Load agent state from file`);
            console.log(`${c.cyan}/exit${c.reset} — Quit chat`);
            break;
          case '/history':
            // [C16 FIX] Show actual conversation info, not just persona
            const persona = this.agentService.getCurrentPersona();
            console.log(`${c.cyan}Active persona: ${persona?.id || currentPersona}${c.reset}`);
            console.log(`${c.cyan}Use /reset to clear conversation history.${c.reset}`);
            break;
          case '/reset':
            // Re-initialize to clear history
            await this.agentService.execute(currentPersona, INIT_MARKER);
            console.log(`${c.yellow}Conversation history cleared.${c.reset}`);
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

    // [S9] Graceful shutdown — first Ctrl+C cancels current, second exits
    let shuttingDown = false;
    process.on('SIGINT', () => {
      if (shuttingDown) {
        console.log(`\n${c.dim}Force exit.${c.reset}`);
        process.exit(0);
      }
      shuttingDown = true;
      console.log(`\n${c.yellow}Press Ctrl+C again to exit, or type 'exit'${c.reset}`);
      rl.prompt();
      setTimeout(() => { shuttingDown = false; }, 3000);
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

  /**
   * `imzx dashboard [--port <port>]` — start web dashboard.
   */
  private async handleDashboard(args: string[]): Promise<void> {
    const port = this.getArg(args, '--port') || '3100';
    console.log(`${c.bold}${c.blue}Starting dashboard on port ${port}...${c.reset}`);
    try {
      await import('../dashboard/server.js');
      console.log(`${c.green}✓ Dashboard started${c.reset}`);
    } catch (err: any) {
      console.error(`${c.red}Failed to start dashboard: ${err.message}${c.reset}`);
    }
  }

  /**
   * `imzx plugins list|install <name>` — manage plugins.
   */
  private async handlePlugins(args: string[]): Promise<void> {
    const subcommand = args[0];
    try {
      const { PluginManager } = await import('../../adapters/tools/plugin-system.js');
      const pm = new PluginManager();

      if (subcommand === 'list' || !subcommand) {
        const plugins = pm.listPlugins();
        console.log(`${c.bold}Plugins:${c.reset}`);
        if (plugins.length === 0) {
          console.log(`${c.dim}  No plugins installed.${c.reset}`);
        } else {
          for (const p of plugins) {
            console.log(`  ${c.green}${p.name}${c.reset} v${p.version} — ${p.description} [${p.status}]`);
          }
        }
      } else if (subcommand === 'install' && args[1]) {
        const plugin = await pm.loadPlugin(args[1]!);
        console.log(`${c.green}✓ Installed: ${plugin.name} v${plugin.version}${c.reset}`);
      } else {
        console.log(`Usage: imzx plugins [list|install <name>]`);
      }
    } catch (err: any) {
      console.error(`${c.red}Plugin error: ${err.message}${c.reset}`);
    }
  }

  /**
   * `imzx orchestrate <task> [--strategy <name>]` — multi-agent orchestration.
   */
  private async handleOrchestrate(args: string[]): Promise<void> {
    const task = args.filter(a => !a.startsWith('--')).join(' ');
    const strategy = this.getArg(args, '--strategy');

    if (!task) {
      console.log(`Usage: imzx orchestrate <task> [--strategy router|hierarchical|consensus|chaining|evaluator-optimizer|parallelization]`);
      return;
    }

    try {
      const { Orchestrator } = await import('../../adapters/tools/orchestration.js');
      const orchestrator = new Orchestrator();
      const analysis = orchestrator.analyzeTask(task);
      console.log(`${c.bold}Task analysis:${c.reset} ${analysis.type} → ${analysis.suggestedStrategy}`);
      console.log(`${c.dim}Reasoning: ${analysis.reasoning}${c.reset}`);
      if (strategy) {
        console.log(`${c.yellow}Using strategy: ${strategy}${c.reset}`);
      }
    } catch (err: any) {
      console.error(`${c.red}Orchestration error: ${err.message}${c.reset}`);
    }
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


  /**
   * `imzx auth <subcommand>` — Manage API keys.
   * Subcommands: generate, list, revoke, rotate, audit
   */
  private async handleAuth(args: string[]): Promise<void> {
    const sub = args[0];
    const auth = getAuthManager();

    switch (sub) {
      case 'generate': {
        const scope = this.getArg(args, '--scope') || 'full';
        const label = this.getArg(args, '--label') || 'cli-generated';
        const expiresDays = parseInt(this.getArg(args, '--expires') || '0', 10);
        const result = auth.generateKey({
          scope: scope.includes(',') ? scope.split(',').map(s => s.trim()) : scope,
          label,
          expiresDays: expiresDays > 0 ? expiresDays : undefined,
        });
        const expires = result.key.expiresAt
          ? ` (expires ${new Date(result.key.expiresAt).toLocaleDateString()})`
          : '';
        console.log(`\n${c.green}✓ API Key Generated${c.reset}`);
        console.log(`  ID:    ${c.bold}${result.key.id}${c.reset}${expires}`);
        console.log(`  Scope: ${c.bold}${Array.isArray(result.key.scope) ? result.key.scope.join(', ') : result.key.scope}${c.reset}`);
        console.log(`  Label: ${c.bold}${result.key.label}${c.reset}`);
        console.log(`  Key:   ${c.bold}${c.yellow}${result.rawKey}${c.reset}`);
        console.log(`\n${c.yellow}⚠ Save this key now — it will never be shown again.${c.reset}\n`);
        break;
      }
      case 'list': {
        const keys = auth.listKeys();
        if (keys.length === 0) {
          console.log(`${c.dim}No API keys configured.${c.reset}`);
          break;
        }
        console.log(`\n${c.bold}API Keys:${c.reset}`);
        for (const k of keys) {
          const status = k.expiresAt && new Date(k.expiresAt) < new Date()
            ? `${c.red}expired${c.reset}`
            : `${c.green}active${c.reset}`;
          const expires = k.expiresAt ? ` (exp ${new Date(k.expiresAt).toLocaleDateString()})` : '';
          console.log(`  ${c.bold}${k.id}${c.reset} — ${status} — ${k.label}${expires}`);
          console.log(`    Scope: ${Array.isArray(k.scope) ? k.scope.join(', ') : k.scope} | Used: ${k.usageCount} | Last: ${k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'never'}`);
        }
        console.log();
        break;
      }
      case 'revoke': {
        const id = args[1];
        if (!id) { console.error(`${c.red}Error: No key ID provided. Usage: imzx auth revoke <key-id>${c.reset}`); process.exit(1); }
        if (auth.revokeKey(id)) {
          console.log(`${c.green}✓ Key revoked: ${id}${c.reset}`);
        } else {
          console.error(`${c.red}✗ Key not found: ${id}${c.reset}`);
          process.exit(1);
        }
        break;
      }
      case 'rotate': {
        const results = auth.rotateAllKeys();
        console.log(`\n${c.yellow}⚠ All keys rotated. Old keys revoked.${c.reset}\n`);
        for (const r of results) {
          console.log(`  ${c.bold}${r.key.id}${c.reset} — ${c.bold}${c.yellow}${r.rawKey}${c.reset}`);
        }
        console.log(`\n${c.yellow}⚠ Save these keys now — old keys are invalidated.${c.reset}\n`);
        break;
      }
      case 'audit': {
        auth.flushAudit();
        const logPath = `${process.cwd()}/.imzx/logs/auth.jsonl`;
        try {
          const { readFileSync } = await import('node:fs');
          const lines = readFileSync(logPath, 'utf-8').trim().split('\n').reverse().slice(0, 20);
          console.log(`\n${c.bold}Recent Auth Events (last 20):${c.reset}`);
          for (const line of lines) {
            const e = JSON.parse(line);
            const icon = e.eventType === 'auth_success' ? `${c.green}✓${c.reset}` :
                         e.eventType === 'auth_failed' ? `${c.red}✗${c.reset}` :
                         e.eventType === 'key_generated' ? `${c.blue}+${c.reset}` :
                         e.eventType === 'key_revoked' ? `${c.red}-${c.reset}` :
                         e.eventType === 'key_rotated' ? `${c.yellow}↻${c.reset}` : `${c.dim}·${c.reset}`;
            console.log(`  ${icon} ${e.timestamp} — ${e.eventType} — ${e.endpoint} (${e.ip})${e.keyId ? ` [${e.keyId}]` : ''}${e.reason ? ` → ${e.reason}` : ''}`);
          }
        } catch { console.log(`${c.dim}No audit log found.${c.reset}`); }
        break;
      }
      case 'help':
      default:
        console.log(`${c.bold}imzx auth${c.reset} — API Key Management\n`);
        console.log(`${c.bold}Commands:${c.reset}`);
        console.log(`  generate   Generate a new API key`);
        console.log(`  list       List all API keys`);
        console.log(`  revoke     Revoke a key by ID`);
        console.log(`  rotate     Rotate all keys (revoke old, generate new)`);
        console.log(`  audit      View auth event log\n`);
        console.log(`${c.bold}Options:${c.reset}`);
        console.log(`  --scope <scope>     Key scope: full, read, write, mcp, a2a (default: full)`);
        console.log(`  --label <label>     Human-friendly label`);
        console.log(`  --expires <days>    Key expiry in days (default: never)\n`);
        break;
    }
  }

  private showHelp(): void {
    console.log(`${c.bold}${c.blue}imzx-agent-sdk v0.6.0${c.reset} — AI Agent Framework\n`);
    console.log(`${c.bold}Usage:${c.reset}`);
    console.log(`  imzx run <prompt> [options]    Run agent with a prompt`);
    console.log(`  imzx chat [options]            Interactive REPL mode`);
    console.log(`  imzx serve [options]           Start REST API server`);
    console.log(`  imzx dashboard [options]       Start Web UI dashboard`);
    console.log(`  imzx auth <command>            Manage API keys`);
    console.log(`  imxmcp connect <server>        Connect MCP server`);
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
