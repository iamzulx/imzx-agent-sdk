# Project: imzx-agent-sdk

**Self-improving** AI Agent framework — Rust core (NAPI-RS) + TypeScript orchestration with Clean Architecture.

## Quick Start

```bash
npm install --ignore-scripts
cp .env.example .env  # Set API key
imzx run "Hello"              # Single command (after npm install -g .)
imzx chat                     # Interactive REPL
imzx serve --port 3000        # REST API server
imzx dashboard --port 3100    # Web UI dashboard
```

## Architecture

Clean Architecture with 4 layers:
- **Domain** (`domain/`): Pure types — Persona, AgentEnginePort
- **Application** (`application/`): AgentService orchestrator
- **Adapters** (`adapters/`): AgentEngine, LlmProvider, Tools, Memory, MCP, A2A, Plugins
- **Interfaces** (`interfaces/`): CLI, REST API, SDK, Dashboard

## Self-Improving System (v0.8.2)

The agent learns and improves over time via 8 intelligence layers:

1. **PersistentMemory** — Cross-session memory (user prefs, corrections, knowledge)
2. **ReflectionEngine** — Self-reflection after tasks (Reflexion pattern)
3. **SkillManager** — Auto-save/search reusable skills
4. **SelfModifier** — Performance tracking, trend analysis, workflow optimization
5. **KnowledgeGraph** — Entity-relationship memory (persistent JSON, Mem0-inspired)
6. **AgentBrain** — Central coordinator wiring all systems into ReAct loop
7. **TfIdfEmbedder** — Zero-dependency semantic search (TF-IDF + cosine similarity)
8. **AgentEvaluator** — Deterministic replay, benchmark suite, evaluation reports

## Key Features

| Category | Features |
|----------|----------|
| **Agent Core** | ReAct loop, OpenAI function calling, streaming, 10 real tools |
| **Intelligence** | Memory, reflection, skills, self-mod, knowledge graph, embeddings |
| **Security** | SSRF protection, command allowlist, tool approval, budget cap, guardrails |
| **Interface** | CLI (single command), REST API (OpenAI-compatible), SDK (TS+Python), Dashboard |
| **Orchestration** | 6 strategies: Router, Hierarchical, Consensus, Chaining, Eval-Optimizer, Parallel |
| **Protocols** | MCP client/server, A2A protocol (Google), multi-provider LLM |
| **DevOps** | Docker, cross-platform binary scripts, CI (GitHub Actions) |

## Tools (10)

read_file, write_file, edit_file, list_directory, run_command, search_files, web_search, web_fetch, calculate, run_code

## CLI Commands

```bash
imzx run "prompt" [--persona X] [--stream] [--budget-usd N] [--model X]
imzx chat [--persona X]
imzx serve [--port 3000] [--host 0.0.0.0]
imzx config set <key> <value>
imzx config show
imzx personas list
imzx mcp connect <server>
imzx stats
imzx help / imzx --version
```

## New Modules (v0.8.2)

