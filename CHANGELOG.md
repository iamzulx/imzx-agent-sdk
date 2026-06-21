1|# Changelog
2|
3|All notable changes to imzx-agent-sdk are documented in this file.
4|
5|## [0.7.0] — 2026-06-21

### Added — 9 Production Features
- **Human-in-the-Loop (HITL)** — `adapters/tools/hitl-manager.ts`
  - Interactive approval gates for sensitive tool calls
  - Configurable auto-approve rules per tool category
  - Timeout-based auto-reject for unattended sessions
- **LLM-as-a-Judge** — `adapters/tools/llm-judge.ts`
  - Automated quality evaluation of agent outputs
  - Multi-criteria scoring (accuracy, completeness, safety, relevance)
  - Calibration against human-rated examples
- **Cost-Aware Planner** — `adapters/tools/cost-planner.ts`
  - Token + USD budget enforcement per task and session
  - Model selection optimization (cost vs capability tradeoffs)
  - Real-time cost tracking with alerts
- **Policy Engine** — `adapters/tools/policy-engine.ts`
  - Policy-as-Code governance rules (JSON/YAML)
  - Tool usage restrictions by role, time, budget
  - Compliance checking before tool execution
- **Multi-Agent Topology** — `adapters/tools/topology.ts`
  - Chain, Star, Mesh topology patterns for multi-agent workflows
  - Dynamic topology selection based on task complexity
  - Inter-agent communication protocols
- **Agent Lifecycle** — `adapters/tools/agent-lifecycle.ts`
  - Full agent lifecycle: spawn, pause, resume, terminate
  - Health monitoring with heartbeat checks
  - Graceful shutdown with cleanup
- **SLM Router** — `adapters/tools/slm-router.ts`
  - Automatic routing to smaller/faster models for simple tasks
  - Complexity estimation → model selection
  - 30-50% cost reduction for routine queries
- **CUA Browser** — `adapters/tools/cua-browser.ts`
  - Computer-Using Agent browser automation
  - Screenshot → action loop for web interaction
  - DOM extraction and element targeting
- **RAG Pipeline** — `adapters/tools/rag-pipeline.ts`
  - TF-IDF + knowledge graph hybrid retrieval
  - Chunk management with overlap and metadata
  - Relevance scoring and context assembly

### Changed
- **README.md** — version badge updated to 0.7.0
- **ROADMAP.md** — v0.7.0 marked as completed, v0.8.0 updated
- **package.json** — test script: removed `--passWithNoTests` flag

### Stats
- **55 TypeScript files**, 13,186 lines
- **14 Rust modules** (core/src/)
- **6 test files**
- **9 production features** (HITL, LLM Judge, Cost Planner, Policy Engine, Topology, Lifecycle, SLM Router, CUA Browser, RAG Pipeline)

