/**
 * MCP Server — expose imzx-agent-sdk tools as an MCP server.
 * Based on: TypeScript MCP Server Guide, MCP specification (2024-11-05).
 * Uses stdio transport for local CLI integration.
 */

import { executeTool, getToolDefinitions } from './tool-executor.js';

export interface McpMessage {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

export class McpServer {
  private serverName: string;
  private serverVersion: string;

  constructor(name: string = 'imzx-agent-tools', version: string = '0.8.2') {
    this.serverName = name;
    this.serverVersion = version;
  }

  async handleMessage(message: McpMessage): Promise<McpMessage> {
    const response: McpMessage = { jsonrpc: '2.0', id: message.id };
    try {
      switch (message.method) {
        case 'initialize':
          response.result = { protocolVersion: '2024-11-05', serverInfo: { name: this.serverName, version: this.serverVersion }, capabilities: { tools: { listChanged: false } } };
          break;
        case 'notifications/initialized':
          return {} as McpMessage;
        case 'tools/list':
          response.result = { tools: getToolDefinitions().map(t => ({ name: t.function.name, description: t.function.description, inputSchema: t.function.parameters })) };
          break;
        case 'tools/call': {
          const params = message.params as { name: string; arguments?: Record<string, unknown> };
          const result = await executeTool(params.name, params.arguments || {});
          response.result = { content: [{ type: 'text', text: result }] };
          break;
        }
        default:
          response.error = { code: -32601, message: `Method '${message.method}' not found` };
      }
    } catch (e: any) {
      response.error = { code: -32000, message: e.message || 'Server error' };
    }
    return response;
  }

  async handleStdio(): Promise<void> {
    process.stdin.setEncoding('utf-8');
    process.stdout.setEncoding('utf-8');
    let buffer = '';
    process.stdin.on('data', async (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const message: McpMessage = JSON.parse(line);
          const response = await this.handleMessage(message);
          if (response.id !== undefined) process.stdout.write(JSON.stringify(response) + '\n');
        } catch {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } }) + '\n');
        }
      }
    });
    process.stderr.write(`MCP Server '${this.serverName}' running on stdio\n`);
  }
}
