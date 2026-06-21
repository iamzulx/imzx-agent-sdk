# imzx-agent-sdk Architecture

## Overview

imzx-agent-sdk is a **self-improving** AI Agent framework built with Clean Architecture. The agent learns from every interaction — remembering user preferences, reflecting on task outcomes, extracting reusable skills, and optimizing its own performance over time.

**Version**: v0.6.0
**Intelligence Layers**: 8 (memory, reflection, skills, self-mod, knowledge graph, embeddings, git context, project context)

## Layer Architecture

```
                    +-----------------------------------------+
                    |           Interfaces Layer               |
                    | CLI(14) | REST API | SDK(TS+Py) | Dash  |
                    +-------------------+---------------------+
                                        | calls
                    +-------------------v---------------------+
                    |         Application Layer                |
                    |  AgentService (orchestrator)             |
                    +-------------------+---------------------+
                                        | delegates
          +-----------------------------+-----------------------------+
          |                             |                             |
+---------v----------+    +-------------v-----------+    +-----------v----------+
|   Adapters Layer   |    |    Adapters Layer       |    |   Adapters Layer     |
|  External          |    |    Memory (Brain)       |    |   Tools              |
|  - AgentEngine     |    |  - AgentBrain (8 layers)|    |  - ToolExecutor (10) |
|  - LlmProvider     |    |  - PersistentMemory     |    |  - PluginManager     |
|  - RustBindings    |    |  - ReflectionEngine     |    |  - GitContext        |
|  - McpClient       |    |  - SkillManager         |    |  - ProjectContext    |
|  - A2AAdapter      |    |  - SelfModifier         |    |  - Orchestration     |
|                    |    |  - KnowledgeGraph       |    |  - McpServerMode     |
|                    |    |  - TfIdfEmbedder        |    |  - Telemetry         |
|                    |    |  - CheckpointMgr        |    |  - Prompts           |
+--------------------+    |  - AgentEvaluator       |    |  - AgentLogger       |
          |               |  - ContextSummarizer    |    +-----------+----------+
          |               +---------------------------+                |
          |                             |                              |
          +-----------------------------+------------------------------+
                                        |
                    +-------------------v---------------------+
                    |           Domain Layer                   |
                    |  Persona | AgentEnginePort              |
                    +-----------------------------------------+
```

## 8-Layer Intelligence System

```
Layer 1: PersistentMemory
  - Cross-session memory (user prefs, corrections, knowledge)
  - Keyword + recency + importance scoring
  - Auto-detects user preferences from conversation

Layer 2: ReflectionEngine
  - After-task self-evaluation (Reflexion pattern)
  - Automatic lesson extraction
  - Injects reflections into future prompts

Layer 3: SkillManager
  - Save/load/search reusable skills
  - Auto-extraction from successful multi-tool tasks
  - Success/failure tracking per skill

Layer 4: SelfModifier
  - Performance metrics tracking
  - Trend analysis (improving/stable/declining)
  - Workflow optimization suggestions
  - Modification audit log

Layer 5: KnowledgeGraph
  - Entity-relationship memory (persistent JSON)
  - Auto entity extraction from conversation
  - Co-occurrence relations
  - Adjacency list traversal
  - Prompt injection of relevant entities

Layer 6: TfIdfEmbedder
  - Zero-dependency semantic search
  - TF-IDF vectorization + cosine similarity
  - Document indexing and retrieval
  - Hybrid search (keyword + semantic)

Layer 7: GitContext
  - Auto-detects git repository
  - Reads branch, status, diff, recent commits
  - Injects git state into system prompt
  - Enables git-aware file operations

Layer 8: ProjectContext
  - Auto-reads CLAUDE.md, AGENTS.md, .cursorrules
  - Injects project conventions and tech stack
  - Respects .gitignore patterns
  - Context-aware system prompt building
```

## Self-Improving Loop

