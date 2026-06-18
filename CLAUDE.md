# Project: imzx-agent-sdk

**Self-improving** AI Agent framework — Rust core (NAPI-RS) + TypeScript orchestration with Clean Architecture.

## Quick Start

```bash
npm install --ignore-scripts
cp .env.example .env  # Set API key
npx tsx interfaces/cli/cli-handler.ts run "Hello"
npx tsx interfaces/cli/cli-handler.ts chat  # Interactive REPL
```

## Architecture

Clean Architecture with 4 layers:
- **Domain** (`domain/`): Pure types — Persona, AgentEnginePort
- **Application** (`application/`): AgentService orchestrator
- **Adapters** (`adapters/`): AgentEngine, LlmProvider, ToolExecutor, Memory, MCP
- **Interfaces** (`interfaces/`): CLI, REST API, SDK

## Self-Improving System (v0.5.0)

The agent learns and improves over time via 4 systems:

1. **PersistentMemory** (`adapters/memory/persistent-memory.ts`)
   - Cross-session memory: user prefs, corrections, knowledge, sessions
   - Auto-detect preferences ("jangan pakai X" → saved)
   - Auto-detect corrections ("salah" → saved with high priority)
   - Keyword + recency + importance scoring

2. **ReflectionEngine** (`adapters/memory/reflection-engine.ts`)
   - After-task self-evaluation: what worked, what failed, lessons
   - Automatic lesson extraction stored in memory
   - Reflection injection into future prompts

3. **SkillManager** (`adapters/memory/skill-manager.ts`)
   - Save/load/search reusable skills
   - Auto-skill extraction from successful multi-tool tasks
   - Success/failure rate tracking

4. **SelfModifier** (`adapters/memory/self-modifier.ts`)
   - Performance metrics tracking
   - Trend analysis (improving/stable/declining)
   - Workflow optimization (learn best tool sequences)

5. **AgentBrain** (`adapters/memory/agent-brain.ts`)
   - Central coordinator wiring all 4 systems into ReAct loop
   - `buildEnhancedPrompt()` — injects memory + reflections + skills + performance
   - `onTaskStart/End` lifecycle hooks

## Rust Core (`core/src/`)

14 modules: agent, tools, llm, hooks, subagent, streaming, context_manager, orchestration, memory, embedding, strategy, types, error, lib

## TypeScript Agent Engine (`adapters/external/`)

When Rust NAPI module is not available, falls back to pure TypeScript:
- `agent-engine.ts` — Full ReAct loop with streaming + brain integration
- `llm-provider.ts` — OpenAI-compatible HTTP client
- `tool-executor.ts` — 10 real tools

## Tools (10)

read_file, write_file, edit_file, list_directory, run_command, search_files, web_search, web_fetch, calculate, run_code

Dangerous tools (require approval): write_file, edit_file, run_command, run_code

## CLI Commands

```bash
npx tsx interfaces/cli/cli-handler.ts run "prompt" [--persona X] [--stream] [--budget-usd N]
npx tsx interfaces/cli/cli-handler.ts chat  # Interactive REPL with /stats /persona /reset /help
npx tsx interfaces/cli/cli-handler.ts serve --port 3000  # REST API
npx tsx interfaces/cli/cli-handler.ts personas list
npx tsx interfaces/cli/cli-handler.ts stats
npx tsx interfaces/cli/cli-handler.ts help
```

## Environment Variables

- `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY` / `IMZX_API_KEY` — LLM API key
- `IMZX_LLM_BASE_URL` — Custom endpoint (default: OpenRouter)
- `IMZX_MODEL` — Model name (default: anthropic/claude-sonnet-4)
- `IMZX_AUTO_APPROVE` — Skip tool approval (default: false)

## CI Pipeline

2 jobs: Rust (fmt + clippy + test + build + audit) + TypeScript (typecheck + tests)

## Data Directory (.imzx/)

Auto-created at runtime:
- `memory.json` — persistent memory store
- `skills/` — saved skills (JSON files)
- `metrics.json` — performance metrics
- `modifications.json` — self-modification audit log
- `logs/` — JSONL observability logs

## License

MIT — Copyright (c) 2026 Iamzulx
