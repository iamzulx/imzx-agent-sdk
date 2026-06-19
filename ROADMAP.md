# imzx-agent-sdk Roadmap

**Current Version**: v0.5.0
**Architecture**: Rust core (NAPI-RS) + TypeScript orchestration + Clean Architecture
**Last Updated**: 2026-06-19

---

## v0.2.0 — Security Hardening ✅ (Completed 2026-06-18)

All 15 security audit findings resolved.

---

## v0.3.0 — Agent Intelligence ✅ (Completed 2026-06-18)

5 new modules (hooks, subagent, streaming, context_manager, mcp_client).

---

## v0.4.0 — Real Agent ✅ (Completed 2026-06-18)

Phase 1-3 complete: function calling, budget, cost, memory, retry, persona,
10 real tools, REST API, SDK, knowledge graph, evaluator, guardrails.

---

## v0.5.0 — Self-Improving Agent ✅ (Completed 2026-06-19)

10 intelligence layers, 8 intelligence modules, all security audits fixed.
42 commits, 40 TS files, 14 Rust files, 6 test files, CI all green.

---

## v0.6.0 — Single Command CLI (In Progress)

**Goal**: `imzx` as a single command that works everywhere — like Claude Code, Aider, Codex.

### Phase 1 — Single Command CLI

- **1.1** Fix npm bin entry [TODO]
  - `package.json` bin: `"imzx": "./bin/imzx.mjs"`
  - Add shebang `#!/usr/bin/env node` to bin/imzx.mjs
  - Register tsx loader for TypeScript support
  - After `npm install -g .` → `imzx run "Hello"` works

- **1.2** Flatten CLI to top-level commands [TODO]
  - `imzx run "prompt"` — single prompt execution
  - `imzx chat` — interactive REPL
  - `imzx serve [--port 3000]` — REST API server
  - `imzx config set <key> <value>` — configure settings
  - `imzx config show` — show current config
  - `imzx personas list` — list personas
  - `imzx mcp connect <server>` — connect MCP server
  - `imzx --version` / `imzx --help`

- **1.3** Auto-load .env from project root [TODO]
  - Walk up from cwd to find .env
  - Also check ~/.imzx/.env for global config
  - Auto-detect provider from env vars (already done in LlmProvider.fromEnv)

- **1.4** Streaming UX polish [TODO]
  - Token-by-token output (not buffered)
  - Spinner animation while waiting
  - Color-coded tool calls (cyan), errors (red), thinking (dim)
  - Progress bar for multi-step tasks

- **1.5** npm publish preparation [TODO]
  - `npm publish` to npmjs.com
  - User can `npm install -g imzx-agent-sdk` → `imzx run "Hello"`
  - Version bump to 0.6.0

### Phase 2 — Cross-Platform Binary (Future)

- **2.1** Bundle with pkg/nexe for single binary
  - Output: `imzx-linux-x64`, `imzx-linux-arm64`, `imzx-macos-arm64`, `imzx-win-x64`
  - No Node.js dependency on target machine
  - Install script: `curl -sSL https://imzx.dev/install.sh | sh`

- **2.2** Android/Termux support
  - ARM64 binary for Termux
  - `pkg install imzx` or direct binary download
  - Works with Termux storage permissions

- **2.3** Auto-update mechanism
  - `imzx update` command
  - Check GitHub releases for new version
  - Download and replace binary

### Phase 3 — Autonomous Agent (Claude Code-class, Future)

- **3.1** Git-aware agent
  - Auto-detect git repo, read diff/branch/status
  - Auto-commit with descriptive messages
  - PR/MR creation from CLI

- **3.2** Project context loading
  - Auto-read CLAUDE.md, AGENTS.md, .cursorrules from project root
  - Inject project context into system prompt
  - Respect .gitignore patterns for file operations

- **3.3** Plugin system
  - `imzx plugin install <npm-package>`
  - Load tools from external npm packages
  - Plugin manifest: tools, hooks, persona presets

- **3.4** MCP server mode
  - `imzx mcp serve` — expose imzx tools as MCP server
  - Any MCP client (Cursor, Claude Code, etc.) can use imzx tools
  - Auto-register tools from connected MCP clients

- **3.5** Multi-model orchestration
  - `imzx run --model gpt-4o --fallback claude-sonnet`
  - Automatic model routing based on task complexity
  - Cost optimization: use cheap model for simple tasks

---

## v0.7.0 — Production Features (Future)

- **7.1** Real embeddings (replace hash-based LocalEmbedder)
- **7.2** NAPI binary build (cross-platform .node files)
- **7.3** Python SDK pip package (`pip install imzx-agent-sdk`)
- **7.4** Web UI dashboard
- **7.5** OpenTelemetry integration
- **7.6** Docker container with pre-configured MCP servers

---

## References

- Anthropic — Building Effective Agents (Dec 2024)
- Anthropic — Effective Context Engineering (Sep 2025)
- Claude Agent SDK — code.claude.com/docs (Jun 2026)
- OpenAI Function Calling — platform.openai.com/docs
- MCP Specification — modelcontextprotocol.io
- Mem0 — 58K stars, persistent memory (arXiv 2504.19413)
- Reflexion — self-reflection (Princeton/MIT 2023)
- HyperAgents — self-modifying agents (Meta/Oxford 2026)
- SAGE — self-evolving graph memory (Peking 2026)
- Stanford CS329A — Self-Improving AI Agents (2026)
- OWASP Top 10 for LLM Applications (2025)
- OWASP Top 10 for Agentic Applications (2026)