```
Task Start
  |
  v
AgentBrain.processUserMessage()
  |-- Detect preferences ("jangan pakai X")
  |-- Detect corrections ("salah, seharusnya Y")
  v
AgentBrain.buildEnhancedPrompt() — 8 layers inject context:
  |-- Layer 1: PersistentMemory (prefs, corrections, knowledge)
  |-- Layer 2: ReflectionEngine (lessons from past tasks)
  |-- Layer 3: SkillManager (proven workflows)
  |-- Layer 4: SelfModifier (performance trends)
  |-- Layer 5: KnowledgeGraph (entity relationships)
  |-- Layer 6: TfIdfEmbedder (semantic search results)
  |-- Layer 7: GitContext (repo state, branch, diff)
  |-- Layer 8: ProjectContext (CLAUDE.md, AGENTS.md)
  v
ReAct Loop (think -> tool call -> observe -> repeat)
  |-- AgentBrain.onToolUse() tracks each tool
  |-- Budget enforcement (token + USD limits)
  |-- Context compaction (auto at 80% limit)
  |-- Error recovery (3x retry, exponential backoff)
  |-- Plugin hooks fire on tool events
  |-- Telemetry spans record each step
  v
Task Complete
  |
  v
AgentBrain.onTaskEnd()
  |-- ReflectionEngine: evaluate outcome, extract lessons
  |-- SelfModifier: record metric, analyze trend
  |-- SkillManager: auto-extract skill if multi-tool success
  |-- PersistentMemory: save session summary
  |-- CheckpointManager: save conversation state
  |-- Telemetry: emit final span with metrics
  v
Next Task (agent is smarter)
```

## Module Map (v0.6.0)

### External Adapters
| Module | File | Description |
|--------|------|-------------|
| AgentEngine | `adapters/external/agent-engine.ts` | TypeScript ReAct loop with telemetry + checkpoint |
| LlmProvider | `adapters/external/llm-provider.ts` | Multi-provider LLM (5 providers, auto-detect) |
| RustBindings | `adapters/external/rust-bindings-adapter.ts` | NAPI bridge + TS fallback |
| McpClient | `adapters/external/mcp-adapter.ts` | MCP client (stdio + HTTP) |
| A2AAdapter | `adapters/external/a2a-adapter.ts` | Google A2A protocol (agent discovery, delegation) |

### Memory / Intelligence
| Module | File | Description |
|--------|------|-------------|
| AgentBrain | `adapters/memory/agent-brain.ts` | Central coordinator, 8-layer prompt building |
| PersistentMemory | `adapters/memory/persistent-memory.ts` | Cross-session memory store |
| ReflectionEngine | `adapters/memory/reflection-engine.ts` | Self-reflection (Reflexion pattern) |
| SkillManager | `adapters/memory/skill-manager.ts` | Skill CRUD, auto-extraction |
| SelfModifier | `adapters/memory/self-modifier.ts` | Performance tracking, trend analysis |
| KnowledgeGraph | `adapters/memory/knowledge-graph.ts` | Entity-relationship graph (persistent) |
| TfIdfEmbedder | `adapters/memory/embeddings.ts` | TF-IDF semantic search |
| CheckpointMgr | `adapters/memory/conversation-checkpoint.ts` | Auto-save, crash recovery |
| AgentEvaluator | `adapters/memory/agent-evaluator.ts` | Replay, benchmarks, reports |
| ContextSummarizer | `adapters/memory/context-summarizer.ts` | Context compression |

### Tools
| Module | File | Description |
|--------|------|-------------|
| ToolExecutor | `adapters/tools/tool-executor.ts` | 10 real tool implementations |
| PluginManager | `adapters/tools/plugin-system.ts` | npm plugins, hot reload, hooks |
| GitContext | `adapters/tools/git-context.ts` | Git-aware agent |
| ProjectContext | `adapters/tools/project-context.ts` | Auto-load project conventions |
| Orchestration | `adapters/tools/orchestration.ts` | 6 multi-agent strategies |
| McpServerMode | `adapters/tools/mcp-server-mode.ts` | Expose tools as MCP server |
| Telemetry | `adapters/tools/telemetry.ts` | OpenTelemetry-compatible tracing |
| SecurityGuardrails | `adapters/tools/security-guardrails.ts` | Input/output validation |
| WorkflowEngine | `adapters/tools/workflow-engine.ts` | DAG orchestration |
| OutputGuard | `adapters/tools/output-guard.ts` | Output sanitization |
| StructuredOutput | `adapters/tools/structured-output.ts` | JSON mode |
| Prompts | `adapters/tools/prompts.ts` | System prompt engineering |

### Interfaces
| Module | File | Description |
|--------|------|-------------|
| CLI | `interfaces/cli/cli-handler.ts` | 14 subcommands |
| REST API | `interfaces/api/server.ts` | OpenAI-compatible + SSE + auth |
| SDK (TS) | `interfaces/sdk/index.ts` | Programmatic API + all exports |
| SDK (Py) | `interfaces/sdk/python/imzx.py` | Python wrapper (zero deps) |
| Dashboard | `interfaces/dashboard/server.ts` | Web UI dashboard |

## Memory Types

