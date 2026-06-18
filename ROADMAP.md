# imzx-agent-sdk Roadmap

**Current Version**: v0.3.0
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

## v0.4.0 — Real Agent (In Progress)

**Goal**: Agent benar-benar fungsional — bukan stub/mock.

### Phase 1 — Bikin Agent Jalan (Core Functionality)

- *1.1 Fix function calling format* [DONE]
  AgentEngine masih pakai text parsing `Action:/Action Input:` — fragile.
  Pindah ke OpenAI native function calling format (tool_calls array dari response).
  LlmProvider.stream() sudah parse tool_calls, tapi AgentEngine.run() belum.

- **1.2 Budget enforcement** [DONE]
  `setBudget()` kosong. Tambah `checkBudget()` di setiap iterasi ReAct loop.
  Hitung dari `response.usage.inputTokens + outputTokens`, block kalau exceed.

- **1.3 Real cost tracking** [DONE]
  Token count masih heuristic (`content.length / 4`). Pakai `usage` dari LLM API response.
  Hitung cost dari harga model (per 1M tokens).

- **1.4 Conversation memory** [DONE]
  Setiap `run()` mulai dari 0 — tidak ada history. Tambah `conversationHistory`
  di AgentEngine yang persist antar panggilan. Tambah `clearHistory()` method.

- **1.5 Error recovery** [DONE]
  Kalau LLM API gagal (timeout, 429, 500), langsung error. Tambah retry logic
  (3x exponential backoff: 1s, 2s, 4s) + fallback ke model lain kalau ada.

- **1.6 Persona loading** [DONE]
  CLI load persona dari JSON tapi prompt tidak di-inject sebagai system message
  dengan benar. Fix flow: persona.prompt -> messages[0] system message.

### Phase 2 — Tools Real

- **2.1 Calculator (real)** [DONE]
  Implementasi: `new Function('return ' + expr)` dengan sandboxing, atau mathjs.

- **2.2 Web search (real)** [DONE]
  Integrasi: Tavily API / DuckDuckGo Lite scrape / Searxng.

- **2.3 File edit tool** [DONE]
  Tambah tool `edit_file(path, old_text, new_text)` — partial file edit.

- **2.4 Tool approval** [DONE]
  Sebelum execute tool berbahaya (write_file, run_command), minta user konfirmasi.

- **2.5 Rust CalculatorTool** [DONE]
  Implementasi actual math eval di Rust core.

- **2.6 Rust WebSearchTool** [DONE]
  Integrasi real web search (reqwest + search API).

- **2.7 Database tool cleanup** [DONE]
  Hapus atau implementasi SQLite.

### Phase 3 — Advanced Features

- **3.1 Multi-turn conversation** [DONE]
  Chat mode persist context antar user messages.

- **3.2 Code execution tool** [DONE]
  Tool `run_code(language, code)` — execute JS/Python snippet.

- **3.3 Agent state save/restore** [DONE]
  Serialize state ke JSON file, bisa resume setelah restart.

- **3.4 Multiple personas mid-chat** [DONE]
  `/persona <name>` switch tanpa restart.

- **3.5 Observability** [DONE]
  Log setiap step ke JSONL file.

- **3.6 Streaming polish** [DONE]
  Terminal spinner, progress bar, proper color coding.

---

## v0.5.0 — Self-Improving Agent (Completed 2026-06-18)

Based on Reflexion (Princeton/MIT), HyperAgents (Meta/Oxford 2026), SAGE (Peking 2026), Mem0, Hermes Agent.

- **5.1 Persistent Memory** [DONE] — cross-session memory (user prefs, corrections, knowledge, sessions)
- **5.2 Self-Reflection** [DONE] — after-task evaluation, lesson extraction, reflection injection
- **5.3 Skill System** [DONE] — save/load/search skills, auto-extraction from successful tasks
- **5.4 Self-Modification** [DONE] — performance tracking, prompt evolution, workflow optimization
- **5.5 AgentBrain** [DONE] — central coordinator wiring all 4 systems into ReAct loop

## v0.6.0 — Production Readiness (Future)

- **5.1** Real embeddings (fastembed-rs atau remote API)
- **5.2** NAPI binary build (cross-platform .node files)
- **5.3** npm publish
- **5.4** Python SDK
- **5.5** Web UI dashboard
- **5.6** Plugin system (load tools dari external file)

---

## References

- Building Effective Agents — Anthropic Engineering (Dec 2024)
- Effective Context Engineering — Anthropic Engineering (Sep 2025)
- Claude Agent SDK — code.claude.com/docs (Jun 2026)
- OpenAI Function Calling — platform.openai.com/docs (2024)