| Module | File | Description |
|--------|------|-------------|
| A2A Protocol | `adapters/external/a2a-adapter.ts` | Google A2A agent-to-agent protocol |
| TF-IDF Embeddings | `adapters/memory/embeddings.ts` | Zero-dep semantic search |
| Conversation Checkpoint | `adapters/memory/conversation-checkpoint.ts` | Auto-save, crash recovery |
| MCP Server Mode | `adapters/tools/mcp-server-mode.ts` | Expose tools as MCP server |
| Plugin System | `adapters/tools/plugin-system.ts` | npm plugins, hot reload, hooks |
| Git Context | `adapters/tools/git-context.ts` | Git-aware agent |
| Project Context | `adapters/tools/project-context.ts` | Auto-load CLAUDE.md, AGENTS.md |
| Orchestration | `adapters/tools/orchestration.ts` | 6 multi-agent strategies |
| Telemetry | `adapters/tools/telemetry.ts` | OpenTelemetry-compatible tracing |
| Dashboard | `interfaces/dashboard/server.ts` | Web UI (dark theme, auto-refresh) |
| Python SDK | `interfaces/sdk/python/imzx.py` | Python wrapper (zero deps) |
| CLI Entry | `bin/imzx.mjs` | Single command with arg parser |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENROUTER_API_KEY` | OpenRouter API key | — |
| `ANTHROPIC_API_KEY` | Anthropic API key | — |
| `OPENAI_API_KEY` | OpenAI API key | — |
| `GROQ_API_KEY` | Groq API key | — |
| `IMZX_API_KEY` | Generic API key | — |
| `IMZX_LLM_BASE_URL` | Custom endpoint | auto-detect |
| `IMZX_MODEL` | Model name | auto-detect |
| `IMZX_AUTO_APPROVE` | Skip tool approval | false |
| `IMZX_POLICY_ENABLED` | Enable Policy Engine for tools | auto (enabled in non-interactive/API mode) |
| `IMZX_DASHBOARD_PORT` | Dashboard port | 3100 |

## Project Structure

```
imzx-agent-sdk/
├── bin/imzx.mjs                    # CLI entry (single command)
├── core/                           # Rust core (NAPI-RS)
│   └── src/ (14 modules)
├── adapters/
│   ├── external/
│   │   ├── agent-engine.ts         # ReAct loop (TypeScript)
│   │   ├── llm-provider.ts         # Multi-provider LLM client
│   │   ├── rust-bindings-adapter.ts # NAPI bridge + TS fallback
│   │   ├── mcp-adapter.ts          # MCP client
│   │   └── a2a-adapter.ts          # A2A protocol (NEW)
│   ├── memory/
│   │   ├── agent-brain.ts          # Central intelligence coordinator
│   │   ├── persistent-memory.ts    # Cross-session memory
│   │   ├── reflection-engine.ts    # Self-reflection
│   │   ├── skill-manager.ts        # Skill system
│   │   ├── self-modifier.ts        # Performance tracking
│   │   ├── knowledge-graph.ts      # Entity-relationship (persistent)
│   │   ├── embeddings.ts           # TF-IDF semantic search (NEW)
│   │   ├── conversation-checkpoint.ts # Auto-save (NEW)
│   │   ├── agent-evaluator.ts      # Evaluation framework
│   │   └── context-summarizer.ts   # Context compression
│   ├── tools/
│   │   ├── tool-executor.ts        # 10 real tools
│   │   ├── plugin-system.ts        # Plugin manager (NEW)
│   │   ├── git-context.ts          # Git-aware agent (NEW)
│   │   ├── project-context.ts      # Project context loading (NEW)
│   │   ├── orchestration.ts        # 6 strategies (NEW)
│   │   ├── mcp-server-mode.ts      # MCP server (NEW)
│   │   ├── telemetry.ts            # OpenTelemetry (NEW)
│   │   ├── security-guardrails.ts  # Input/output validation
│   │   ├── workflow-engine.ts      # DAG orchestration
│   │   ├── output-guard.ts         # Output sanitization
│   │   ├── structured-output.ts    # JSON mode
│   │   └── prompts.ts              # System prompts
│   └── persistence/
│       └── file-persona-repository.ts
│   └── security/
│       ├── auth-manager.ts          # Multi-key auth, audit, IP allowlist
│       └── policy-engine.ts         # Policy-as-Code governance rules
│   └── tools/
│       ├── hitl-manager.ts          # Human-in-the-Loop approval gates
│       ├── llm-judge.ts             # LLM-as-a-Judge evaluation
│       ├── cost-planner.ts          # Cost-aware planning + model routing
│       ├── topology.ts              # Chain/Star/Mesh multi-agent topologies
│       ├── agent-lifecycle.ts       # Agent lifecycle management
│       ├── slm-router.ts            # Small Language Model auto-routing
│       ├── cua-browser.ts           # Computer-Using Agent browser tools
│       └── rag-pipeline.ts          # RAG pipeline (TF-IDF + graph)
├── domain/
│   ├── personas/                   # Persona schema
│   └── ports/                      # AgentEnginePort interface
├── application/
│   ├── agent-service.ts            # Main orchestrator
│   └── use-cases/
├── interfaces/
│   ├── cli/cli-handler.ts          # Full CLI
│   ├── api/server.ts               # REST API + SSE
│   ├── sdk/
│   │   ├── index.ts                # TypeScript SDK
│   │   └── python/imzx.py          # Python SDK (NEW)
│   └── dashboard/server.ts         # Web UI dashboard (NEW)
├── scripts/
│   ├── build-binary.sh             # Cross-platform build (NEW)
│   └── install.sh                  # One-line installer (NEW)
├── Dockerfile                      # Docker build (NEW)
├── docker-compose.yml              # Docker compose (NEW)
├── tests/                          # 6 test files
├── docs/
│   ├── architecture.md
│   └── openapi.yaml
├── DEVELOPMENT_PLAN.md             # Full roadmap
├── ROADMAP.md
├── CHANGELOG.md
└── package.json
```

## Data Directory (.imzx/)

Auto-created at runtime:
- `memory.json` — persistent memory
- `knowledge-graph.json` — entity-relationship graph
- `checkpoints/` — conversation checkpoints
- `skills/` — saved skills
- `metrics.json` — performance metrics
- `replays/` — deterministic replay logs
- `telemetry/` — telemetry spans
- `plugins/` — installed plugins
- `modifications.json` — self-modification audit
- `logs/` — JSONL observability

## CI Pipeline

2 jobs: Rust (fmt + clippy + test + build + audit) + TypeScript (typecheck + tests)

## License

MIT — Copyright (c) 2026 Iamzulx