| Type | Category | Persistence | Example |
|------|----------|-------------|---------|
| User Preferences | `user` | Cross-session | "Prefers concise responses" |
| Corrections | `correction` | Cross-session (high priority) | "Don't use TypeScript, use JavaScript" |
| Knowledge | `knowledge` | Cross-session | "Project uses Rust 1.95.0" |
| Sessions | `session` | Cross-session | "Task X succeeded with tools A, B, C" |
| Reflections | `session` | Cross-session | "What worked: multi-tool workflow" |
| Lessons | `knowledge` | Cross-session | "Always read file before editing" |
| Skills | `.imzx/skills/` | Cross-session | "express-rest-api: steps, gotchas, template" |
| Entities | `knowledge-graph.json` | Cross-session | "PostgreSQL --uses--> connection pooling" |
| Checkpoints | `.imzx/checkpoints/` | Session recovery | Full conversation state snapshot |

## Data Flow: Single Prompt (v0.6.0)

```
User: "Fix the bug in auth.py"
  |
  v
CLI.handleRun()
  -> AgentService.execute("general-purpose", prompt, {streaming: true})
    -> LlmProvider.fromEnv() -> auto-detect provider (5 supported)
    -> AgentEngine.initialize()
      -> buildSystemPrompt() with tool guidance
      -> AgentBrain.buildEnhancedPrompt() — 8 layers:
         1. PersistentMemory: inject user prefs, corrections
         2. ReflectionEngine: inject lessons from past tasks
         3. SkillManager: inject relevant skills
         4. SelfModifier: inject performance context
         5. KnowledgeGraph: inject entity relationships
         6. TfIdfEmbedder: inject semantic search results
         7. GitContext: inject git state (branch, diff, status)
         8. ProjectContext: inject CLAUDE.md, AGENTS.md
    -> Telemetry.startSpan("task")
    -> AgentEngine.runStreaming(prompt)
      -> LlmProvider.stream(messages, tools)
        -> POST /v1/chat/completions (OpenAI format)
      <- LLM returns tool_calls: [{name: "read_file", args: {path: "auth.py"}}]
      -> Telemetry.recordToolCall("read_file")
      -> PluginManager.onToolUse("read_file")
      -> ToolExecutor.execute("read_file", {path: "auth.py"})
        -> fs.readFile("auth.py") -> file contents
      <- LLM returns tool_calls: [{name: "edit_file", args: {...}}]
      -> Telemetry.recordToolCall("edit_file")
      -> ToolExecutor.execute("edit_file", {...})
        -> User approval prompt (if IMZX_AUTO_APPROVE != true)
        -> fs.writeFile() -> "File edited"
      <- LLM returns text: "Fixed the bug in auth.py line 42"
      -> AgentBrain.onTaskEnd()
         -> reflection saved
         -> metric recorded
         -> skill extracted (if applicable)
      -> CheckpointManager.save(state)
      -> Telemetry.endSpan(span, {success: true})
  <- Stream chunks to CLI -> colored terminal output
```

## Security Model

```
Layer 1: Input Validation
  - Persona ID regex (^[a-zA-Z0-9_-]+$)
  - Path sanitization (canonicalize + blocked paths)
  - URL validation (HTTPS-only, private IP block)
  - Plugin manifest validation (signed packages)

Layer 2: Execution Guards
  - ShellTool command allowlist (14 commands)
  - Tool approval (interactive stdin for dangerous tools)
  - Rate limiting (60 req/min per IP on REST API)
  - Plugin sandbox (isolated execution context)

Layer 3: Output Sanitization
  - UntrustedObservation (escape Action: patterns)
  - Smart truncation (70% head + 20% tail)
  - Tool result cap (50K chars)
  - Telemetry PII redaction

Layer 4: Resource Limits
  - Budget (max tokens + max USD)
  - Max iterations (10)
  - Command timeout (30s)
  - Context compaction (auto at 80%)

Layer 5: Secret Management
  - SecretBox<String> for API keys (Rust)
  - .env file for API keys (TypeScript)
  - Optional API key auth for REST API
  - Plugin API key isolation

Layer 6: Git Security
  - Respect .gitignore patterns
  - No auto-push without confirmation
  - Branch protection awareness
```

## Orchestration Strategies

| Strategy | Pattern | Use Case |
|----------|---------|----------|
| Router | Single model, weighted scoring | Default — pick best model |
| Hierarchical | Head plans, Workers execute | Complex multi-step tasks |
| Consensus | Parallel workers, Judge synthesis | High-confidence decisions |
| Chaining | Sequential steps with gates | Predictable pipelines |
| Evaluator-Optimizer | Generate -> Evaluate -> Refine | Quality-critical output |
| Parallelization | Multiple models simultaneously | Speed or diverse perspectives |

