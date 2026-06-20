/**
 * A2A (Agent-to-Agent) Protocol Adapter
 * Implements the Google A2A protocol for agent discovery and task delegation.
 * Uses native node:http — no external dependencies.
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

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
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

// ── A2A Adapter ─────────────────────────────────────────────────────────────

export class A2AAdapter {
  private readonly port: number;
  private readonly agentCard: AgentCard;
  private server: Server | null = null;
  private handlers = new Map<string, TaskHandler>();
  private taskStore = new Map<string, A2AResult>();

  constructor(config: { port: number; agentCard: AgentCard }) {
    this.port = config.port;
    this.agentCard = config.agentCard;
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

    const res = await fetch(agentUrl.replace(/\/+$/, '') + '/a2a/tasks/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      sendJson(res, 500, { error: err instanceof Error ? err.message : 'Internal error' });
    }
  }

  // ── Endpoint Handlers ───────────────────────────────────────────────────

  private async handleTaskSend(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = JSON.parse(await readBody(req)) as JsonRpcRequest;
    const task = body.params as unknown as A2ATask;

    if (!task?.type) {
      sendJson(res, 200, jsonRpcError(body.id, -32602, 'Missing task type'));
      return;
    }

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
    const body = JSON.parse(await readBody(req)) as JsonRpcRequest;
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

    // Send initial status
    sendEvent('status', { id: task?.id, status: 'in_progress' } satisfies Partial<A2AResult>);

    if (!task?.type) {
      sendEvent('error', { code: -32602, message: 'Missing task type' });
      sendEvent('done', {});
      res.end();
      return;
    }

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
