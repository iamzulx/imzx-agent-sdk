/**
 * Tool Executor — real tool implementations for the agent.
 * 
 * Each tool has:
 * 1. OpenAI-compatible function definition (for LLM tool calling)
 * 2. Execution function (actually performs the action)
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

// --- Tool Definitions (OpenAI function calling format) ---

export function getToolDefinitions(): Array<{
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  return [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read the contents of a file at the given path.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Absolute or relative file path to read' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Write content to a file. Creates parent directories if needed.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path to write to' },
            content: { type: 'string', description: 'Content to write' },
          },
          required: ['path', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_directory',
        description: 'List files and directories at the given path.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path to list' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_command',
        description: 'Execute a shell command and return its output. Use for git, npm, cargo, etc.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Shell command to execute' },
            cwd: { type: 'string', description: 'Working directory (optional)' },
          },
          required: ['command'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_files',
        description: 'Search for text pattern in files using grep.',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Text or regex pattern to search for' },
            path: { type: 'string', description: 'Directory to search in (default: current dir)' },
            glob: { type: 'string', description: 'File glob filter (e.g., "*.rs", "*.ts")' },
          },
          required: ['pattern'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'web_fetch',
        description: 'Fetch content from a URL. Returns the response body as text.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to fetch' },
          },
          required: ['url'],
        },
      },
    },
  ];
}

// --- Tool Execution ---

/** Allowed commands for run_command (security allowlist). */
const ALLOWED_COMMANDS = [
  'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'find', 'pwd', 'echo', 'date',
  'git', 'npm', 'npx', 'node', 'tsx', 'tsc',
  'cargo', 'rustc', 'rustfmt', 'clippy',
  'python3', 'pip',
  'curl', 'wget',
];

function isCommandAllowed(command: string): boolean {
  const firstWord = command.trim().split(/\s+/)[0];
  return ALLOWED_COMMANDS.includes(firstWord);
}

/** Security: check path is not traversal. */
function sanitizePath(p: string): string {
  const resolved = path.resolve(p);
  const blocked = ['/etc/shadow', '/etc/passwd', '/proc/self', '/dev'];
  for (const b of blocked) {
    if (resolved.startsWith(b)) {
      throw new Error(`Access denied: ${resolved}`);
    }
  }
  return resolved;
}

export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'read_file': {
      const filePath = sanitizePath(args.path as string);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        return content;
      } catch (err: any) {
        return `Error reading file: ${err.message}`;
      }
    }

    case 'write_file': {
      const filePath = sanitizePath(args.path as string);
      try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, args.content as string, 'utf-8');
        return `File written: ${filePath}`;
      } catch (err: any) {
        return `Error writing file: ${err.message}`;
      }
    }

    case 'list_directory': {
      const dirPath = sanitizePath((args.path as string) || '.');
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        return entries
          .map(e => `${e.isDirectory() ? 'd' : 'f'} ${e.name}`)
          .join('\n');
      } catch (err: any) {
        return `Error listing directory: ${err.message}`;
      }
    }

    case 'run_command': {
      const command = args.command as string;
      if (!isCommandAllowed(command)) {
        return `Error: Command not allowed. First word must be one of: ${ALLOWED_COMMANDS.join(', ')}`;
      }
      try {
        const cwd = args.cwd ? sanitizePath(args.cwd as string) : process.cwd();
        const output = execSync(command, {
          cwd,
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
          encoding: 'utf-8',
          env: { ...process.env, TERM: 'dumb' },
        });
        return output.substring(0, 50000);
      } catch (err: any) {
        return `Command error: ${err.stderr || err.message}`.substring(0, 5000);
      }
    }

    case 'search_files': {
      const pattern = args.pattern as string;
      const searchPath = sanitizePath((args.path as string) || '.');
      const glob = args.glob as string | undefined;
      try {
        const grepArgs = [
          'grep', '-rn', '--color=never',
          '--include=' + (glob || '*'),
          pattern, searchPath,
        ].join(' ');
        const output = execSync(grepArgs, {
          timeout: 15_000,
          maxBuffer: 512 * 1024,
          encoding: 'utf-8',
        });
        return output.substring(0, 30000) || 'No matches found.';
      } catch (err: any) {
        if (err.status === 1) return 'No matches found.';
        return `Search error: ${err.message}`;
      }
    }

    case 'web_fetch': {
      const url = args.url as string;
      try {
        const parsed = new URL(url);
        const hostname = parsed.hostname;
        if (hostname === 'localhost' || hostname.startsWith('127.') || hostname.startsWith('192.168.') || hostname.startsWith('10.') || hostname === '0.0.0.0') {
          return 'Error: Access to private/local addresses is blocked.';
        }
        if (parsed.protocol !== 'https:') {
          return 'Error: Only HTTPS URLs are allowed.';
        }
      } catch {
        return 'Error: Invalid URL.';
      }

      try {
        const response = await fetch(url, {
          headers: { 'User-Agent': 'imzx-agent-sdk/0.3.0' },
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) return `HTTP ${response.status}: ${response.statusText}`;
        const text = await response.text();
        return text.substring(0, 50000);
      } catch (err: any) {
        return `Fetch error: ${err.message}`;
      }
    }

    default:
      return `Error: Unknown tool '${name}'`;
  }
}
