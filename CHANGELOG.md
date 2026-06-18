# Changelog

All notable changes to imzx-agent-sdk are documented in this file.

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
