# imzx-agent-sdk Roadmap

**Current Version**: v0.5.0
**Architecture**: Rust core (NAPI-RS) + TypeScript orchestration + Clean Architecture
**Last Updated**: 2026-06-18

---

## v0.2.0 — Security Hardening (Completed 2026-06-18)

All 15 security audit findings resolved (1 CRITICAL, 5 HIGH, 5 MEDIUM, 4 LOW).

---

## v0.3.0 — Agent Intelligence (Completed 2026-06-18)

5 new modules (hooks, subagent, streaming, context_manager, mcp_client).
6 orchestration strategies. Real agent engine (TypeScript ReAct loop).
CLI (7 subcommands), REST API (OpenAI-compatible), SDK (programmatic).
CI all green (Rust fmt/clippy/test + TypeScript typecheck).

---

## v0.4.0 — Real Agent (Completed 2026-06-18)

Agent benar-benar fungsional — bukan stub/mock.

### Phase 1 — Core Functionality

- **1.1** Fix function calling format [DONE] — OpenAI native tool_calls
- **1.2** Budget enforcement [DONE] — checkBudget() per iteration
- **1.3** Real cost tracking [DONE] — usage from API response
- **1.4** Conversation memory [DONE] — persist across run() calls
- **1.5** Error recovery [DONE] — 3x exponential backoff retry
- **1.6** Persona loading [DONE] — system prompt injection

### Phase 2 — Tools Real

- **2.1** Calculator (real) [DONE] — safeEval() sanitized math
- **2.2** Web search (real) [DONE] — DuckDuckGo Lite scraping
- **2.3** File edit tool [DONE] — edit_file(path, old, new)
- **2.4** Tool approval [DONE] — stdin prompt for dangerous tools
- **2.5** Rust CalculatorTool [DONE] — recursive descent parser
- **2.6** Rust WebSearchTool [DONE] — TS layer handles real search
- **2.7** Database tool cleanup [DONE]

### Phase 3 — Advanced Features

- **3.1** Multi-turn conversation [DONE] — chat REPL with history
- **3.2** Code execution tool [DONE] — run_code(language, code)
- **3.3** Agent state save/restore [DONE] — JSON serialization
- **3.4** Multiple personas mid-chat [DONE] — /persona command
- **3.5** Observability [DONE] — JSONL structured logging
- **3.6** Streaming polish [DONE] — thinking indicator, colors

### Improvements

- **S1** System prompt engineering [DONE] — tool guidance prompt
- **S2** Smart truncation [DONE] — 70% head + 20% tail
- **S3** Context window management [DONE] — auto-compact at 80%
- **S4** npx imzx command [DONE] — bin/imzx.mjs entry point
- **S5** TypeScript tests [DONE] — tool-executor.test.ts
- **S6** Better error messages [DONE] — 401/429/500 hints
- **S7** REST API rate limiting [DONE] — 60 req/min per IP
- **S8** API authentication [DONE] — Bearer token (optional)
- **S9** Graceful shutdown [DONE] — double Ctrl+C handler

---

## v0.5.0 — Self-Improving Agent (Completed 2026-06-18)

Based on Reflexion (Princeton/MIT), HyperAgents (Meta/Oxford 2026),
SAGE (Peking University 2026), Mem0, Hermes Agent.

- **5.1** Persistent Memory [DONE] — cross-session memory (user prefs, corrections, knowledge)
- **5.2** Self-Reflection [DONE] — after-task evaluation, lesson extraction
- **5.3** Skill System [DONE] — save/load/search skills, auto-extraction
- **5.4** Self-Modification [DONE] — performance tracking, trend analysis, workflow optimization
- **5.5** AgentBrain [DONE] — central coordinator wiring all systems into ReAct loop

---

## v0.6.0 — Production Readiness (Future)

- **6.1** Real embeddings (fastembed-rs or remote API)
- **6.2** NAPI binary build (cross-platform .node files)
- **6.3** npm publish
- **6.4** Python SDK
- **6.5** Web UI dashboard
- **6.6** Plugin system (load tools from external file)

---

## References

- Reflexion (Princeton/MIT 2023): verbal self-reflection in persistent memory
- HyperAgents (Meta/Oxford 2026): solve_task() + modify_self() self-modifying code
- SAGE (Peking University 2026): self-evolving graph memory engine
- Mem0 (48K stars): production-ready memory layer
- Stanford CS329A: Self-Improving AI Agents course (2026)
- Building Effective Agents — Anthropic Engineering (Dec 2024)
- Effective Context Engineering — Anthropic Engineering (Sep 2025)
- Claude Agent SDK — code.claude.com/docs (Jun 2026)
- OpenAI Function Calling — platform.openai.com/docs (2024)
