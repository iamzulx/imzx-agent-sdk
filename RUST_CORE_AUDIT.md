# imzx-agent-sdk — Rust Core Audit Report

**Audit Date**: 2026-06-21  
**Scope**: 15 Rust files (core/src/ + core/Cargo.toml)  
**Total Lines**: ~3,200 lines Rust (was ~2,954)  
**Status**: ✅ 14/16 findings resolved, 2 deferred (M2, M3 — deps used by WebScraperTool)

---

## Architecture Overview

The Rust core provides a high-performance agent engine via NAPI-RS (TypeScript) and PyO3 (Python) bindings. 14 modules:

| Module | Lines | Purpose |
|--------|-------|---------|
| `lib.rs` | 196 | Module declarations, PyO3 + NAPI-RS bindings, global Tokio runtime |
| `agent.rs` | 465 | ReAct loop, session stats, budget enforcement, state machine |
| `tools.rs` | 963 | Tool registry, 6 tool implementations, security guards |
| `llm.rs` | 182 | LLM provider trait, OpenRouter implementation, model registry |
| `hooks.rs` | 256 | Middleware lifecycle system (7 event types, 3 result types) |
| `subagent.rs` | 190 | Child agent orchestration with isolated context |
| `streaming.rs` | 162 | SSE streaming chunks, collector, backpressure |
| `context_manager.rs` | 312 | Token budgeting, compaction strategies, progressive disclosure |
| `orchestration.rs` | 219 | 6 strategies (Router, Hierarchical, Consensus, Chaining, Eval-Opt, Parallel) |
| `memory.rs` | 113 | In-memory conversation history with semantic search |
| `embedding.rs` | 38 | Hash-based embedding (development only, not semantic) |
| `strategy.rs` | 64 | Weighted price/latency scorer for model selection |
| `types.rs` | 104 | Score, Price, Latency newtypes with ordering |
| `error.rs` | 24 | RouterError enum (Network, Timeout, ProviderFailure, Internal, InvalidConfig) |

---

## FINDINGS

### CRITICAL

**C1: PyO3 + NAPI-RS dual binding conflict**
- `lib.rs` imports BOTH `pyo3::prelude::*` AND `napi_derive::napi`
- These are mutually exclusive compilation targets — PyO3 requires Python headers, NAPI-RS requires Node.js headers
- On Termux: neither compiles (no python-dev headers, no node-gyp)
- On CI (GitHub Actions): only NAPI-RS compiles (PyO3 feature likely disabled)
- **Impact**: Cargo.toml has both as dependencies; `crate-type = ["cdylib", "rlib"]` tries to build both
- **Fix**: Make PyO3 optional behind a feature flag: `[features] python = ["pyo3"]`

**C2: Global Tokio runtime never cleaned up**
- `lib.rs:47`: `pub static RUNTIME: Lazy<Runtime>` — creates a multi-thread Tokio runtime that never shuts down
- On Termux (3.7GB RAM), this pre-allocates thread pool memory even when idle
- **Impact**: Memory waste, potential conflict with TypeScript's own async runtime
- **Fix**: Use `tokio::runtime::Handle::current()` or make runtime lifecycle-aware

### HIGH

**H1: Hash-based embedding is NOT semantic**
- `embedding.rs:17-37`: Uses `DefaultHasher` to create a 768-dim vector
- Hash-based embedding has ZERO semantic meaning — identical words get different hashes if context differs
- The TypeScript `TfIdfEmbedder` (adapters/memory/embeddings.ts) is more capable
- **Impact**: Rust core's `semantic_search` in `memory.rs` returns random results
- **Fix**: Replace with real ML model (candle-core is already a dependency) or remove and delegate to TS layer

**H2: Tool parsing uses raw string matching (prompt injection risk)**
- `tools.rs:41-72`: `ToolCall::parse_from_response()` searches for `Action:` and `Action Input:` lines
- An LLM could be tricked into outputting `Action:` in its reasoning, causing false tool calls
- TypeScript layer uses OpenAI function calling format (structured, not string-parsed)
- **Impact**: Rust core tool parsing is fundamentally less secure than TS layer
- **Fix**: Use structured JSON function calling (like TS layer) or mark Rust tool parsing as deprecated

**H3: No input validation on tool arguments**
- `tools.rs`: Tool implementations accept raw strings without validation
- `run_command` blocks shell metacharacters but `web_fetch` and `web_search` don't validate URLs
- **Impact**: SSRF potential in Rust core (TS layer has SSRF protection)
- **Fix**: Port URL validation from TS `tool-executor.ts` to Rust

**H4: Memory manager has no persistence**
- `memory.rs`: All data in `VecDeque` — lost on process exit
- TypeScript `PersistentMemory` persists to `.imzx/memory.json`
- **Impact**: Rust core memory is ephemeral, contradicting "self-improving" architecture
- **Fix**: Add JSON persistence or delegate memory entirely to TS layer

