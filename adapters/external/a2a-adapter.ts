/**
 * A2A (Agent-to-Agent) Protocol Adapter
 * Implements the Google A2A protocol for agent discovery and task delegation.
 * Uses native node:http — no external dependencies.
 *
 * [C2 FIX] Security hardening:
 *   - Bearer token authentication (configurable via apiKey)
 *   - Per-IP rate limiting (default: 30 req/min, configurable)
 *   - Input validation: max body size, JSON-RPC schema, task field validation
 *   - Task type allowlist (only registered handlers accepted)
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';

// ── Types ───────────────────────────────────────────────────────────────────

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
}

export interface AgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
  };
  skills: AgentSkill[];
}

export interface A2ATask {
  id: string;
  type: string;
  input: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface A2AResult {
  id: string;
  status: 'completed' | 'failed' | 'in_progress';
  output?: unknown;
  error?: string;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

type TaskHandler = (task: A2ATask) => Promise<A2AResult>;

// ── Helpers ─────────────────────────────────────────────────────────────────

function jsonRpcOk(id: string | number, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id: string | number, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, data } };
}

/** Read request body with a maximum size guard. [H2/C2 FIX] */
function readBody(req: IncomingMessage, maxSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > maxSize) {
        reject(new Error(`Request body exceeds maximum size of ${maxSize} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function generateId(): string {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── [C2 FIX] Rate Limiter ──────────────────────────────────────────────────

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

// Periodic cleanup to prevent OOM from accumulating IP entries
const rateLimitCleanup = setInterval(() => {
  const now = Date.now();
  for (const ip of Array.from(rateLimitMap.keys())) {
    const entry = rateLimitMap.get(ip)!;
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, 60_000);

/** Unref the cleanup timer so it doesn't keep the process alive after stop(). */
rateLimitCleanup.unref();

function checkRateLimit(ip: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  entry.count++;
  return entry.count <= maxRequests;
}

// ── [C2 FIX] Authentication ────────────────────────────────────────────────

function checkAuth(req: IncomingMessage, apiKey: string | undefined): boolean {
  if (!apiKey) return true; // No key configured = open access (dev mode)
  const authHeader = req.headers['authorization'];
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, '');
  return token === apiKey;
}

// ── [C2 FIX] Input Validation ──────────────────────────────────────────────

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB [H2 FIX]

function isValidJsonRpc(body: unknown): body is JsonRpcRequest {
  if (typeof body !== 'object' || body === null) return false;
  const obj = body as Record<string, unknown>;
  if (obj.jsonrpc !== '2.0') return false;
  if (obj.id === undefined || obj.id === null) return false;
  if (typeof obj.method !== 'string' || obj.method.length === 0) return false;
  if (obj.params !== undefined && typeof obj.params !== 'object') return false;
  return true;
}

function isValidTask(task: unknown): task is A2ATask {
  if (typeof task !== 'object' || task === null) return false;
  const obj = task as Record<string, unknown>;
  if (typeof obj.id !== 'string' || obj.id.length === 0) return false;
  if (typeof obj.type !== 'string' || obj.type.length === 0) return false;
  if (typeof obj.input !== 'object' || obj.input === null) return false;
  // Validate id length to prevent abuse
  if (obj.id.length > 256) return false;
  if (obj.type.length > 128) return false;
  return true;
}

// ── A2A Adapter ─────────────────────────────────────────────────────────────

export interface A2AAdapterConfig {
  port: number;
  agentCard: AgentCard;
  /** Optional API key for Bearer token authentication. If unset, auth is disabled. */
  apiKey?: string;
  /** Max requests per IP per window. Default: 30. */
  rateLimitMax?: number;
  /** Rate limit window in milliseconds. Default: 60000 (1 min). */
  rateLimitWindowMs?: number;
  /** Max request body size in bytes. Default: 10MB. */
  maxBodySize?: number;
}

export class A2AAdapter {
  private readonly port: number;
  private readonly agentCard: AgentCard;
  private server: Server | null = null;
  private handlers = new Map<string, TaskHandler>();
  private taskStore = new Map<string, A2AResult>();

  // [C2 FIX] Security config
  private readonly apiKey: string | undefined;
  private readonly rateLimitMax: number;
  private readonly rateLimitWindowMs: number;
  private readonly maxBodySize: number;

  constructor(config: A2AAdapterConfig) {
    this.port = config.port;
    this.agentCard = config.agentCard;
    this.apiKey = config.apiKey ?? process.env.A2A_API_KEY;
    this.rateLimitMax = config.rateLimitMax ?? 30;
    this.rateLimitWindowMs = config.rateLimitWindowMs ?? 60_000;
    this.maxBodySize = config.maxBodySize ?? MAX_BODY_SIZE;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));
      this.server.listen(this.port, () => resolve());
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) { resolve(); return; }
      this.server.close((err) => (err ? reject(err) : resolve()));
      this.server = null;
    });
  }

  registerHandler(taskType: string, handler: TaskHandler): void {
    this.handlers.set(taskType, handler);
  }

  async discoverAgents(url: string): Promise<AgentCard[]> {
    const wellKnown = url.replace(/\/+$/, '') + '/.well-known/agent.json';
    const res = await fetch(wellKnown);
    if (!res.ok) throw new Error(`Discovery failed: ${res.status}`);
    const card = (await res.json()) as AgentCard;
    return [card];
  }

  async sendTask(agentUrl: string, task: A2ATask): Promise<A2AResult> {
    const rpcBody: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: task.id,
      method: 'tasks/send',
      params: task as unknown as Record<string, unknown>,
    };

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    // Forward auth token when calling another A2A agent
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const res = await fetch(agentUrl.replace(/\/+$/, '') + '/a2a/tasks/send', {
      method: 'POST',
      headers,
      body: JSON.stringify(rpcBody),
    });

    if (!res.ok) throw new Error(`sendTask failed: ${res.status}`);
    const rpc = (await res.json()) as JsonRpcResponse;
    if (rpc.error) throw new Error(rpc.error.message);
    return rpc.result as A2AResult;
  }

  // ── HTTP Routing ────────────────────────────────────────────────────────

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://localhost:${this.port}`);
    const method = req.method?.toUpperCase() ?? 'GET';

    // [C2 FIX] Allow agent card discovery without auth (it's public metadata)
    const isPublicEndpoint = method === 'GET' && url.pathname === '/.well-known/agent.json';

    // [C2 FIX] Rate limiting on all endpoints
    const clientIp = req.socket.remoteAddress || 'unknown';
    if (!isPublicEndpoint && !checkRateLimit(clientIp, this.rateLimitMax, this.rateLimitWindowMs)) {
      sendJson(res, 429, jsonRpcError('n/a', -32001, 'Rate limit exceeded'));
      return;
    }

    // [C2 FIX] Authentication check (skip for public agent card discovery)
    if (!isPublicEndpoint && !checkAuth(req, this.apiKey)) {
      sendJson(res, 401, jsonRpcError('n/a', -32000, 'Unauthorized. Set Authorization: Bearer <token> header.'));
      return;
    }

    try {
      // Agent card discovery
      if (method === 'GET' && url.pathname === '/.well-known/agent.json') {
        sendJson(res, 200, this.agentCard);
        return;
      }

      // JSON-RPC task execution
      if (method === 'POST' && url.pathname === '/a2a/tasks/send') {
        await this.handleTaskSend(req, res);
        return;
      }

      // SSE streaming task execution
      if (method === 'POST' && url.pathname === '/a2a/tasks/sendSubscribe') {
        await this.handleTaskSendSubscribe(req, res);
        return;
      }

      // Task status by id
      if (method === 'GET' && url.pathname.startsWith('/a2a/tasks/')) {
        const taskId = url.pathname.split('/').pop();
        const result = taskId ? this.taskStore.get(taskId) : undefined;
        if (result) {
          sendJson(res, 200, result);
        } else {
          sendJson(res, 404, { error: 'Task not found' });
        }
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal error';
      sendJson(res, 500, { error: message });
    }
  }

  // ── Endpoint Handlers ───────────────────────────────────────────────────

  private async handleTaskSend(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // [C2 FIX] Validate body size
    let rawBody: string;
    try {
      rawBody = await readBody(req, this.maxBodySize);
    } catch {
      sendJson(res, 413, jsonRpcError('n/a', -32002, 'Request body too large'));
      return;
    }

    // [C2 FIX] Validate JSON-RPC structure
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      sendJson(res, 200, jsonRpcError('n/a', -32700, 'Parse error: invalid JSON'));
      return;
    }

    if (!isValidJsonRpc(body)) {
      sendJson(res, 200, jsonRpcError('n/a', -32600, 'Invalid JSON-RPC request'));
      return;
    }

    const task = body.params as unknown as A2ATask;

    // [C2 FIX] Validate task structure
    if (!isValidTask(task)) {
      sendJson(res, 200, jsonRpcError(body.id, -32602, 'Invalid task: requires id (string), type (string), and input (object)'));
      return;
    }

    // [C2 FIX] Check handler exists (implicit task type allowlist)
    const handler = this.handlers.get(task.type);
    if (!handler) {
      sendJson(res, 200, jsonRpcError(body.id, -32601, `No handler for task type: ${task.type}`));
      return;
    }

    const result = await handler(task);
    this.taskStore.set(task.id, result);
    sendJson(res, 200, jsonRpcOk(body.id, result));
  }

  private async handleTaskSendSubscribe(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // [C2 FIX] Validate body size
    let rawBody: string;
    try {
      rawBody = await readBody(req, this.maxBodySize);
    } catch {
      // For SSE endpoints, send error as SSE event
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`event: error\ndata: ${JSON.stringify({ code: -32002, message: 'Request body too large' })}\n\n`);
      res.end();
      return;
    }

    // [C2 FIX] Validate JSON
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`event: error\ndata: ${JSON.stringify({ code: -32700, message: 'Parse error: invalid JSON' })}\n\n`);
      res.end();
      return;
    }

    if (!isValidJsonRpc(body)) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`event: error\ndata: ${JSON.stringify({ code: -32600, message: 'Invalid JSON-RPC request' })}\n\n`);
      res.end();
      return;
    }

    const task = body.params as unknown as A2ATask;

    // Set up SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const sendEvent = (event: string, data: unknown): void => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // [C2 FIX] Validate task structure
    if (!isValidTask(task)) {
      sendEvent('error', { code: -32602, message: 'Invalid task: requires id (string), type (string), and input (object)' });
      sendEvent('done', {});
      res.end();
      return;
    }

    // Send initial status
    sendEvent('status', { id: task.id, status: 'in_progress' } satisfies Partial<A2AResult>);

    // [C2 FIX] Check handler exists (implicit task type allowlist)
    const handler = this.handlers.get(task.type);
    if (!handler) {
      sendEvent('error', { code: -32601, message: `No handler for task type: ${task.type}` });
      sendEvent('done', {});
      res.end();
      return;
    }

    try {
      const result = await handler(task);
      this.taskStore.set(task.id, result);
      sendEvent('result', result);
      sendEvent('status', { id: task.id, status: result.status });
    } catch (err) {
      const failResult: A2AResult = {
        id: task.id,
        status: 'failed',
        error: err instanceof Error ? err.message : 'Unknown error',
      };
      this.taskStore.set(task.id, failResult);
      sendEvent('error', { code: -32000, message: failResult.error });
    }

    sendEvent('done', {});
    res.end();
  }
}
