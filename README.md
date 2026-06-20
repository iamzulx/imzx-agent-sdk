# imzx-agent-sdk

A **self-improving** AI Agent framework — Rust core (NAPI-RS) + TypeScript orchestration with Clean Architecture.

[![Version](https://img.shields.io/badge/version-0.6.0-blue)](https://github.com/iamzulx/imzx-agent-sdk)
[![npm](https://img.shields.io/npm/v/@imzx/imzx)](https://www.npmjs.com/package/@imzx/imzx)
[![CI](https://github.com/iamzulx/imzx-agent-sdk/actions/workflows/main.yml/badge.svg)](https://github.com/iamzulx/imzx-agent-sdk/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## What Makes This Different

imzx is not just another agent framework — it **learns and improves over time**:

- **Persistent Memory** — remembers user preferences, corrections, and knowledge across sessions
- **Self-Reflection** — evaluates its own performance after every task, extracts lessons
- **Skill System** — auto-saves successful workflows as reusable skills
- **Self-Modification** — tracks performance trends, optimizes tool sequences
- **Knowledge Graph** — entity-relationship memory for structured knowledge
- **Semantic Embeddings** — zero-dependency TF-IDF vector search
- **Git & Project Context** — auto-aware of your codebase and git state
- **Conversation Checkpoints** — crash recovery and deterministic replay

Based on: [Reflexion](https://arxiv.org/abs/2303.11366) (Princeton/MIT), [HyperAgents](https://arxiv.org/abs/2603.19461) (Meta/Oxford 2026), [SAGE](https://arxiv.org/abs/2605.12061) (Peking University 2026)

## Features

| Category | Features |
|----------|----------|
| **Agent Core** | ReAct loop, OpenAI function calling, streaming, 10 real tools |
| **Intelligence** | Persistent memory, self-reflection, skill system, self-modification, knowledge graph, embeddings |
| **Protocols** | MCP client/server, A2A protocol (Google), multi-provider LLM |
| **Orchestration** | 6 strategies: Router, Hierarchical, Consensus, Chaining, Evaluator-Optimizer, Parallelization |
| **Context** | Git-aware agent, project context loading (CLAUDE.md, AGENTS.md) |
| **Plugins** | npm plugin system with hot reload and lifecycle hooks |
| **Production** | HITL approval, LLM-as-a-Judge, cost-aware routing, policy engine, topology patterns |
| **Autonomous** | Agent lifecycle, SLM auto-routing, CUA browser, RAG pipeline |
| **DevOps** | Docker, cross-platform binary scripts, CI (GitHub Actions) |
| **Observability** | OpenTelemetry-compatible telemetry, web dashboard, JSONL logs |
| **Interfaces** | CLI (single command), REST API (OpenAI-compatible), TypeScript SDK, Python SDK, Dashboard |
| **Reliability** | Conversation checkpoints, deterministic replay, evaluation framework |
| **Security** | SSRF protection, command allowlist, tool approval, budget cap, input/output guardrails |

## Quick Start

```bash
# Install from npm
npm install @imzx/imzx

# Run a single prompt
imzx run "Hello, what can you do?"

# Interactive chat
imzx chat

# Start REST API server
imzx serve --port 3000

# Open the dashboard
imzx dashboard --port 3100
```

Or from source:

```bash
git clone https://github.com/iamzulx/imzx-agent-sdk.git
cd imzx-agent-sdk
npm install
cp .env.example .env
# Edit .env → set any API key (auto-detects provider)
npx tsx bin/imzx.mjs run "What files are in this directory?"
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `imzx run "prompt"` | Execute a single prompt |
| `imzx chat` | Interactive REPL with memory |
| `imzx serve` | Start REST API server |
| `imzx dashboard` | Start web UI dashboard |
| `imzx config set <k> <v>` | Configure settings |
| `imzx config show` | Show current config |
| `imzx personas list` | List available personas |
| `imzx mcp connect <server>` | Connect MCP server |
| `imzx mcp serve` | Expose tools as MCP server |
| `imzx plugins list` | List installed plugins |
| `imzx orchestrate <strategy>` | Run multi-agent orchestration |
| `imzx stats` | Show session statistics |
| `imzx help` | Show all commands |
| `imzx --version` | Show version |

## SDK (Programmatic)

### TypeScript

```typescript
import {
  createAgent,
  A2AAdapter,
  Orchestration,
  Telemetry,
  PluginManager,
  GitContext,
  ProjectContext,
  TfIdfEmbedder,
  CheckpointManager,
} from '@imzx/imzx';

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

// A2A Protocol (start a local A2A agent endpoint)
const a2a = new A2AAdapter({
  port: 8080,
  agentCard: {
    name: 'my-agent',
    description: 'An AI agent',
    url: 'http://localhost:8080',
    version: '1.0.0',
    capabilities: { streaming: true, pushNotifications: false },
    skills: [{ id: 'summarize', name: 'Summarize', description: 'Summarize content' }],
  },
  apiKey: process.env.A2A_API_KEY, // [C2 FIX] Optional auth
});
// Discover remote agents
const cards = await a2a.discoverAgents('http://other-agent:8080');
// Send a task to a remote agent
const result = await a2a.sendTask('http://other-agent:8080', {
  id: 'task-1',
  type: 'summarize',
  input: { text: 'Summarize this' },
});

// Orchestration
const orch = new Orchestration(agent);
const result = await orch.run('Router', 'Complex multi-step task');

// Telemetry
const telemetry = new Telemetry();
const span = telemetry.startSpan('task', { prompt: 'Analyze code' });
// ... do work ...
telemetry.endSpan(span, { success: true });

// Plugin Manager
const pm = new PluginManager();
await pm.install('@imzx/plugin-git');
pm.listPlugins();

// Git Context
const git = new GitContext(process.cwd());
const status = await git.getStatus();
const diff = await git.getDiff('HEAD~1');

// Project Context
const proj = new ProjectContext(process.cwd());
await proj.load(); // reads CLAUDE.md, AGENTS.md, .cursorrules

// TF-IDF Embeddings
const embedder = new TfIdfEmbedder();
await embedder.index(['doc1 content', 'doc2 content']);
const results = await embedder.search('query terms');

// Checkpoint Manager
const cp = new CheckpointManager();
await cp.save('session-1', conversationState);
const restored = await cp.load('session-1');
```

### Python

```python
from imzx import ImzxClient

client = ImzxClient(base_url="http://localhost:3000")
response = client.run("What is Rust?")
print(response.text)

# Streaming
for chunk in client.stream("Explain ownership"):
    print(chunk, end="")
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

imzx learns and improves through **8 intelligence layers**:

```
User sends message
  ↓
AgentBrain.processUserMessage()
  ├─ Detect preferences ("jangan pakai X" → save preference)
  ├─ Detect corrections ("salah" → save correction with high priority)
  ↓
AgentBrain.buildEnhancedPrompt() — 8 layers inject context:
  │
  ├─ Layer 1: PersistentMemory
  │   └─ User preferences, corrections, knowledge (cross-session)
  │
  ├─ Layer 2: ReflectionEngine
  │   └─ Lessons from past tasks (what worked, what failed)
  │
  ├─ Layer 3: SkillManager
  │   └─ Proven workflows with steps and gotchas
  │
  ├─ Layer 4: SelfModifier
  │   └─ Performance trends, optimization suggestions
  │
  ├─ Layer 5: KnowledgeGraph
  │   └─ Entity-relationship structured knowledge
  │
  ├─ Layer 6: TfIdfEmbedder
  │   └─ Semantic search via TF-IDF + cosine similarity
  │
  ├─ Layer 7: GitContext
  │   └─ Current branch, diff, status, recent commits
  │
  └─ Layer 8: ProjectContext
      └─ CLAUDE.md, AGENTS.md, .cursorrules from project root
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
  ├─ CheckpointManager — save conversation state for recovery
  ├─ Telemetry — emit trace spans for observability
  ↓
Next task → agent is smarter (has memory + lessons + skills + context)
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENROUTER_API_KEY` | OpenRouter API key | — |
| `ANTHROPIC_API_KEY` | Anthropic API key | — |
| `OPENAI_API_KEY` | OpenAI API key | — |
| `TOGETHER_API_KEY` | Together AI API key | — |
| `GROQ_API_KEY` | Groq API key | — |
| `IMZX_API_KEY` | Generic API key (any provider) | — |
| `IMZX_LLM_BASE_URL` | Custom endpoint URL | auto-detect |
| `IMZX_MODEL` | Model name | auto-detect |
| `IMZX_AUTO_APPROVE` | Skip tool approval | false |
| `IMZX_DASHBOARD_PORT` | Dashboard port | 3100 |
| `IMZX_API_KEY` | Master API key (single-key mode) | — |
| `IMZX_ALLOWED_IPS` | Comma-separated IP allowlist | allow all |
| `IMZX_HMAC_SECRET` | HMAC signing secret for A2A | — |
| `IMZX_TLS_CERT` | TLS certificate path | — |
| `IMZX_TLS_KEY` | TLS private key path | — |

### Agent Config

```typescript
const agent = await createAgent({
  persona: 'general-purpose',
  budget: { maxTokens: 500_000, budgetUsd: 5.0 },
});
```

### REST API

```bash
# Start server
imzx serve --port 3000

# With API key protection
IMZX_API_KEY=my-secret-key imzx serve --port 3000

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

### Dashboard

```bash
imzx dashboard --port 3100
# Opens web UI with dark theme, real-time agent activity, memory browser, performance charts
```

### Docker

```bash
docker build -t imzx-agent .
docker run -p 3000:3000 -p 3100:3100 --env-file .env imzx-agent
```

### MCP Server Mode

```bash
# Expose imzx tools as an MCP server
imzx mcp serve --port 8080

# Any MCP client (Cursor, Claude Code, etc.) can connect and use imzx tools
```

## Project Structure

```
imzx-agent-sdk/
├── bin/imzx.mjs                    # CLI entry (single command)
├── core/                           # Rust core (NAPI-RS)
│   └── src/
│       ├── agent.rs                # ReAct loop + hooks + context
│       ├── tools.rs                # Tool registry + security + calculator
│       ├── llm.rs                  # LLM provider (OpenRouter)
│       ├── hooks.rs                # Middleware lifecycle
│       ├── subagent.rs             # Child agent orchestration
│       ├── streaming.rs            # SSE streaming
│       ├── context_manager.rs      # Token budgeting
│       ├── orchestration.rs        # 6 strategies
│       ├── memory.rs               # Memory management
│       └── lib.rs                  # NAPI-RS + PyO3 bindings
├── adapters/
│   ├── external/
│   │   ├── agent-engine.ts         # Real ReAct loop (TypeScript)
│   │   ├── llm-provider.ts         # Multi-provider LLM client
│   │   ├── rust-bindings-adapter.ts # NAPI bridge + TS fallback
│   │   ├── mcp-adapter.ts          # MCP client
│   │   └── a2a-adapter.ts          # A2A protocol (Google)
│   ├── memory/
│   │   ├── agent-brain.ts          # Central intelligence coordinator
│   │   ├── persistent-memory.ts    # Cross-session memory
│   │   ├── reflection-engine.ts    # Self-reflection system
│   │   ├── skill-manager.ts        # Skill save/load/search
│   │   ├── self-modifier.ts        # Performance tracking + evolution
│   │   ├── knowledge-graph.ts      # Entity-relationship memory
│   │   ├── embeddings.ts           # TF-IDF semantic search
│   │   ├── conversation-checkpoint.ts # Auto-save, crash recovery
│   │   ├── agent-evaluator.ts      # Evaluation framework
│   │   └── context-summarizer.ts   # Context compression
│   ├── tools/
│   │   ├── tool-executor.ts        # 10 real tool implementations
│   │   ├── prompts.ts              # Engineered system prompts
│   │   ├── agent-logger.ts         # JSONL observability
│   │   ├── plugin-system.ts        # Plugin manager
│   │   ├── git-context.ts          # Git-aware agent
│   │   ├── project-context.ts      # Project context loading
│   │   ├── orchestration.ts        # Multi-agent orchestration
│   │   ├── mcp-server-mode.ts      # MCP server
│   │   ├── telemetry.ts            # OpenTelemetry-compatible tracing
│   │   ├── security-guardrails.ts  # Input/output validation
│   │   ├── workflow-engine.ts      # DAG orchestration
│   │   ├── output-guard.ts         # Output sanitization
│   │   └── structured-output.ts    # JSON mode
│   └── persistence/
│       └── file-persona-repository.ts
├── domain/                         # Domain layer (pure types)
│   ├── personas/                   # Persona schema + repository
│   └── ports/                      # AgentEnginePort interface
├── application/                    # Application layer (services)
│   ├── agent-service.ts            # Main orchestrator
│   └── use-cases/
├── interfaces/
│   ├── cli/cli-handler.ts          # Full CLI (14 subcommands)
│   ├── api/server.ts               # REST API + SSE + rate limit + auth
│   ├── sdk/
│   │   ├── index.ts                # TypeScript SDK
│   │   └── python/imzx.py          # Python SDK (zero deps)
│   └── dashboard/
│       └── server.ts               # Web UI dashboard
├── scripts/
│   ├── build-binary.sh             # Cross-platform build
│   └── install.sh                  # One-line installer
├── Dockerfile                      # Docker build
├── docker-compose.yml              # Docker compose
├── tests/                          # 6 test files
├── docs/
│   ├── architecture.md
│   └── openapi.yaml
├── .imzx/                          # Agent data (auto-created)
│   ├── memory.json                 # Persistent memory store
│   ├── knowledge-graph.json        # Entity-relationship graph
│   ├── checkpoints/                # Conversation checkpoints
│   ├── replays/                    # Deterministic replay logs
│   ├── telemetry/                  # Telemetry spans
│   ├── plugins/                    # Installed plugins
│   ├── skills/                     # Saved skills
│   ├── metrics.json                # Performance metrics
│   ├── modifications.json          # Self-modification audit log
│   └── logs/                       # JSONL observability logs
├── README.md
├── ROADMAP.md
├── CHANGELOG.md
├── CLAUDE.md
├── DEVELOPMENT_PLAN.md
├── LICENSE
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

### 5. From Knowledge Graph
```
User mentions "PostgreSQL" and "connection pooling" in multiple tasks
→ KnowledgeGraph links: PostgreSQL --uses--> connection pooling
→ Next task: agent knows project uses PostgreSQL with pooling
```

### 6. From Semantic Search
```
New task: "Fix database migration error"
→ TfIdfEmbedder finds similar past tasks by semantic similarity
→ Injects relevant memories, reflections, and skills automatically
```

### 7. From Git Context
```
Agent detects: uncommitted changes, branch "feature/auth", recent commits
→ Injects git state into system prompt
→ Agent can make contextually aware file changes and commits
```

### 8. From Project Context
```
Agent finds CLAUDE.md in project root: "This is a Next.js 15 project using Turbopack"
→ Injects project conventions, tech stack, and patterns
→ Agent follows project-specific rules automatically
```

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Core Engine | Rust + NAPI-RS | High-performance agent loop, tool execution |
| Orchestration | TypeScript (ESM) | Agent service, memory, reflection, skills, orchestration |
| LLM Client | fetch (native) | OpenAI-compatible API calls, multi-provider |
| Memory | JSON file | Persistent cross-session storage |
| Embeddings | TF-IDF (zero-dep) | Semantic search without external dependencies |
| Protocols | A2A, MCP | Agent-to-agent, Model Context Protocol |
| Validation | Zod | Runtime type safety |
| Telemetry | OpenTelemetry-compatible | Distributed tracing, metrics |
| Dashboard | Hono + vanilla JS | Web UI for monitoring and configuration |
| Container | Docker | Reproducible deployments |
| Python SDK | Python 3 (zero deps) | Programmatic access from Python |
| CI | GitHub Actions | Rust fmt/clippy/test + TypeScript typecheck |

## License

MIT License — Copyright (c) 2026 Iamzulx

See [LICENSE](LICENSE) for details.