### MEDIUM

**M1: `candle-core` dependency unused**
- `Cargo.toml:24`: `candle-core = "=0.10.0"` is listed but `embedding.rs` only uses `Device::Cpu`
- candle-core is a heavy ML framework (~50MB compile artifacts) for a single enum use
- **Impact**: Bloated compile time and binary size
- **Fix**: Remove candle-core, use `Device` as a simple enum or remove device concept entirely

**M2: `scraper` dependency for web scraping**
- `Cargo.toml:22`: `scraper = "=0.19.0"` pulls in html5ever, cssparser, etc. (~2MB deps)
- Only used in `tools.rs` for `web_fetch` HTML parsing
- TypeScript layer uses regex-based HTML parsing (lighter)
- **Impact**: Heavy dependency for a single feature
- **Fix**: Use lightweight HTML parsing or delegate to TS layer

**M3: `reqwest` pinned to old version**
- `Cargo.toml:21`: `reqwest = "=0.11.27"` — current is 0.12.x
- 0.11 uses hyper 0.14, 0.12 uses hyper 1.0 — significant performance improvement in newer version
- **Impact**: Missing HTTP/2 improvements, potential security patches
- **Fix**: Upgrade to reqwest 0.12 (breaking API change) or document why pinned

**M4: No tests in Rust core**
- `core/src/` has no `#[cfg(test)]` modules
- `dev-dependencies` only has `tokio-test` — no test files
- CI runs `cargo test` but there's nothing to test
- **Impact**: Zero test coverage for Rust code
- **Fix**: Add unit tests for ToolCall parsing, MemoryManager, ContextManager

**M5: Orchestration strategies are stubs**
- `orchestration.rs:109+`: `get_execution_plan()` returns `ExecutionPlan::Single` for all strategies
- The 6 strategies (Router, Hierarchical, etc.) are defined but not implemented
- TypeScript `orchestration.ts` has working implementations
- **Impact**: Rust orchestration is non-functional
- **Fix**: Either implement or mark as "delegated to TypeScript layer"

### LOW

**L1: Version mismatch**
- `Cargo.toml:3`: `version = "0.3.0"` but package.json is `0.6.0`
- **Impact**: Confusing version drift
- **Fix**: Sync versions

**L2: `once_cell` redundant with std**
- `Cargo.toml:15`: `once_cell = "=1.19.0"` — `std::sync::LazyLock` is stable since Rust 1.80
- **Impact**: Unnecessary dependency
- **Fix**: Replace with `std::sync::LazyLock`

**L3: `async-trait` redundant with native async traits**
- `Cargo.toml:20`: `async-trait = "=0.1.80"` — native async traits stable since Rust 1.75
- **Impact**: Unnecessary proc-macro overhead
- **Fix**: Replace with native `async fn` in traits

**L4: No `#[deny(unsafe_code)]`**
- Rust core has no explicit unsafe ban
- **Impact**: Future code could introduce unsafe without guardrails
- **Fix**: Add `#![deny(unsafe_code)]` to lib.rs

**L5: `tracing` dependency unused**
- `Cargo.toml:18`: `tracing = "=0.1.40"` — no `tracing::info!()` or similar calls found
- **Impact**: Unused dependency
- **Fix**: Remove or add actual tracing instrumentation

---

## SUMMARY

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 2 | PyO3+NAPI conflict, global runtime |
| HIGH | 4 | Hash embedding, string tool parsing, no input validation, no memory persistence |
| MEDIUM | 5 | Unused deps (candle, scraper), old reqwest, no tests, stub orchestration |
| LOW | 5 | Version mismatch, redundant deps, no unsafe ban, unused tracing |

### Core Assessment

The Rust core is a **well-structured skeleton** with good security patterns (typed ToolCall, UntrustedObservation, ShellPolicy, secret zeroizing) but is **not production-ready**:

1. **Never compiled on Termux** — PyO3+NAPI dual target fails
2. **Never tested** — zero test coverage
3. **Inferior to TypeScript layer** — TS has better tool parsing (function calling), persistence, embeddings, orchestration
4. **Heavy dependencies** — candle-core, scraper, reqwest for features that work better in TS

### Recommendation

**Option A (Recommended)**: Strip Rust core to minimal NAPI bindings
- Remove PyO3, candle-core, scraper
- Keep: agent loop, tool registry, hooks, types, error
- Delegate: LLM calls, memory, embeddings, orchestration to TS
- Result: Fast compile, small binary, TS does the heavy lifting

**Option B**: Full Rust implementation
- Fix all HIGH findings
- Add tests for every module
- Upgrade dependencies
- Result: ~2-3 weeks work, but Rust core becomes genuinely useful

**Option C**: Remove Rust core entirely
- Pure TypeScript (current runtime path already does this)
- Simpler project, faster iteration
- Result: Lose NAPI-RS option, but gain simplicity

Mau pilih opsi yang mana?
