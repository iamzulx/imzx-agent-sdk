# Project: imzx-agent-sdk

High-performance AI Agent framework — Rust core (NAPI-RS) + TypeScript orchestration with Clean Architecture.

## Quick Start

```bash
npm install --ignore-scripts
cp .env.example .env  # Set API key
npx tsx interfaces/cli/cli-handler.ts run "Hello"
```

## Architecture

Clean Architecture with 4 layers:
- **Domain** (`domain/`): Pure types — Persona, AgentEnginePort
- **Application** (`application/`): AgentService orchestrator
- **Adapters** (`adapters/`): AgentEngine, LlmProvider, ToolExecutor, MCP client, RustBindingsAdapter
- **Interfaces** (`interfaces/`): CLI, REST API, SDK

## Rust Core (`core/src/`)

14 modules:
- `agent.rs` — ReAct loop with hooks integration and context management
- `tools.rs` — Tool registry, ToolCall parsing, UntrustedObservation, security guards
- `llm.rs` — LlmProvider trait, ModelRegistry, OpenRouterProvider (SecretBox API key)
- `hooks.rs` — HookRegistry, HookEvent, built-in AuditHook/RateLimiterHook/CostGuardHook
- `subagent.rs` — SubagentOrchestrator (parallel/sequential/map-reduce)
- `streaming.rs` — StreamCollector, TokenStream, StreamChunk
- `context_manager.rs` — ContextManager (4 compaction strategies, progressive disclosure)
- `orchestration.rs` — 6 strategies (Router, Hierarchical, Consensus, Chaining, EvaluatorOptimizer, Parallelization)
- `memory.rs` — MemoryManager (FIFO + semantic search)
- `embedding.rs` — LocalEmbedder (hash-based placeholder)
- `lib.rs` — NAPI-RS (TsAgent, TsSubagentOrchestrator) + PyO3 bindings

## TypeScript Agent Engine (`adapters/external/`)

When Rust NAPI module is not available, falls back to pure TypeScript:
- `agent-engine.ts` — Full ReAct loop with streaming
- `llm-provider.ts` — OpenAI-compatible HTTP client (supports streaming)
- `tool-executor.ts` — 6 real tools (read_file, write_file, list_directory, run_command, search_files, web_fetch)

## CLI Commands

```bash
npx tsx interfaces/cli/cli-handler.ts run "prompt" [--persona X] [--stream] [--budget-usd N]
npx tsx interfaces/cli/cli-handler.ts chat  # Interactive REPL
npx tsx interfaces/cli/cli-handler.ts serve --port 3000  # REST API
npx tsx interfaces/cli/cli-handler.ts personas list
npx tsx interfaces/cli/cli-handler.ts stats
npx tsx interfaces/cli/cli-handler.ts help
```

## Environment Variables

- `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY` / `IMZX_API_KEY` — LLM API key
- `IMZX_LLM_BASE_URL` — Custom endpoint (default: OpenRouter)
- `IMZX_MODEL` — Model name (default: anthropic/claude-sonnet-4)

## CI Pipeline (GitHub Actions)

2 jobs:
1. **Rust Tests & Lints**: cargo fmt → clippy → test → build → audit
2. **TypeScript Typecheck & Tests**: npm install → tsc --noEmit → vitest

## Coding Standards

### TypeScript
- ESM modules (`type: "module"`)
- Zod for runtime validation
- Strict TypeScript (`strict: true`)
- NodeNext module resolution

### Rust
- Edition 2021
- `anyhow::Result` for error handling
- `async-trait` for async traits
- `secrecy::SecretBox` for API keys
- `chrono` for timestamps
- `futures` for async streams

## Security

- SSRF protection (HTTPS-only, private IP blocking, no redirects)
- Shell command allowlist (exact match)
- Path traversal prevention (canonicalize + starts_with)
- API keys in SecretBox (zeroized on drop)
- UntrustedObservation wrapper for tool outputs
- PreToolUse hook for validation
- Budget cap (token + USD limits)
- Rate limiter hook

## License

MIT — Copyright (c) 2026 Iamzulx
