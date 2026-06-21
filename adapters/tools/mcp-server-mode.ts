/**
 * MCP Server Mode — expose imzx's tools as a full MCP server with stdio transport.
 * Phase 3.1: JSON-RPC 2.0 over stdio, configurable via `imzx mcp serve`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { executeTool, getToolDefinitions } from './tool-executor.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export interface McpServerModeConfig {
  name?: string;
  version?: string;
  logFile?: string;
}

export class McpServerMode {
  private name: string;
  private version: string;
  private running: boolean = false;
  private logFile: string | null;
  private buffer: string = '';

  constructor(config: McpServerModeConfig = {}) {
    this.name = config.name ?? 'imzx-agent-tools';
    this.version = config.version ?? '0.7.1';
    this.logFile = config.logFile ?? null;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    process.stdin.setEncoding('utf-8');
    process.stdout.setEncoding('utf-8');
    process.stdin.resume();

    this.log(`MCP Server '${this.name}' v${this.version} started on stdio`);

    process.stdin.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.processBuffer();
    });

    process.stdin.on('end', () => {
      this.running = false;
      this.log('MCP Server stdin closed');
    });

    // Keep process alive
    await new Promise<void>((resolve) => {
      process.on('SIGINT', () => { this.running = false; resolve(); });
      process.on('SIGTERM', () => { this.running = false; resolve(); });
    });
  }

  stop(): void {
    this.running = false;
    this.log('MCP Server stopped');
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let request: JsonRpcRequest;
      try {
        request = JSON.parse(trimmed) as JsonRpcRequest;
      } catch {
        this.send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        continue;
      }

      this.handleMessage(request).then((response) => {
        if (response) this.send(response);
      }).catch((err: Error) => {
        this.send({ jsonrpc: '2.0', id: request.id ?? null, error: { code: -32603, message: err.message } });
      });
    }
  }

  private async handleMessage(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const { method, params, id } = request;

    // Notifications (no id) — send no response
    if (id === undefined) {
      await this.handleNotification(method, params);
      return null;
    }

    const response: JsonRpcResponse = { jsonrpc: '2.0', id };

    try {
      switch (method) {
        case 'initialize':
          response.result = {
            protocolVersion: '2024-11-05',
            serverInfo: { name: this.name, version: this.version },
            capabilities: {
              tools: { listChanged: false },
            },
          };
          break;

        case 'tools/list': {
          const tools = getToolDefinitions().map(t => ({
            name: t.function.name,
            description: t.function.description,
            inputSchema: t.function.parameters,
          }));
          response.result = { tools };
          break;
        }

        case 'tools/call': {
          const toolParams = params as { name: string; arguments?: Record<string, unknown> };
          if (!toolParams?.name) {
            response.error = { code: -32602, message: 'Missing tool name' };
            break;
          }
          const startTime = Date.now();
          const result = await executeTool(toolParams.name, toolParams.arguments || {});
          const duration = Date.now() - startTime;
          this.log(`Tool call: ${toolParams.name} (${duration}ms)`);
          response.result = { content: [{ type: 'text', text: result }] };
          break;
        }

        case 'ping':
          response.result = {};
          break;

        default:
          response.error = { code: -32601, message: `Method not found: ${method}` };
      }
    } catch (err: any) {
      response.error = { code: -32000, message: err.message || 'Internal error' };
    }

    return response;
  }

  private async handleNotification(method: string, params?: Record<string, unknown>): Promise<void> {
    switch (method) {
      case 'notifications/initialized':
        this.log('Client initialized');
        break;
      case 'notifications/cancelled':
        this.log(`Request cancelled: ${JSON.stringify(params)}`);
        break;
      default:
        this.log(`Unknown notification: ${method}`);
    }
  }

  private send(response: JsonRpcResponse): void {
    const json = JSON.stringify(response);
    process.stdout.write(json + '\n');
    this.log(`>> ${json.substring(0, 200)}`);
  }

  private log(message: string): void {
    if (!this.logFile) return;
    try {
      const dir = path.dirname(this.logFile);
      fs.mkdirSync(dir, { recursive: true });
      const entry = JSON.stringify({ timestamp: new Date().toISOString(), message });
      fs.appendFileSync(this.logFile, entry + '\n', 'utf-8');
    } catch {}
  }
}