## [0.6.1] — 2026-06-20
6|
7|### Added — Auth System & Security Enhancements
8|- **Multi-Key Auth Manager** — `adapters/security/auth-manager.ts` (430 lines)
9|  - Scoped API keys (full, read, write, mcp, a2a) stored as SHA-256 hashes only
10|  - Key generation with expiry support, usage tracking, rotation
11|  - Raw key returned ONCE at generation — never stored or retrievable
12|- **Auth Event Audit Log** — `.imzx/logs/auth.jsonl` (append-only JSONL)
13|  - Tracks: auth_success, auth_failed, key_generated, key_revoked, key_rotated, rate_limited
14|  - Auto-flush after 10 events or 30 seconds
15|- **IP Allowlist** — CIDR notation support (192.168.1.0/24), exact match (127.0.0.1)
16|  - `IMZX_ALLOWED_IPS` env var, wired to REST API, Dashboard, A2A
17|- **HMAC Request Signing** — HMAC-SHA256 for A2A protocol
18|  - Replay protection (5-min timestamp window), timing-safe comparison
19|  - Optional (requireHmac flag), configurable secret
20|- **CLI Key Management** — `imzx auth` subcommand
21|  - `imzx auth generate --scope full --label admin --expires 30d`
22|  - `imzx auth list` — list all keys (hashed)
23|  - `imzx auth revoke <key-id>` — revoke specific key
24|  - `imzx auth rotate` — revoke all, generate new per scope
25|  - `imzx auth audit` — view recent auth events
26|- **HTTPS Support** — TLS config ready for all servers (REST API, Dashboard, A2A)
27|
28|## [0.6.0] — 2026-06-20
29|
30|### Added — CLI & Developer Experience
31|- **Single Command CLI** — `bin/imzx.mjs` with argument parser, shebang, tsx loader
32|- **14 CLI Subcommands** — run, chat, serve, dashboard, config, personas, mcp, plugins, orchestrate, stats, help
33|- **Flatten CLI** — `imzx run "prompt"` instead of `npx tsx interfaces/cli/cli-handler.ts run "prompt"`
34|- **Auto-load .env** — walks up from cwd, also checks `~/.imzx/.env`
35|- **Streaming UX** — token-by-token output, color-coded (tool calls cyan, errors red, thinking dim)
36|- **npm publish** — published as `@imzx/imzx` on npmjs.com
37|
38|### Added — Protocols & Integration
39|- **A2A Protocol** — Google Agent-to-Agent protocol (`adapters/external/a2a-adapter.ts`)
40|- **MCP Server Mode** — expose imzx tools as MCP server (`adapters/tools/mcp-server-mode.ts`)
41|- **MCP Client** — enhanced stdio + HTTP transport support
42|- **Multi-Provider LLM** — OpenRouter, OpenAI, Anthropic, Together, Groq (auto-detect)
43|
44|### Added — Intelligence Layers (8 total)
45|- **KnowledgeGraph** — entity-relationship memory with persistence (`knowledge-graph.json`)
46|- **TfIdfEmbedder** — zero-dependency semantic search (TF-IDF + cosine similarity)
47|- **AgentBrain 8-Layer** — wired all systems: memory, reflection, skills, self-mod, knowledge graph, embeddings, git context, project context
48|
49|### Added — Context & Awareness
50|- **GitContext** — git-aware agent, auto-detects repo, branch, diff, status, commits
51|- **ProjectContext** — auto-loads CLAUDE.md, AGENTS.md, .cursorrules from project root
52|- **Plugin System** — npm plugin manager with hot reload, lifecycle hooks, tool injection
53|
54|### Added — Orchestration & Execution
55|- **Orchestration Engine** — 6 multi-agent strategies (Router, Hierarchical, Consensus, Chaining, Evaluator-Optimizer, Parallel)
56|- **Conversation Checkpoints** — auto-save every N iterations, crash recovery (`.imzx/checkpoints/`)
57|- **Evaluation Framework** — deterministic replay, benchmark suite, evaluation reports
58|
59|### Added — Observability & UI
60|- **Telemetry** — OpenTelemetry-compatible tracing, span management, metrics
61|- **Web Dashboard** — dark theme UI, real-time agent activity, memory browser, performance charts (`imzx dashboard`)
62|- **Enhanced JSONL Logging** — structured observability logs
63|
64|### Added — SDK & Deployment
65|- **TypeScript SDK** — new exports: A2AAdapter, Orchestration, Telemetry, PluginManager, GitContext, ProjectContext, TfIdfEmbedder, CheckpointManager
66|- **Python SDK** — zero-dependency wrapper (`interfaces/sdk/python/imzx.py`)
67|- **Docker** — Dockerfile + docker-compose.yml for containerized deployment
68|- **Binary Scripts** — cross-platform build (`scripts/build-binary.sh`) + installer (`scripts/install.sh`)
69|
70|### Changed
71|- **agent-brain.ts** — upgraded from 6-layer to 8-layer intelligence (added knowledge graph, embeddings, git context, project context)
72|- **agent-engine.ts** — added telemetry integration + conversation checkpoint support
73|- **cli-handler.ts** — complete rewrite with 14 new commands (was 8)
74|- **sdk/index.ts** — 8 new exports for programmatic access
75|- **llm-provider.ts** — enhanced multi-provider support with 5 providers
76|- **package.json** — new bin entry, new exports, new dependencies
77|
78|### Fixed
79|- **mcp-adapter.ts** — resolved TypeScript type errors
80|- **Typecheck** — all 51 TypeScript files pass clean (`tsc --noEmit`)
81|- **CLI entry** — fixed shebang, tsx loader registration, argument parsing
82|
83|### Stats
84|- **29 files changed**
85|- **+4,741 insertions**
86|- **51 TypeScript files** (10K+ lines)
87|- **14 Rust modules** (core/src/)
88|- **6 test files**
89|- **CI**: All green (Rust fmt + clippy + test + audit, TypeScript typecheck + tests)
90|
91|---
92|
93|## [0.5.0] — 2026-06-19
94|
95|### Added — Self-Improving Agent System
96|- **PersistentMemory** — cross-session memory with 4 categories (user, knowledge, session, correction), keyword + recency + importance scoring, auto-detection of user preferences and corrections
97|- **ReflectionEngine** — after-task self-evaluation, automatic lesson extraction, reflection injection into future prompts
98|- **SkillManager** — save/load/search reusable skills, auto-extraction from successful multi-tool tasks, success/failure tracking
99|- **SelfModifier** — performance metrics tracking, trend analysis (improving/stable/declining), workflow optimization, modification audit log
100|- **KnowledgeGraph** — entity-relationship memory with auto entity extraction, co-occurrence relations, adjacency list traversal, prompt injection. Based on Mem0 graph memory (58K stars), Neo4j Lenny's Memory, Cognee, SAGE (Peking 2026)
101|- **AgentBrain** — central coordinator wiring all 5 intelligence systems into the ReAct loop with 6-layer enhanced prompt building
102|
103|### Added — Real Agent Engine
104|- OpenAI native function calling format (tool_calls array)
105|- Budget enforcement (token + USD limits, per-iteration check)
106|- Real cost tracking from API usage response
107|- Conversation memory (persists across run() calls)
108|- Error recovery (3x exponential backoff retry on 429/500/timeout)
109|- Persona loading with proper system prompt injection
110|
111|### Added — 10 Real Tools
112|- `read_file`, `write_file`, `edit_file`, `list_directory`, `run_command`, `search_files`, `web_search`, `web_fetch`, `calculate`, `run_code`
113|
114|### Added — Interfaces
115|- CLI with 8 subcommands, interactive REPL with 8 commands
116|- REST API with OpenAI-compatible /api/chat, rate limiting, optional API auth
117|- SDK with createAgent(), run(), stream(), stats()
118|- MCP client with stdio + HTTP transports
119|
120|### Added — Infrastructure
121|- Hooks system, subagent orchestration, context engineering, JSONL observability
122|- System prompt engineering, graceful shutdown, tool approval
123|
124|### Fixed — Security Audit (49/51 findings)
125|- Calculator parser rewrite, API key private, O_NOFOLLOW on writes, context dedup, max iterations error, mutex poison, Selector expect, strip_prefix
126|
127|### Fixed — CI
128|- cargo fmt, case-insensitive regex, reflection retrieval, TS error casting
129|
130|### Tests
131|- 27 TS source files, 5 test files (30+ tests), Rust core clean
132|
133|## [0.3.0] — 2026-06-18
134|- Hooks, subagent, streaming, context_manager, MCP client
135|- 6 orchestration strategies, real agent engine, CLI/REST/SDK
136|
137|## [0.2.0] — 2026-06-18
138|- 15 security audit findings resolved
139|