# Changelog

All notable changes to imzx-agent-sdk are documented in this file.

## [0.6.1] — 2026-06-20

### Added — Auth System & Security Enhancements
- **Multi-Key Auth Manager** — `adapters/security/auth-manager.ts` (430 lines)
  - Scoped API keys (full, read, write, mcp, a2a) stored as SHA-256 hashes only
  - Key generation with expiry support, usage tracking, rotation
  - Raw key returned ONCE at generation — never stored or retrievable
- **Auth Event Audit Log** — `.imzx/logs/auth.jsonl` (append-only JSONL)
  - Tracks: auth_success, auth_failed, key_generated, key_revoked, key_rotated, rate_limited
  - Auto-flush after 10 events or 30 seconds
- **IP Allowlist** — CIDR notation support (192.168.1.0/24), exact match (127.0.0.1)
  - `IMZX_ALLOWED_IPS` env var, wired to REST API, Dashboard, A2A
- **HMAC Request Signing** — HMAC-SHA256 for A2A protocol
  - Replay protection (5-min timestamp window), timing-safe comparison
  - Optional (requireHmac flag), configurable secret
- **CLI Key Management** — `imzx auth` subcommand
  - `imzx auth generate --scope full --label admin --expires 30d`
  - `imzx auth list` — list all keys (hashed)
  - `imzx auth revoke <key-id>` — revoke specific key
  - `imzx auth rotate` — revoke all, generate new per scope
  - `imzx auth audit` — view recent auth events
- **HTTPS Support** — TLS config ready for all servers (REST API, Dashboard, A2A)

## [0.6.0] — 2026-06-20

### Added — CLI & Developer Experience
- **Single Command CLI** — `bin/imzx.mjs` with argument parser, shebang, tsx loader
- **14 CLI Subcommands** — run, chat, serve, dashboard, config, personas, mcp, plugins, orchestrate, stats, help
- **Flatten CLI** — `imzx run "prompt"` instead of `npx tsx interfaces/cli/cli-handler.ts run "prompt"`
- **Auto-load .env** — walks up from cwd, also checks `~/.imzx/.env`
- **Streaming UX** — token-by-token output, color-coded (tool calls cyan, errors red, thinking dim)
- **npm publish** — published as `@imzx/imzx` on npmjs.com

### Added — Protocols & Integration
- **A2A Protocol** — Google Agent-to-Agent protocol (`adapters/external/a2a-adapter.ts`)
- **MCP Server Mode** — expose imzx tools as MCP server (`adapters/tools/mcp-server-mode.ts`)
- **MCP Client** — enhanced stdio + HTTP transport support
- **Multi-Provider LLM** — OpenRouter, OpenAI, Anthropic, Together, Groq (auto-detect)

### Added — Intelligence Layers (8 total)
- **KnowledgeGraph** — entity-relationship memory with persistence (`knowledge-graph.json`)
- **TfIdfEmbedder** — zero-dependency semantic search (TF-IDF + cosine similarity)
- **AgentBrain 8-Layer** — wired all systems: memory, reflection, skills, self-mod, knowledge graph, embeddings, git context, project context

### Added — Context & Awareness
- **GitContext** — git-aware agent, auto-detects repo, branch, diff, status, commits
- **ProjectContext** — auto-loads CLAUDE.md, AGENTS.md, .cursorrules from project root
- **Plugin System** — npm plugin manager with hot reload, lifecycle hooks, tool injection

### Added — Orchestration & Execution
- **Orchestration Engine** — 6 multi-agent strategies (Router, Hierarchical, Consensus, Chaining, Evaluator-Optimizer, Parallel)
- **Conversation Checkpoints** — auto-save every N iterations, crash recovery (`.imzx/checkpoints/`)
- **Evaluation Framework** — deterministic replay, benchmark suite, evaluation reports

### Added — Observability & UI
- **Telemetry** — OpenTelemetry-compatible tracing, span management, metrics
- **Web Dashboard** — dark theme UI, real-time agent activity, memory browser, performance charts (`imzx dashboard`)
- **Enhanced JSONL Logging** — structured observability logs

