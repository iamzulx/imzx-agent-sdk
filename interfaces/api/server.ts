/**
 * REST API Server — HTTP + WebSocket for remote agent access.
 * 
 * Endpoints:
 *   POST /api/run            — Run agent (sync or streaming)
 *   GET  /api/stream/:id     — SSE stream for a running agent
 *   GET  /api/stats          — Session statistics
 *   GET  /api/personas       — List personas
 *   POST /api/personas       — Create/update persona
 *   GET  /api/health         — Health check
 *   WS   /ws                 — WebSocket for bidirectional streaming
 */

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse, type Server as HttpServer, createServer as createHttpsServer } from 'node:http';
import { readFileSync } from 'node:fs';
import type { AgentService, RunOptions } from '../../application/agent-service.js';
import { getAuthManager } from '../../adapters/security/auth-manager.js';

// --- [S7] Rate Limiter (in-memory, per IP) ---
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

// [H6 FIX] Periodic cleanup to prevent OOM
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, 60_000);

function checkRateLimit(ip: string, maxRequests = 60, windowMs = 60_000): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    // [S6 FIX] Cap map size to prevent OOM — evict expired entries if over limit
    if (rateLimitMap.size > 10_000) {
      for (const [k, v] of rateLimitMap) {
        if (now > v.resetAt) rateLimitMap.delete(k);
      }
      if (rateLimitMap.size > 10_000) {
        const entries = [...rateLimitMap.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
        for (let i = 0; i < entries.length / 2; i++) rateLimitMap.delete(entries[i][0]);
      }
    }
    rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  entry.count++;
  return entry.count <= maxRequests;
}

// --- [S8] API Authentication — Multi-Key with AuthManager ---
function checkAuth(req: IncomingMessage, apiKey?: string): boolean {
  // Backward compatibility: single key from env
  if (apiKey) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return false;
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (token === apiKey) return true;
    // Also try AuthManager for scoped keys
  }

  const authManager = getAuthManager();
  const authHeader = req.headers['authorization'];
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const key = authManager.validateKey(token, 'api', req.socket.remoteAddress || 'unknown');
  return key !== null;
}

export interface ServerOptions {
  port: number;
  host: string;
  /** Optional API key for authentication (IMZX_API_KEY env var) */
  apiKey?: string;
}

/**
 * Create and start the HTTP server.
 */