## Protocol Support

### MCP (Model Context Protocol)
- **Client**: Connect to external MCP servers (stdio + HTTP)
- **Server**: Expose imzx tools as MCP server (`imzx mcp serve`)
- **Tool Registration**: Auto-merge tools from connected MCP servers

### A2A (Agent-to-Agent)
- **Agent Card Discovery**: Discover capabilities of other agents
- **Task Delegation**: Send tasks to specialized agents
- **Streaming**: Real-time streaming between agents
- **Status Tracking**: Monitor delegated task progress

## Extension Points

### Adding a New Tool
1. Add definition in `adapters/tools/tool-executor.ts` (getToolDefinitions)
2. Add execution case in `executeTool()`
3. If dangerous: add to `DANGEROUS_TOOLS` set
4. Register with PluginManager hooks if needed

### Adding a New Memory Category
1. Add type to `MemoryEntry['category']` in `persistent-memory.ts`
2. Add format rules in `formatForPrompt()`
3. Use: `brain.memory.save('new_category', key, content, {tags, importance})`

### Adding a New Reflection Pattern
1. Add detection in `reflection-engine.ts` extract methods
2. Update `formatReflection()` for storage format
3. Brain auto-wires reflection into prompt via `formatForPrompt()`

### Adding a New Skill Category
1. Use: `brain.skills.save({name, description, category, steps, ...})`
2. Skills auto-load via `skills.formatForPrompt(query)` in `buildEnhancedPrompt()`

### Adding a Plugin
1. Create npm package with `imzx-plugin` manifest
2. Export tools, hooks, or persona presets
3. Install: `imzx plugins install @scope/plugin-name`
4. Plugin auto-loads on next agent start

### Adding a Telemetry Span
1. Use: `telemetry.startSpan(name, attributes)`
2. Record events: `telemetry.addEvent(span, 'tool_call', {tool: 'read_file'})`
3. End: `telemetry.endSpan(span, {success: true})`
4. Spans exported to OTLP collector or `.imzx/telemetry/`

---

## v0.7.0 Production Features

### HITL (Human-in-the-Loop) Manager
`adapters/tools/hitl-manager.ts` — Task-level approval gates.
- Risk-based auto-approve: low risk auto-pass, high risk require human
- Persistent storage to `.imzx/hitl/pending.json`
- Timeout with configurable default action
- CLI: `imzx hitl approve/reject/list`

### LLM-as-a-Judge
`adapters/tools/llm-judge.ts` — Rubric-based evaluation.
- Built-in rubrics: code_quality, answer_accuracy, safety, completeness
- Head-to-head output comparison
- Structured JSON scoring with per-criterion reasoning

### Cost-Aware Planning
`adapters/tools/cost-planner.ts` — Estimate costs before execution.
- Per-model pricing for 8+ models
- Task cost estimation (prompt + tool calls)
- Auto-routing: simple tasks to cheap model, complex to capable

### Policy-as-Code Engine
`adapters/security/policy-engine.ts` — Declarative governance rules.
- 6 built-in policies (no system files, max web search, etc.)
- Priority-ordered rule evaluation
- Violation logging to `.imzx/logs/policy-violations.jsonl`

### Topology Patterns
`adapters/tools/topology.ts` — Multi-agent communication topologies.
- Chain: A-B-C sequential pipeline
- Star: central orchestrator, parallel workers, aggregator
- Mesh: peer-to-peer debate with configurable rounds

### Agent Lifecycle Management
`adapters/tools/agent-lifecycle.ts` — Explicit states and health monitoring.
- States: init, planning, executing, waiting, completed, terminated
- Health checks, crash recovery, auto-restart

### SLM Router
`adapters/tools/slm-router.ts` — Auto-route to cost-effective small models.
- Catalog: Phi-4, Qwen 2.5, Gemma 2, Llama 3.2
- Task classification: simple_chat, code, math, summarize, research, complex_reasoning

### CUA Browser
`adapters/tools/cua-browser.ts` — Browser automation via curl.
- Navigate URLs, extract page content, screenshot
- Navigation history, content search

### RAG Pipeline
`adapters/tools/rag-pipeline.ts` — TF-IDF vector search.
- Chunk-based document storage, automatic indexing
- Hybrid graph + vector ranking

### Auth Manager
`adapters/security/auth-manager.ts` — Multi-key authentication.
- Scoped API keys stored as SHA-256 hashes
- Auth event audit log, IP allowlist, HMAC signing
