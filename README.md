# imzx-agent-sdk

A high-performance AI Agent framework — **Rust core (NAPI-RS) + TypeScript orchestration** with Clean Architecture.

[![CI](https://github.com/iamzulx/imzx-agent-sdk/actions/workflows/main.yml/badge.svg)](https://github.com/iamzulx/imzx-agent-sdk/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.3.0-blue)](https://github.com/iamzulx/imzx-agent-sdk/releases)

## Features

- **Real ReAct Loop** — think → tool call → observe → repeat (actually works, not a stub)
- **6 Built-in Tools** — read/write files, shell commands, search, web fetch
- **Streaming** — SSE chunk-by-chunk delivery with async generators
- **Hooks System** — PreToolUse, PostToolUse, AgentStart/End lifecycle middleware
- **Subagents** — parallel/sequential/map-reduce child agent orchestration
- **Context Engineering** — token budgeting, priority-based compaction, progressive disclosure
- **MCP Client** — connect to external MCP servers (stdio + HTTP transport)
- **6 Orchestration Patterns** — Router, Hierarchical, Consensus, Chaining, Evaluator-Optimizer, Parallelization
- **OpenAI-Compatible API** — REST server with `/api/chat` endpoint
- **Security** — SSRF protection, command allowlist, path sanitization, SecretBox API keys

## Quick Start

```bash
# 1. Clone
git clone https://github.com/iamzulx/imzx-agent-sdk.git
cd imzx-agent-sdk

# 2. Install dependencies
npm install --ignore-scripts

# 3. Configure API key
cp .env.example .env
# Edit .env → set OPENROUTER_API_KEY or ANTHROPIC_API_KEY

# 4. Run
npx tsx interfaces/cli/cli-handler.ts run "What files are in this directory?"
```

## Usage

### CLI

```bash
# Single prompt
npx tsx interfaces/cli/cli-handler.ts run "Explain Rust ownership"

# With persona and budget
npx tsx interfaces/cli/cli-handler.ts run "Debug this code" --persona general-purpose --budget-usd 1.0

# Interactive REPL
npx tsx interfaces/cli/cli-handler.ts chat

# REST API server
npx tsx interfaces/cli/cli-handler.ts serve --port 3000

# List personas
npx tsx interfaces/cli/cli-handler.ts personas list
```

### REST API

```bash
# Start server
npx tsx interfaces/cli/cli-handler.ts serve --port 3000

# Synchronous request
curl -X POST http://localhost:3000/api/run \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Hello!", "persona": "general-purpose"}'

# OpenAI-compatible streaming
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Hello!"}], "stream": true}'

# Health check
curl http://localhost:3000/api/health
```

### SDK (Programmatic)

```typescript
import { createAgent, McpClient } from './interfaces/sdk/index.js';

const agent = await createAgent({
  persona: 'general-purpose',
  budget: { maxTokens: 100_000, budgetUsd: 1.0 },
});

// Synchronous
const response = await agent.run('What is Rust?');

// Streaming
for await (const chunk of agent.stream('Explain ownership')) {
  if (chunk.type === 'text') process.stdout.write(chunk.content);
}

// Stats
const stats = await agent.stats();
console.log(`Tokens: ${stats.totalInputTokens} in / ${stats.totalOutputTokens} out`);
```

### MCP Client

```typescript
import { McpClient } from './adapters/external/mcp-adapter.js';

const mcp = new McpClient();
await mcp.addStdioServer('filesystem', 'npx', ['-y', '@modelcontextprotocol/server-filesystem', '/tmp']);

const tools = mcp.listTools();
const result = await mcp.callToolAuto('read_file', { path: '/tmp/test.txt' });
```

## Configuration

Environment variables (in `.env`):

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENROUTER_API_KEY` | OpenRouter API key | — |
| `ANTHROPIC_API_KEY` | Anthropic API key | — |
| `IMZX_API_KEY` | Generic API key | — |
| `IMZX_LLM_BASE_URL` | Custom LLM endpoint | `https://openrouter.ai/api/v1/chat/completions` |
| `IMZX_MODEL` | Model name | `anthropic/claude-sonnet-4` |

## Architecture

```
CLI / REST API / SDK
  └─ interfaces/ (presentation layer)
      └─ application/ (AgentService — orchestration)
          └─ adapters/
              ├── external/ (AgentEngine, LlmProvider, RustBindingsAdapter, MCP)
              ├── tools/ (ToolExecutor — 6 real tools)
              └── persistence/ (FilePersonaRepository)
                  └─ domain/ (Persona, AgentEnginePort)
                      └─ core/ (Rust — NAPI-RS)
                          ├── agent.rs (ReAct loop + hooks + context)
                          ├── tools.rs (Rust tool implementations)
                          ├── llm.rs (OpenRouter provider)
                          ├── hooks.rs (lifecycle middleware)
                          ├── subagent.rs (child agent orchestration)
                          ├── streaming.rs (SSE chunks)
                          ├── context_manager.rs (token budgeting)
                          └── orchestration.rs (6 strategies)
```

## Project Structure

```
imzx-agent-sdk/
├── core/                          # Rust core (NAPI-RS)
│   ├── src/
│   │   ├── agent.rs               # ReAct loop + hooks + context
│   │   ├── tools.rs               # Tool registry + security
│   │   ├── llm.rs                 # LLM provider (OpenRouter)
│   │   ├── hooks.rs               # Middleware lifecycle
│   │   ├── subagent.rs            # Child agent orchestration
│   │   ├── streaming.rs           # SSE streaming
│   │   ├── context_manager.rs     # Token budgeting
│   │   ├── orchestration.rs       # 6 strategies
│   │   ├── memory.rs              # Memory management
│   │   ├── embedding.rs           # Local embeddings
│   │   ├── strategy.rs            # Weighted scoring
│   │   ├── types.rs               # Value objects
│   │   ├── error.rs               # Error types
│   │   └── lib.rs                 # NAPI-RS + PyO3 bindings
│   └── Cargo.toml
├── domain/                        # Domain layer (pure types)
│   ├── personas/                  # Persona schema + repository
│   └── ports/                     # AgentEnginePort interface
├── application/                   # Application layer (services)
│   ├── agent-service.ts           # Main orchestrator
│   └── use-cases/                 # GetPersonaUseCase
├── adapters/                      # Infrastructure layer
│   ├── external/
│   │   ├── agent-engine.ts        # Real ReAct loop (TypeScript)
│   │   ├── llm-provider.ts        # OpenAI-compatible client
│   │   ├── rust-bindings-adapter.ts  # NAPI-RS bridge
│   │   └── mcp-adapter.ts         # MCP client
│   ├── tools/
│   │   └── tool-executor.ts       # 6 real tool implementations
│   └── persistence/
│       └── file-persona-repository.ts
├── interfaces/                    # Presentation layer
│   ├── cli/
│   │   └── cli-handler.ts         # Full CLI (7 subcommands)
│   ├── api/
│   │   └── server.ts              # REST API + SSE streaming
│   └── sdk/
│       └── index.ts               # Programmatic API
├── docs/
│   └── architecture.md            # Architecture documentation
├── .github/workflows/main.yml     # CI pipeline
├── ROADMAP.md                     # Development roadmap
├── CLAUDE.md                      # AI assistant context
├── LICENSE                        # MIT License
├── package.json                   # Node.js config
└── setup.sh                       # Setup script
```

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Core Engine | Rust + NAPI-RS | High-performance agent loop, tool execution |
| Orchestration | TypeScript (ESM) | Agent service, persona management, API |
| Validation | Zod | Runtime type safety |
| LLM Client | fetch (native) | OpenAI-compatible API calls |
| MCP | Custom client | External tool server integration |
| CI | GitHub Actions | Rust fmt/clippy/test + TypeScript typecheck |

## License

MIT License — Copyright (c) 2026 Iamzulx

See [LICENSE](LICENSE) for details.
