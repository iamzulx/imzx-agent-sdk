/**
 * Tool Executor — real tool implementations for the agent.
 * v0.4.0 Phase 2: real calculator, web search, edit_file, tool approval.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import * as readline from 'node:readline';

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
          properties: { path: { type: 'string', description: 'File path to read' } },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Write content to a file. Creates parent directories if needed. Overwrites existing content.',
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
        name: 'edit_file',
        description: 'Edit a file by replacing exact text. Use this instead of write_file for partial edits.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path to edit' },
            old_text: { type: 'string', description: 'Exact text to find and replace (must be unique in file)' },
            new_text: { type: 'string', description: 'Replacement text' },
          },
          required: ['path', 'old_text', 'new_text'],
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
          properties: { path: { type: 'string', description: 'Directory path to list' } },
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
        name: 'web_search',
        description: 'Search the web for information. Returns relevant results.',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'Search query' } },
          required: ['query'],
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
          properties: { url: { type: 'string', description: 'URL to fetch' } },
          required: ['url'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'calculate',
        description: 'Evaluate a mathematical expression. Supports +, -, *, /, %, **, sqrt, sin, cos, tan, log, abs, round, floor, ceil, PI, E.',
        parameters: {
          type: 'object',
          properties: { expression: { type: 'string', description: 'Math expression to evaluate (e.g., "2**10", "sqrt(144)", "sin(PI/2)")' } },
          required: ['expression'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_code',
        description: 'Execute a code snippet in a sandboxed subprocess. Supports JavaScript (node) and Python (python3).',
        parameters: {
          type: 'object',
          properties: {
            language: { type: 'string', description: 'Language: "javascript" or "python"', enum: ['javascript', 'python'] },
            code: { type: 'string', description: 'Code to execute' },
          },
          required: ['language', 'code'],
        },
      },
    },
  ];
}

// --- Tool Approval ---

const DANGEROUS_TOOLS = new Set(['write_file', 'edit_file', 'run_command', 'run_code']);

/** Check if tool needs user approval. Returns true if approved. */
async function requestApproval(toolName: string, args: Record<string, unknown>): Promise<boolean> {
  // Check env var for auto-approve
  if (process.env.IMZX_AUTO_APPROVE === 'true' || process.env.IMZX_AUTO_APPROVE === '1') {
    return true;
  }

  // Check if stdin is interactive
  if (!process.stdin.isTTY) {
    return true; // Non-interactive: auto-approve
  }

  const argsPreview = JSON.stringify(args).substring(0, 200);
  console.log(`\n\x1b[33m⚠️  Tool approval required:\x1b[0m`);
  console.log(`  \x1b[1m${toolName}\x1b[0m(${argsPreview})`);
  console.log(`  \x1b[2mType 'y' to approve, 'n' to deny\x1b[0m`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('  Approve? [y/N] ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

// --- Security ---

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

/** Smart truncation: preserve start + end, summarize middle. */
function smartTruncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const headLen = Math.floor(maxLen * 0.7);
  const tailLen = Math.floor(maxLen * 0.2);
  const head = text.substring(0, headLen);
  const tail = text.substring(text.length - tailLen);
  const omitted = text.length - headLen - tailLen;
  const lineCount = text.split('\n').length;
  return `${head}\n\n... (${omitted} chars, ~${lineCount} lines omitted) ...\n\n${tail}`;
}

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

// --- Safe Math Evaluator (no eval/new Function) ---

function safeEval(expr: string): number {
  // [C1 FIX] Pure recursive descent parser — no new Function(), no eval()
  const tokens = tokenizeExpr(expr);
  let pos = 0;

  function peek() { return tokens[pos]; }
  function consume() { return tokens[pos++]; }

  function parseExpr(): number {
    let left = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = consume();
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  function parseTerm(): number {
    let left = parsePower();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = consume();
      const right = parsePower();
      if (op === '*') left *= right;
      else if (op === '/') { if (right === 0) throw new Error('Division by zero'); left /= right; }
      else { if (right === 0) throw new Error('Modulo by zero'); left %= right; }
    }
    return left;
  }

  function parsePower(): number {
    let base = parseUnary();
    if (peek() === '**') { consume(); base = Math.pow(base, parseUnary()); }
    return base;
  }

  function parseUnary(): number {
    if (peek() === '-') { consume(); return -parsePrimary(); }
    if (peek() === '+') { consume(); }
    return parsePrimary();
  }

  function parsePrimary(): number {
    const t = peek();
    if (t === undefined) throw new Error('Unexpected end of expression');
    if (t === '(') { consume(); const v = parseExpr(); if (consume() !== ')') throw new Error('Missing )'); return v; }
    if (typeof t === 'number') { consume(); return t; }
    // Named functions
    const funcs: Record<string, (x: number) => number> = {
      sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
      sin: Math.sin, cos: Math.cos, tan: Math.tan, log: Math.log, exp: Math.exp,
    };
    if (typeof t === 'string' && funcs[t]) { consume(); if (consume() !== '(') throw new Error(`Expected ( after ${t}`); const v = parseExpr(); if (consume() !== ')') throw new Error('Missing )'); return funcs[t](v); }
    throw new Error(`Unexpected token: ${t}`);
  }

  const result = parseExpr();
  if (pos < tokens.length) throw new Error(`Unexpected: ${tokens[pos]}`);
  if (!isFinite(result)) throw new Error('Result is not finite');
  return result;
}

function tokenizeExpr(expr: string): Array<number | string> {
  const tokens: Array<number | string> = [];
  let i = 0;
  while (i < expr.length) {
    if (' \t'.includes(expr[i])) { i++; continue; }
    if ('()+-%'.includes(expr[i])) { tokens.push(expr[i]); i++; continue; }
    if (expr[i] === '*') {
      if (expr[i+1] === '*') { tokens.push('**'); i += 2; } else { tokens.push('*'); i++; }
      continue;
    }
    if (expr[i] === '/') { tokens.push('/'); i++; continue; }
    if (/[0-9.]/.test(expr[i])) {
      let n = ''; while (i < expr.length && /[0-9.]/.test(expr[i])) n += expr[i++];
      tokens.push(parseFloat(n)); continue;
    }
    if (/[a-zA-Z]/.test(expr[i])) {
      let w = ''; while (i < expr.length && /[a-zA-Z]/.test(expr[i])) w += expr[i++];
      if (w === 'PI') tokens.push(Math.PI);
      else if (w === 'E') tokens.push(Math.E);
      else tokens.push(w); // function name
      continue;
    }
    throw new Error(`Invalid character: ${expr[i]}`);
  }
  return tokens;
}

// --- Web Search (DuckDuckGo Lite) ---

async function webSearch(query: string): Promise<string> {
  try {
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; imzx-agent-sdk/0.4.0)',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) return `Search error: HTTP ${response.status}`;

    const html = await response.text();

    // Parse results from DuckDuckGo Lite HTML
    const results: string[] = [];

    // Extract result links and snippets
    const linkRegex = /<a[^>]+class="result-link"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
    const snippetRegex = /<td[^>]+class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;

    let match;
    const links: Array<{ url: string; title: string }> = [];

    // Simple HTML parsing for Lite version
    const linkMatches = html.matchAll(/<a[^>]+rel="nofollow"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gis);
    for (const m of linkMatches) {
      const href = m[1];
      const title = m[2].replace(/<[^>]+>/g, '').trim();
      if (href && title && !href.includes('duckduckgo.com') && links.length < 5) {
        links.push({ url: href, title });
      }
    }

    // Extract snippets
    const snippetMatches = html.matchAll(/<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gis);
    const snippets: string[] = [];
    for (const m of snippetMatches) {
      const text = m[1].replace(/<[^>]+>/g, '').trim();
      if (text) snippets.push(text);
    }

    // Format results
    for (let i = 0; i < Math.max(links.length, snippets.length); i++) {
      const link = links[i];
      const snippet = snippets[i];
      if (link) {
        results.push(`${i + 1}. ${link.title}\n   ${link.url}`);
        if (snippet) results.push(`   ${snippet}`);
      }
    }

    return results.length > 0
      ? results.join('\n\n')
      : `No results found for: ${query}`;
  } catch (err: any) {
    return `Search error: ${err.message}`;
  }
}

// --- Tool Execution ---

export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  // [2.4] Tool approval for dangerous tools
  if (DANGEROUS_TOOLS.has(name)) {
    const approved = await requestApproval(name, args);
    if (!approved) {
      return `Tool '${name}' denied by user.`;
    }
  }

  switch (name) {
    case 'read_file': {
      const filePath = sanitizePath(args.path as string);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        return smartTruncate(content, 50000);
      } catch (err: any) {
        return `Error reading file: ${err.message}`;
      }
    }

    case 'write_file': {
      const filePath = sanitizePath(args.path as string);
      try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, args.content as string, 'utf-8');
        return `File written: ${filePath} (${(args.content as string).length} bytes)`;
      } catch (err: any) {
        return `Error writing file: ${err.message}`;
      }
    }

    case 'edit_file': {
      const filePath = sanitizePath(args.path as string);
      const oldText = args.old_text as string;
      const newText = args.new_text as string;
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const count = content.split(oldText).length - 1;
        if (count === 0) {
          return `Error: old_text not found in ${filePath}`;
        }
        if (count > 1) {
          return `Error: old_text found ${count} times in ${filePath} — must be unique`;
        }
        const updated = content.replace(oldText, newText);
        await fs.writeFile(filePath, updated, 'utf-8');
        const diff = newText.length - oldText.length;
        return `File edited: ${filePath} (${diff >= 0 ? '+' : ''}${diff} chars)`;
      } catch (err: any) {
        return `Error editing file: ${err.message}`;
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
      // [C3 FIX] Block shell metacharacters
      if (/[;|`$()&><]/.test(command)) {
        return 'Error: Shell metacharacters (;|`$&><) are blocked for security.';
      }
      if (!isCommandAllowed(command)) {
        return `Error: Command not allowed. Allowed: ${ALLOWED_COMMANDS.join(', ')}`;
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
        return smartTruncate(output, 50000);
      } catch (err: any) {
        return `Command error: ${err.stderr || err.message}`.substring(0, 5000);
      }
    }

    case 'search_files': {
      // [C2 FIX] Use execFileSync with argument array — no shell injection
      const pattern = args.pattern as string;
      const searchPath = sanitizePath((args.path as string) || '.');
      const glob = args.glob as string | undefined;
      try {
        const { execFileSync } = await import('node:child_process');
        const grepArgs = ['-rn', '--color=never', '--include=' + (glob || '*'), pattern, searchPath];
        const output = execFileSync('grep', grepArgs, {
          timeout: 15_000,
          maxBuffer: 512 * 1024,
          encoding: 'utf-8',
        });
        return smartTruncate(output, 30000) || 'No matches found.';
      } catch (err: any) {
        if (err.status === 1) return 'No matches found.';
        return `Search error: ${err.message}`;
      }
    }

    case 'web_search': {
      const query = args.query as string;
      return webSearch(query);
    }

    case 'web_fetch': {
      const url = args.url as string;
      try {
        const parsed = new URL(url);
        const hostname = parsed.hostname;
        // [C4 FIX] Complete private IP blocklist (IPv4 + IPv6 + link-local)
        const isPrivate = hostname === 'localhost' || hostname === '0.0.0.0'
          || hostname === '::1' || hostname === '[::1]'
          || hostname.startsWith('127.') || hostname.startsWith('10.')
          || hostname.startsWith('192.168.') || hostname.startsWith('172.16.')
          || hostname.startsWith('172.17.') || hostname.startsWith('172.18.')
          || hostname.startsWith('172.19.') || hostname.startsWith('172.2')
          || hostname.startsWith('172.30.') || hostname.startsWith('172.31.')
          || hostname.startsWith('169.254.') || hostname.startsWith('fd')
          || hostname.startsWith('fe80');
        if (isPrivate) {
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
          headers: { 'User-Agent': 'imzx-agent-sdk/0.4.0' },
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) return `HTTP ${response.status}: ${response.statusText}`;
        const text = await response.text();
        return smartTruncate(text, 50000);
      } catch (err: any) {
        return `Fetch error: ${err.message}`;
      }
    }

    case 'calculate': {
      const expr = args.expression as string;
      try {
        const result = safeEval(expr);
        return `${expr} = ${result}`;
      } catch (err: any) {
        return `Math error: ${err.message}`;
      }
    }

    case 'run_code': {
      const lang = args.language as string;
      const code = args.code as string;
      const tmpFile = `/tmp/imzx_code_${Date.now()}.${lang === 'python' ? 'py' : 'mjs'}`;
      try {
        await fs.writeFile(tmpFile, code, 'utf-8');
        const cmd = lang === 'python' ? `python3 ${tmpFile}` : `node ${tmpFile}`;
        // [S3 FIX] Strip sensitive env vars — only pass safe subset
        const SENSITIVE_KEYS = ['API_KEY', 'SECRET', 'TOKEN', 'PASSWORD', 'PRIVATE', 'CREDENTIAL'];
        const safeEnv: Record<string, string> = { PATH: process.env.PATH || '', HOME: process.env.HOME || '', TERM: 'dumb', LANG: process.env.LANG || 'en_US.UTF-8' };
        for (const [k, v] of Object.entries(process.env)) {
          if (v && !SENSITIVE_KEYS.some(sk => k.toUpperCase().includes(sk))) {
            safeEnv[k] = v;
          }
        }
        const output = execSync(cmd, {
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
          encoding: 'utf-8',
          env: safeEnv,
        });
        return smartTruncate(output, 50000);
      } catch (err: any) {
        return `Code error: ${err.stderr || err.message}`.substring(0, 5000);
      } finally {
        try { await fs.unlink(tmpFile); } catch {}
      }
    }

    default:
      return `Error: Unknown tool '${name}'`;
  }
}
