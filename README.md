# imzx-agent-sdk

A **self-improving** AI Agent framework — Rust core (NAPI-RS) + TypeScript orchestration with Clean Architecture.

[![CI](https://github.com/iamzulx/imzx-agent-sdk/actions/workflows/main.yml/badge.svg)](https://github.com/iamzulx/imzx-agent-sdk/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.5.0-blue)](https://github.com/iamzulx/imzx-agent-sdk)

## What Makes This Different

imzx is not just another agent framework — it **learns and improves over time**:

- **Persistent Memory** — remembers user preferences, corrections, and knowledge across sessions
- **Self-Reflection** — evaluates its own performance after every task, extracts lessons
- **Skill System** — auto-saves successful workflows as reusable skills
- **Self-Modification** — tracks performance trends, optimizes tool sequences

Based on: [Reflexion](https://arxiv.org/abs/2303.11366) (Princeton/MIT), [HyperAgents](https://arxiv.org/abs/2603.19461) (Meta/Oxford 2026), [SAGE](https://arxiv.org/abs/2605.12061) (Peking University 2026)

## Features

| Category | Features |
|----------|----------|
| **Agent Core** | ReAct loop, OpenAI function calling, streaming, 10 real tools |
| **Intelligence** | Persistent memory, self-reflection, skill system, self-modification |
| **Security** | SSRF protection, command allowlist, tool approval, budget cap |
| **Interface** | CLI (8 subcommands), REST API (OpenAI-compatible), SDK (programmatic) |
| **Orchestration** | 6 strategies: Router, Hierarchical, Consensus, Chaining, Evaluator-Optimizer, Parallelization |
| **Infrastructure** | MCP client, hooks system, subagents, context engineering, observability |

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/iamzulx/imzx-agent-sdk.git
cd imzx-agent-sdk
npm install --ignore-scripts

# 2. Configure API key
cp .env.example .env
# Edit .env → set OPENROUTER_API_KEY or ANTHROPIC_API_KEY

# 3. Run
npx tsx interfaces/cli/cli-handler.ts run "What files are in this directory?"
```

## Usage

### CLI

```bash
# Single prompt
npx tsx interfaces/cli/cli-handler.ts run "Explain Rust ownership"

# With persona and budget
npx tsx interfaces/cli/cli-handler.ts run "Debug this code" --persona general-purpose --budget-usd 1.0

# Interactive REPL (multi-turn conversation with memory)
npx tsx interfaces/cli/cli-handler.ts chat

# REST API server
npx tsx interfaces/cli/cli-handler.ts serve --port 3000

# List personas
npx tsx interfaces/cli/cli-handler.ts personas list
```

### REPL Commands

| Command | Description |
|---------|-------------|
| `/stats` | Show session statistics (tokens, cost, requests) |
| `/persona <name>` | Switch persona mid-conversation |
| `/history` | Show conversation info |
| `/reset` | Clear conversation history |
| `/clear` | Clear screen |
| `/help` | Show all commands |
| `/exit` | Quit (or Ctrl+C twice) |

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

# With API authentication
curl -X POST http://localhost:3000/api/run \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Hello!"}'

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

## Tools (10 Real Tools)

| Tool | Description | Approval |
|------|-------------|----------|
| `read_file` | Read file contents | No |
| `write_file` | Create/overwrite files | Yes |
| `edit_file` | Partial file edit (find & replace) | Yes |
| `list_directory` | List files and directories | No |
| `run_command` | Execute shell commands (allowlist) | Yes |
| `search_files` | Search text in files (grep) | No |
| `web_search` | Search the web (DuckDuckGo) | No |
| `web_fetch` | Fetch URL content (HTTPS-only) | No |
| `calculate` | Math expressions (safe evaluator) | No |
| `run_code` | Execute JS/Python code snippets | Yes |

## Self-Improving Architecture

```
User sends message
  ↓
AgentBrain.processUserMessage()
  ├─ Detect preferences ("jangan pakai X" → save preference)
  ├─ Detect corrections ("salah" → save correction with high priority)
  ↓
AgentBrain.buildEnhancedPrompt()
  ├─ Inject persistent memory (user prefs, corrections, knowledge)
  ├─ Inject reflections (lessons from past tasks)
  ├─ Inject relevant skills (proven workflows)
  ├─ Inject performance context (success rate, trend)
  ↓
ReAct Loop (think → tool call → observe → repeat)
  ├─ AgentBrain.onToolUse() — track each tool call
  ├─ Budget enforcement — check token/USD limits
  ├─ Context compaction — auto-compact at 80% limit
  ├─ Error recovery — retry with exponential backoff
  ↓
Task Complete
  ↓
AgentBrain.onTaskEnd()
  ├─ ReflectionEngine — evaluate: what worked, what failed, lessons
  ├─ SelfModifier — record performance metric, analyze trend
  ├─ SkillManager — auto-extract skill from successful multi-tool tasks
  ├─ PersistentMemory — save session summary
  ↓
Next task → agent is smarter (has memory + lessons + skills)
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENROUTER_API_KEY` | OpenRouter API key | — |
| `ANTHROPIC_API_KEY` | Anthropic API key | — |
| `IMZX_API_KEY` | Custom API key | — |
| `IMZX_LLM_BASE_URL` | Custom LLM endpoint | `https://openrouter.ai/api/v1/chat/completions` |
| `IMZX_MODEL` | Model name | `anthropic/claude-sonnet-4` |
| `IMZX_AUTO_APPROVE` | Skip tool approval prompts | `false` |

### Agent Config

```typescript
const agent = await createAgent({
  persona: 'general-purpose',
  budget: { maxTokens: 500_000, budgetUsd: 5.0 },
});
```

### REST API Config

```bash
# With API key protection
IMZX_API_KEY=my-secret-key npx tsx interfaces/cli/cli-handler.ts serve --port 3000

# Rate limiting: 60 requests/minute per IP (built-in)
```

## Project Structure

```
imzx-agent-sdk/
├── core/                          # Rust core (NAPI-RS)
│   └── src/
│       ├── agent.rs               # ReAct loop + hooks + context
│       ├── tools.rs               # Tool registry + security + calculator
│       ├── llm.rs                 # LLM provider (OpenRouter)
│       ├── hooks.rs               # Middleware lifecycle
│       ├── subagent.rs            # Child agent orchestration
│       ├── streaming.rs           # SSE streaming
│       ├── context_manager.rs     # Token budgeting
│       ├── orchestration.rs       # 6 strategies
│       ├── memory.rs              # Memory management
│       └── lib.rs                 # NAPI-RS + PyO3 bindings
├── adapters/
│   ├── external/
│   │   ├── agent-engine.ts        # Real ReAct loop (TypeScript)
│   │   ├── llm-provider.ts        # OpenAI-compatible client
│   │   ├── rust-bindings-adapter.ts  # NAPI bridge + TS fallback
│   │   └── mcp-adapter.ts         # MCP client
│   ├── memory/
│   │   ├── agent-brain.ts         # Central intelligence coordinator
│   │   ├── persistent-memory.ts   # Cross-session memory
│   │   ├── reflection-engine.ts   # Self-reflection system
│   │   ├── skill-manager.ts       # Skill save/load/search
│   │   └── self-modifier.ts       # Performance tracking + evolution
│   ├── tools/
│   │   ├── tool-executor.ts       # 10 real tool implementations
│   │   ├── prompts.ts             # Engineered system prompts
│   │   └── agent-logger.ts        # JSONL observability
│   └── persistence/
│       └── file-persona-repository.ts
├── domain/                        # Domain layer (pure types)
│   ├── personas/                  # Persona schema + repository
│   └── ports/                     # AgentEnginePort interface
├── application/                   # Application layer (services)
│   └── agent-service.ts           # Main orchestrator
├── interfaces/
│   ├── cli/cli-handler.ts         # Full CLI (8 subcommands)
│   ├── api/server.ts              # REST API + SSE + rate limit + auth
│   └── sdk/index.ts               # Programmatic API
├── .imzx/                         # Agent data (auto-created)
│   ├── memory.json                # Persistent memory store
│   ├── skills/                    # Saved skills
│   ├── metrics.json               # Performance metrics
│   ├── modifications.json         # Self-modification audit log
│   └── logs/                      # JSONL observability logs
├── docs/architecture.md           # Architecture documentation
├── ROADMAP.md                     # Development roadmap
├── CLAUDE.md                      # AI assistant context
├── LICENSE                        # MIT License
└── package.json
```

## How The Agent Learns

### 1. From User Corrections
```
User: "Salah, jangan pakai TypeScript, pakai JavaScript"
→ Agent saves correction to memory (importance: 9)
→ Next task: system prompt includes "User prefers JavaScript"
```

### 2. From Task Outcomes
```
Task failed after using web_search 3 times
→ Reflection: "Web search returned irrelevant results"
→ Lesson saved: "Try different query strategies when search fails"
→ Next similar task: lesson injected into prompt
```

### 3. From Successful Workflows
```
Task succeeded using: read_file → edit_file → run_command (git commit)
→ Skill auto-extracted: "file-edit-and-commit"
→ Next similar task: skill loaded with steps and gotchas
```

### 4. From Performance Trends
```
After 10 tasks: success rate 70%, trend improving
→ Performance context injected: "Success rate: 70%, trend: improving"
→ Agent has context about its own reliability
```

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Core Engine | Rust + NAPI-RS | High-performance agent loop, tool execution |
| Orchestration | TypeScript (ESM) | Agent service, memory, reflection, skills |
| LLM Client | fetch (native) | OpenAI-compatible API calls |
| Memory | JSON file | Persistent cross-session storage |
| Validation | Zod | Runtime type safety |
| CI | GitHub Actions | Rust fmt/clippy/test + TypeScript typecheck |

## License

MIT License — Copyright (c) 2026 Iamzulx

See [LICENSE](LICENSE) for details.