### Added — SDK & Deployment
- **TypeScript SDK** — new exports: A2AAdapter, Orchestration, Telemetry, PluginManager, GitContext, ProjectContext, TfIdfEmbedder, CheckpointManager
- **Python SDK** — zero-dependency wrapper (`interfaces/sdk/python/imzx.py`)
- **Docker** — Dockerfile + docker-compose.yml for containerized deployment
- **Binary Scripts** — cross-platform build (`scripts/build-binary.sh`) + installer (`scripts/install.sh`)

### Changed
- **agent-brain.ts** — upgraded from 6-layer to 8-layer intelligence (added knowledge graph, embeddings, git context, project context)
- **agent-engine.ts** — added telemetry integration + conversation checkpoint support
- **cli-handler.ts** — complete rewrite with 14 new commands (was 8)
- **sdk/index.ts** — 8 new exports for programmatic access
- **llm-provider.ts** — enhanced multi-provider support with 5 providers
- **package.json** — new bin entry, new exports, new dependencies

### Fixed
- **mcp-adapter.ts** — resolved TypeScript type errors
- **Typecheck** — all 51 TypeScript files pass clean (`tsc --noEmit`)
- **CLI entry** — fixed shebang, tsx loader registration, argument parsing

### Stats
- **29 files changed**
- **+4,741 insertions**
- **51 TypeScript files** (10K+ lines)
- **14 Rust modules** (core/src/)
- **6 test files**
- **CI**: All green (Rust fmt + clippy + test + audit, TypeScript typecheck + tests)

---

## [0.5.0] — 2026-06-19

### Added — Self-Improving Agent System
- **PersistentMemory** — cross-session memory with 4 categories (user, knowledge, session, correction), keyword + recency + importance scoring, auto-detection of user preferences and corrections
- **ReflectionEngine** — after-task self-evaluation, automatic lesson extraction, reflection injection into future prompts
- **SkillManager** — save/load/search reusable skills, auto-extraction from successful multi-tool tasks, success/failure tracking
- **SelfModifier** — performance metrics tracking, trend analysis (improving/stable/declining), workflow optimization, modification audit log
- **KnowledgeGraph** — entity-relationship memory with auto entity extraction, co-occurrence relations, adjacency list traversal, prompt injection. Based on Mem0 graph memory (58K stars), Neo4j Lenny's Memory, Cognee, SAGE (Peking 2026)
- **AgentBrain** — central coordinator wiring all 5 intelligence systems into the ReAct loop with 6-layer enhanced prompt building

### Added — Real Agent Engine
- OpenAI native function calling format (tool_calls array)
- Budget enforcement (token + USD limits, per-iteration check)
- Real cost tracking from API usage response
- Conversation memory (persists across run() calls)
- Error recovery (3x exponential backoff retry on 429/500/timeout)
- Persona loading with proper system prompt injection

### Added — 10 Real Tools
- `read_file`, `write_file`, `edit_file`, `list_directory`, `run_command`, `search_files`, `web_search`, `web_fetch`, `calculate`, `run_code`

### Added — Interfaces
- CLI with 8 subcommands, interactive REPL with 8 commands
- REST API with OpenAI-compatible /api/chat, rate limiting, optional API auth
- SDK with createAgent(), run(), stream(), stats()
- MCP client with stdio + HTTP transports

### Added — Infrastructure
- Hooks system, subagent orchestration, context engineering, JSONL observability
- System prompt engineering, graceful shutdown, tool approval

### Fixed — Security Audit (49/51 findings)
- Calculator parser rewrite, API key private, O_NOFOLLOW on writes, context dedup, max iterations error, mutex poison, Selector expect, strip_prefix

### Fixed — CI
- cargo fmt, case-insensitive regex, reflection retrieval, TS error casting

### Tests
- 27 TS source files, 5 test files (30+ tests), Rust core clean

## [0.3.0] — 2026-06-18
- Hooks, subagent, streaming, context_manager, MCP client
- 6 orchestration strategies, real agent engine, CLI/REST/SDK

## [0.2.0] — 2026-06-18
- 15 security audit findings resolved
