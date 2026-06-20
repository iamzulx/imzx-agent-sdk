#!/usr/bin/env node
/**
 * imzx CLI — Self-contained entry point.
 * No external arg-parser deps. Built-in .env loader. ANSI help.
 *
 * Usage:
 *   imzx run "prompt" [--persona X] [--stream] [--budget-usd N] [--model X] [--verbose]
 *   imzx chat [--persona X]
 *   imzx serve [--port 3000]
 *   imzx config set <key> <value>
 *   imzx config show
 *   imzx personas list
 *   imzx mcp connect <server>
 *   imzx stats
 *   imzx help | imzx --help
 *   imzx --version
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { register } from 'node:module';

// ── ANSI helpers (zero deps) ──────────────────────────────────────────────
const esc = (code) => `\x1b[${code}m`;
const bold = (s) => `${esc(1)}${s}${esc(22)}`;
const dim = (s) => `${esc(2)}${s}${esc(22)}`;
const red = (s) => `${esc(31)}${s}${esc(39)}`;
const green = (s) => `${esc(32)}${s}${esc(39)}`;
const yellow = (s) => `${esc(33)}${s}${esc(39)}`;
const blue = (s) => `${esc(34)}${s}${esc(39)}`;
const magenta = (s) => `${esc(35)}${s}${esc(39)}`;
const cyan = (s) => `${esc(36)}${s}${esc(39)}`;

// ── Read version from package.json ────────────────────────────────────────
let VERSION = '0.6.0';
try {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
  VERSION = pkg.version || VERSION;
} catch { /* fallback */ }

// ── Load .env files (cwd + ~/.imzx/.env) — no dotenv dep for CLI entry ───
function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, 'utf-8').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx < 1) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnvFile(resolve(process.cwd(), '.env'));
loadEnvFile(join(homedir(), '.imzx', '.env'));

// ── Minimal argv parser ──────────────────────────────────────────────────
function parseArgs(argv) {
  const result = { command: '', subcommand: '', positional: [], flags: {} };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        result.flags[key] = next;
        i += 2;
      } else {
        result.flags[key] = true;
        i++;
      }
    } else if (arg.startsWith('-')) {
      const key = arg.slice(1);
      const next = argv[i + 1];
      if (key === 'v') { result.flags['verbose'] = true; i++; continue; }
      if (next && !next.startsWith('-')) {
        result.flags[key] = next;
        i += 2;
      } else {
        result.flags[key] = true;
        i++;
      }
    } else {
      result.positional.push(arg);
      i++;
    }
  }
  result.command = result.positional[0] || '';
  result.subcommand = result.positional[1] || '';
  return result;
}

// ── Help text ─────────────────────────────────────────────────────────────
function showHelp() {
  console.log(`
${bold(blue(`imzx-agent-sdk v${VERSION}`))} ${dim('— High-performance AI Agent Framework')}

${bold('USAGE')}
  ${green('imzx')} ${cyan('run')} ${dim('"prompt"')} ${dim('[options]')}        Run agent with a prompt
  ${green('imzx')} ${cyan('chat')} ${dim('[options]')}                   Interactive REPL mode
  ${green('imzx')} ${cyan('serve')} ${dim('[--port 3000]')}              Start REST API server
  ${green('imzx')} ${cyan('config')} ${dim('set|show')}                  Manage configuration
  ${green('imzx')} ${cyan('personas')} ${dim('list')}                    List available personas
  ${green('imzx')} ${cyan('mcp')} ${dim('connect <server>')}            Connect MCP server
  ${green('imzx')} ${cyan('stats')}                                   Show session statistics
  ${green('imzx')} ${cyan('help')}                                    Show this help
  ${green('imzx')} ${dim('--version')}                                 Print version

${bold('RUN OPTIONS')}
  ${yellow('--persona')} ${dim('<name>')}     Persona to use ${dim('(default: general-purpose)')}
  ${yellow('--stream')}                    Enable streaming ${dim('(default: on)')}
  ${yellow('--no-stream')}                Disable streaming
  ${yellow('--budget-usd')} ${dim('<N>')}     Max cost per session ${dim('(default: 5.00)')}
  ${yellow('--model')} ${dim('<name>')}       Override LLM model
  ${yellow('--verbose')}                   Verbose/debug output

${bold('SERVER OPTIONS')}
  ${yellow('--port')} ${dim('<port>')}        Port to listen on ${dim('(default: 3000)')}
  ${yellow('--host')} ${dim('<host>')}        Bind address ${dim('(default: 127.0.0.1)')}

${bold('ENVIRONMENT')}
  ${dim('OPENROUTER_API_KEY')}   LLM provider key
  ${dim('IMZX_MODEL')}           Default model ${dim('(default: anthropic/claude-sonnet-4)')}
  ${dim('IMZX_API_KEY')}         API auth key for serve mode

${dim('Env files auto-loaded:')} ./.env ${dim('and')} ~/.imzx/.env
`);
}

// ── Attempt tsx registration ──────────────────────────────────────────────
let tsxAvailable = true;
try {
  register('tsx/esm', pathToFileURL('./'));
} catch {
  tsxAvailable = false;
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const { command, subcommand, positional, flags } = parsed;

  // --version / -V
  if (flags.version) {
    console.log(`imzx-agent-sdk v${VERSION}`);
    process.exit(0);
  }

  // help
  if (command === 'help' || command === '--help' || command === '-h' || !command) {
    showHelp();
    process.exit(0);
  }

  // Graceful tsx fallback
  if (!tsxAvailable) {
    console.error(yellow('⚠ tsx not found — attempting plain Node.js import'));
    console.error(dim('  Install tsx for full TypeScript support: npm i -D tsx'));
  }

  // Build args for CliHandler (positional args as command + rest)
  const cliArgs = positional.slice(); // e.g. ['run', 'hello']

  // Map parsed flags back into --flag value pairs for CliHandler
  for (const [key, val] of Object.entries(flags)) {
    if (key === 'verbose' || key === 'v') {
      if (!cliArgs.includes('--verbose')) cliArgs.push('--verbose');
    } else if (val === true) {
      cliArgs.push(`--${key}`);
    } else {
      cliArgs.push(`--${key}`, String(val));
    }
  }

  // Dynamic import the CliHandler
  try {
    const { CliHandler } = await import('../interfaces/cli/cli-handler.ts');
    const personaDir = resolve(process.cwd(), 'domain', 'personas');
    const verbose = !!flags.verbose;
    const handler = new CliHandler(personaDir, { verbose });
    await handler.handle(cliArgs);
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'MODULE_NOT_FOUND') {
      console.error(red(`✗ Module load failed: ${err.message}`));
      if (!tsxAvailable) {
        console.error(yellow('  → Install tsx: npm i -D tsx'));
      }
      process.exit(1);
    }
    throw err;
  }
}

main().catch((err) => {
  console.error(red(`✗ Fatal: ${err.message}`));
  process.exit(1);
});
