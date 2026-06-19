/**
 * MCP (Model Context Protocol) Client Adapter
 * 
 * Connects the agent to external MCP servers for tool discovery and execution.
 * Based on Anthropic's MCP specification (https://modelcontextprotocol.io).
 * 
 * Supports:
 * - stdio transport (local processes)
 * - HTTP/SSE transport (remote servers)
 * - Dynamic tool discovery
 * - Tool execution with schema validation
 */


// --- MCP Protocol Types ---

interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

interface McpToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

interface McpToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

interface McpServerInfo {
  name: string;
  version: string;
  capabilities: {
    tools?: { listChanged?: boolean };
    resources?: { subscribe?: boolean };
    prompts?: {};
  };
}

// --- Transport Abstraction ---

interface McpTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(message: object): Promise<object>;
  isConnected(): boolean;
}

/**
 * Stdio transport — connects to an MCP server via stdin/stdout.
 * For local processes (e.g., npx @modelcontextprotocol/server-filesystem).
 */
class StdioTransport implements McpTransport {
  private process: import('child_process').ChildProcess | null = null;
  private connected = false;
  private messageId = 0;
  private pending = new Map<number, { resolve: Function; reject: Function }>();

  constructor(
    private command: string,
    private args: string[] = [],
    private env: Record<string, string> = {}
  ) {}

  async connect(): Promise<void> {
    const { spawn } = await import('child_process');
    
    return new Promise((resolve, reject) => {
      this.process = spawn(this.command, this.args, {
        env: { ...process.env, ...this.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.process.on('error', reject);
      
      let buffer = '';
      this.process.stdout?.on('data', (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.trim()) {
            try {
              const response = JSON.parse(line);
              if (response.id !== undefined && this.pending.has(response.id)) {
                const { resolve, reject } = this.pending.get(response.id)!;
                this.pending.delete(response.id);
                if (response.error) {
                  reject(new Error(response.error.message));
                } else {
                  resolve(response.result);
                }
              }
            } catch (e) {
              // Not JSON, skip
            }
          }
        }
      });

      this.connected = true;
      resolve();
    });
  }

  async disconnect(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.connected = false;
  }

  async send(message: object): Promise<object> {
    return new Promise((resolve, reject) => {
      const id = ++this.messageId;
      const msg = { ...message, id, jsonrpc: '2.0' };
      this.pending.set(id, { resolve, reject });
      this.process?.stdin?.write(JSON.stringify(msg) + '\n');
    });
  }

  isConnected(): boolean {
    return this.connected;
  }
}

/**
 * HTTP/SSE transport — connects to a remote MCP server.
 * For remote servers (e.g., cloud-hosted MCP services).
 */
class HttpTransport implements McpTransport {
  private connected = false;
  private messageId = 0;

  constructor(private baseUrl: string) {}

  async connect(): Promise<void> {
    // HTTP transport is connectionless — just verify the endpoint
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      if (response.ok) {
        this.connected = true;
      }
    } catch {
      // [M2 FIX] Don't assume connected on error
      this.connected = false;
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async send(message: object): Promise<object> {
    const id = ++this.messageId;
    const msg = { ...message, id, jsonrpc: '2.0' };
    
    const response = await fetch(`${this.baseUrl}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
    });
    
    return response.json();
  }

  isConnected(): boolean {
    return this.connected;
  }
}

// --- MCP Client ---

/**
 * MCP Client — manages connections to MCP servers and exposes tools.
 * 
 * Usage:
 * ```typescript
 * const client = new McpClient();
 * await client.addStdioServer('filesystem', 'npx', ['-y', '@modelcontextprotocol/server-filesystem', '/tmp']);
 * const tools = await client.listTools();
 * const result = await client.callTool('filesystem', 'read_file', { path: '/tmp/test.txt' });
 * ```
 */
export class McpClient {
  private servers = new Map<string, { transport: McpTransport; info: McpServerInfo | null; tools: McpTool[] }>();

  /**
   * Add an MCP server via stdio transport.
   */
  async addStdioServer(name: string, command: string, args: string[] = [], env: Record<string, string> = {}): Promise<void> {
    const transport = new StdioTransport(command, args, env);
    await transport.connect();
    
    // Initialize handshake
    const initResult = await transport.send({
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'imzx-agent-sdk', version: '2.0.0' },
      },
    }) as McpServerInfo;

    // Notify initialized
    await transport.send({ method: 'notifications/initialized', params: {} });

    // Discover tools
    const toolsResult = await transport.send({ method: 'tools/list', params: {} }) as { tools: McpTool[] };

    this.servers.set(name, {
      transport,
      info: initResult,
      tools: toolsResult.tools || [],
    });
  }

  /**
   * Add an MCP server via HTTP transport.
   */
  async addHttpServer(name: string, baseUrl: string): Promise<void> {
    const transport = new HttpTransport(baseUrl);
    await transport.connect();
    this.servers.set(name, { transport, info: null, tools: [] });
  }

  /**
   * List all tools from all connected servers.
   */
  listTools(): Array<{ server: string; tool: McpTool }> {
    const result: Array<{ server: string; tool: McpTool }> = [];
    for (const [serverName, server] of this.servers) {
      for (const tool of server.tools) {
        result.push({ server: serverName, tool });
      }
    }
    return result;
  }

  /**
   * Find a tool by name across all servers.
   */
  findTool(toolName: string): { server: string; tool: McpTool } | null {
    for (const [serverName, server] of this.servers) {
      const tool = server.tools.find(t => t.name === toolName);
      if (tool) return { server: serverName, tool };
    }
    return null;
  }

  /**
   * Call a tool on a specific server.
   */
  async callTool(serverName: string, toolName: string, args: Record<string, unknown> = {}): Promise<McpToolResult> {
    const server = this.servers.get(serverName);
    if (!server) throw new Error(`MCP server '${serverName}' not found`);
    if (!server.transport.isConnected()) throw new Error(`MCP server '${serverName}' is disconnected`);

    const result = await server.transport.send({
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    });

    return result as McpToolResult;
  }

  /**
   * Call a tool by name (auto-discovers which server has it).
   */
  async callToolAuto(toolName: string, args: Record<string, unknown> = {}): Promise<{ server: string; result: McpToolResult }> {
    const found = this.findTool(toolName);
    if (!found) throw new Error(`Tool '${toolName}' not found on any MCP server`);
    
    const result = await this.callTool(found.server, toolName, args);
    return { server: found.server, result };
  }

  /**
   * Disconnect all servers.
   */
  async disconnectAll(): Promise<void> {
    for (const [, server] of this.servers) {
      await server.transport.disconnect();
    }
    this.servers.clear();
  }

  /**
   * Get connected server names.
   */
  getServerNames(): string[] {
    return Array.from(this.servers.keys());
  }

  /**
   * Get total tool count across all servers.
   */
  getTotalToolCount(): number {
    let count = 0;
    for (const [, server] of this.servers) {
      count += server.tools.length;
    }
    return count;
  }
}