export async function createServer(agentService: AgentService, options: ServerOptions): Promise<void> {
  const { port, host } = options;


  const server = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Parse URL early for auth/rate checks
    const url = new URL(req.url || '/', `http://${host}:${port}`);
    const method = req.method || 'GET';

    // [S7] IP Allowlist check
    const clientIp = req.socket.remoteAddress || 'unknown';
    const allowedIPsEnv = process.env.IMZX_ALLOWED_IPS;
    if (allowedIPsEnv) {
      const { checkIP } = await import('../../adapters/security/auth-manager.js');
      const allowedIPs = allowedIPsEnv.split(',').map(s => s.trim());
      if (!checkIP(clientIp, allowedIPs)) {
        return jsonResponse(res, 403, { error: 'IP not allowed.' });
      }
    }

    // [S8] Rate limiting
    if (!checkRateLimit(clientIp)) {
      return jsonResponse(res, 429, { error: 'Rate limit exceeded. Max 60 requests per minute.' });
    }

    // [S8] API authentication (skip for health check)
    if (url.pathname !== '/api/health' && !checkAuth(req, options.apiKey)) {
      return jsonResponse(res, 401, { error: 'Unauthorized. Set Authorization: Bearer <key> header.' });
    }

    // CORS headers
    // [S9 FIX] Default CORS to request origin — wildcard only if explicitly configured
    const allowedOrigin = process.env.IMZX_CORS_ORIGIN || req.headers.origin || 'null';
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // --- Route matching ---
      
      if (method === 'GET' && url.pathname === '/api/health') {
        return jsonResponse(res, 200, {
          status: 'ok',
          version: "0.7.1",
          uptime: process.uptime(),
        });
      }

      if (method === 'GET' && url.pathname === '/api/stats') {
        const stats = await agentService.getStats();
        return jsonResponse(res, 200, { stats });
      }

      if (method === 'GET' && url.pathname === '/api/personas') {
        const { readdir, readFile } = await import('node:fs/promises');
        const personaDir = process.cwd() + '/domain/personas';
        try {
          const files = (await readdir(personaDir)).filter(f => f.endsWith('.json'));
          const personas = await Promise.all(files.map(async f => {
            const content = JSON.parse(await readFile(`${personaDir}/${f}`, 'utf-8'));
            return { id: f.replace('.json', ''), ...content };
          }));
          return jsonResponse(res, 200, { personas });
        } catch {
          return jsonResponse(res, 200, { personas: [] });
        }
      }

      if (method === 'POST' && url.pathname === '/api/run') {
        const body = await readBody(req);
        const { persona, prompt, streaming, budget } = JSON.parse(body);

        if (!prompt) {
          return jsonResponse(res, 400, { error: 'prompt is required' });
        }

        const personaName = persona || 'general-purpose';
        // [S5 FIX] Validate persona name — prevent path traversal
        if (!/^[a-zA-Z0-9_-]+$/.test(personaName)) {
          return jsonResponse(res, 400, { error: 'Invalid persona name (alphanumeric, dash, underscore only)' });
        }

        // SSE streaming mode
        if (streaming) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });

          const runOptions: RunOptions = {
            streaming: true,
            budget,
            onChunk: (chunk) => {
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            },
          };

          try {
            const response = await agentService.execute(personaName, prompt, runOptions);
            res.write(`data: ${JSON.stringify({ type: 'done', content: response })}\n\n`);
          } catch (err: any) {
            res.write(`data: ${JSON.stringify({ type: 'error', content: err.message })}\n\n`);
          }

          res.end();
          return;
        }

        // Synchronous mode
        const response = await agentService.execute(personaName, prompt, { streaming: false, budget });
        return jsonResponse(res, 200, { response, persona: personaName });
      }

      if (method === 'POST' && url.pathname === '/api/chat') {
        // Chat completion endpoint — OpenAI-compatible format
        const body = await readBody(req);
        let chatParsed: any;
        try { chatParsed = JSON.parse(body); } catch { return jsonResponse(res, 400, { error: 'Invalid JSON in request body' }); }
        const { messages, model, stream } = chatParsed;

        if (!messages || !Array.isArray(messages)) {
          return jsonResponse(res, 400, { error: 'messages array is required' });
        }

        const lastMessage = messages[messages.length - 1];
        const prompt = lastMessage?.content || '';
        const systemMessage = messages.find((m: any) => m.role === 'system');
        const persona = 'general-purpose'; // Could map from model param

        if (stream) {
          // SSE streaming — OpenAI-compatible format
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });

          const runOptions: RunOptions = {
            streaming: true,
            onChunk: (chunk) => {
              if (chunk.type === 'text') {
                const sseData = {
                  id: `chatcmpl-${Date.now()}`,
                  object: 'chat.completion.chunk',
                  choices: [{
                    index: 0,
                    delta: { content: chunk.content },
                    finish_reason: null,
                  }],
                };
                res.write(`data: ${JSON.stringify(sseData)}\n\n`);
              }
            },
          };

          const response = await agentService.execute(persona, prompt, runOptions);

          // Final chunk
          const finalChunk = {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          };
          res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        // Non-streaming — OpenAI-compatible response
        const response = await agentService.execute(persona, prompt);
        return jsonResponse(res, 200, {
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: response },
            finish_reason: 'stop',
          }],
          usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
          },
        });
      }

      // 404
      return jsonResponse(res, 404, { error: `Not found: ${method} ${url.pathname}` });

    } catch (err: any) {
      console.error(`[API Error] ${err.message}`);
      // [H8 FIX] Don't leak internal details
      console.error(`[API Error] ${err.message}`);
      return jsonResponse(res, 500, { error: 'Internal server error' });
    }
  });

  server.listen(port, host, () => {
    console.log(`\x1b[1m\x1b[34m╔══════════════════════════════════════╗\x1b[0m`);
    console.log(`\x1b[1m\x1b[34m║   imzx-agent-sdk API Server v0.7.1  ║\x1b[0m`);
    console.log(`\x1b[1m\x1b[34m╚══════════════════════════════════════╝\x1b[0m`);
    console.log(`\x1b[32m✓ Server running at http://${host}:${port}\x1b[0m`);
    console.log(`\x1b[2m  POST /api/run          — Run agent (sync/streaming)`);
    console.log(`  POST /api/chat         — OpenAI-compatible chat endpoint`);
    console.log(`  GET  /api/stats        — Session statistics`);
    console.log(`  GET  /api/personas     — List personas`);
    console.log(`  GET  /api/health       — Health check\x1b[0m\n`);
  });
}

// --- Helpers ---

function jsonResponse(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

function readBody(req: IncomingMessage, maxBytes = 1_048_576): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        req.destroy();
        reject(new Error('Request body too large (max 1MB)'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}
