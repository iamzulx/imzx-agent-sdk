# imzx-agent-sdk Roadmap

**Current Version**: v0.3.0
**Architecture**: Rust core (NAPI-RS) + TypeScript orchestration + Clean Architecture

---

## v0.2.0 — Security Hardening (Completed 2026-06-18)

All 15 security audit findings resolved (1 CRITICAL, 5 HIGH, 5 MEDIUM, 4 LOW).

---

## v0.3.0 — Agent Intelligence (Completed 2026-06-18)

Based on Anthropic's "Building Effective Agents" and "Effective Context Engineering" research.

### New Modules

| Module | File | Description | Source |
|--------|------|-------------|--------|
| Hooks | core/src/hooks.rs | Middleware lifecycle (PreToolUse, PostToolUse, AgentStart/End, OnIteration, OnError, OnBudgetWarning) | Claude Agent SDK hooks |
| Subagents | core/src/subagent.rs | Child agent spawning, parallel/sequential/map-reduce | Claude Agent SDK subagents |
| Streaming | core/src/streaming.rs | SSE chunks, StreamCollector, TokenStream | Vercel AI SDK |
| Context Manager | core/src/context_manager.rs | Token budgeting, priority compaction, progressive disclosure | Anthropic Context Engineering |
| MCP Client | adapters/external/mcp-adapter.ts | stdio + HTTP transport, tool discovery | MCP specification |

### Built-in Hooks

| Hook | Purpose |
|------|---------|
| AuditHook | Logs all tool calls for security auditing |
| RateLimiterHook | Limits tool calls per minute |
| CostGuardHook | Blocks execution when budget threshold reached |

### Orchestration Patterns

| Pattern | Strategy | Description |
|---------|----------|-------------|
| Router | Router | Heuristic model selection (default) |
| Hierarchical | Hierarchical | Head plans, Workers execute |
| Consensus | Consensus | Parallel workers, Judge synthesis |
| Prompt Chaining | Chaining | Sequential steps with validation gates |
| Evaluator-Optimizer | EvaluatorOptimizer | Generate-Evaluate-Refine loop |
| Parallelization | Parallelization | Multiple models simultaneously |

### NAPI Enhancements

- TsAgent.get_state() — current agent state
- TsAgent.get_stats() — session statistics
- TsAgent.set_budget() — configure limits
- TsSubagentOrchestrator — exposed to TypeScript

---

## v0.4.0 — Production Readiness (Planned)

### P1 — Critical

- Real embedding model (replace hash-based LocalEmbedder)
- Anthropic direct provider
- NAPI bridge: expose tool registration from TypeScript
- RustBindingsAdapter: connect to actual NAPI module
- Remove dead Neon bindings

### P2 — Important

- MCP server mode (expose imzx as MCP server)
- Persistent memory (SQLite-backed)
- Streaming LLM support in provider trait
- OpenTelemetry observability
- File checkpointing

### P3 — Nice to Have

- Web UI dashboard
- Plugin system (external .so/.dylib)
- Multi-tenant isolation
- Cost analytics

---

## Architecture

```
+-----------------------------------------------+
|                  TypeScript                     |
|  CLI -> AgentService -> PersonaRepo            |
|  MCP Client -> RustBindingsAdapter             |
+-----------------------------------------------+
|               NAPI-RS Bridge                   |
|  TsAgent (run, get_state, get_stats)           |
|  TsSubagentOrchestrator                        |
+-----------------------------------------------+
|                   Rust Core                    |
|  Agent (ReAct + hooks + context)               |
|  ToolRegistry (6 tools)                        |
|  ModelRegistry (OpenRouter)                    |
|  HookRegistry (audit, rate, cost)              |
|  ContextManager (budgeting, compaction)        |
|  SubagentOrchestrator (parallel/seq)           |
|  StreamCollector (SSE)                         |
|  Orchestrator (6 strategies)                   |
+-----------------------------------------------+
```

---

## References

| Topic | Source | Date |
|-------|--------|------|
| Building Effective Agents | Anthropic Engineering | Dec 2024 |
| Effective Context Engineering | Anthropic Engineering | Sep 2025 |
| Claude Agent SDK | code.claude.com/docs | Jun 2026 |
| MCP Specification | modelcontextprotocol.io | 2024 |
| AI Agent Frameworks 2026 | morphllm.com | Jun 2026 |
