# imzx-agent-sdk v0.7.0 — Full Audit Report

**Date**: 2026-06-21
**Auditor**: Automated deep analysis (55 TS + 14 Rust files, 7 competitor frameworks)
**Commit**: 22cdee7

---

## A. IMPLEMENTATION STATUS — Real vs Stub

| Feature | Claimed | Reality | Severity |
|---------|---------|---------|----------|
| ReAct Loop | ✅ | ✅ Real — budget, retry, compaction | — |
| LLM Providers (4) | ✅ | ✅ Real fetch() calls | — |
| Tool Executor (10) | ✅ | ✅ Real file/shell/web ops | — |
| MCP Client/Server | ✅ | ✅ Real JSON-RPC stdio+HTTP | ⚠️ Race condition in stdio |
| A2A Protocol | ✅ | ✅ Real HTTP+SSE+HMAC | ⚠️ Duplicate interface |
| Plugin System | ✅ | ✅ Real — load, hooks, npm, hot-reload | — |
| Auth Manager | ✅ | ✅ Real — scoped keys, SHA-256, audit | — |
| Persistent Memory | ✅ | ✅ Real — JSON, hybrid search | — |
| Knowledge Graph | ✅ | ✅ Real — entity extraction, persistence | ⚠️ Naive extraction |
| Conversation Checkpoints | ✅ | ✅ Real — WAL, undo/redo | — |
| HITL Manager | ✅ | ✅ Real — approval/reject/timeout | — |
| LLM Judge | ✅ | ✅ Real — rubric eval, actual LLM calls | ⚠️ Scoring math wrong |
| Cost Planner | ✅ | ✅ Real — pricing DB, estimation | — |
| Policy Engine | ✅ | ✅ Real — rule eval, conditions | ⚠️ Default-allow |
| Topology | ✅ | ✅ Real — Chain/Star/Mesh | ⚠️ Typo, no real consensus |
| Agent Lifecycle | ✅ | ✅ Real — state machine, health | ⚠️ CPU always 0 |
| **SLM Router** | ✅ | ❌ **No actual SLM calls** | 🔴 |
| **CUA Browser** | ✅ | ❌ **Just curl + regex, not a real browser** | 🔴 |
| **RAG Pipeline "GraphRAG"** | ✅ | ❌ **No graph integration — pure TF-IDF only** | 🔴 |
| **Anthropic Streaming** | ✅ | ❌ **Fake — blocking call, yields chunks post-hoc** | 🟡 |
| **Google/Ollama Tools** | ✅ | ❌ **Tools parameter ignored** | 🔴 |
| **Orchestration** | 6 strategies | ⚠️ No agent factory | 🟡 |
| **Telemetry "OpenTelemetry"** | OTel spans | ❌ Custom JSONL, no OTLP, latency always 0 | 🟡 |
| **Workflow Engine** | DAG execution | ❌ Data model only — no execution | 🟡 |
| **Context Summarizer** | LLM summary | ❌ Regex extraction only | 🟡 |
| **Reflection Engine** | Self-reflection | ❌ Template-based, not LLM | 🟡 |
| **Self-Modifier** | Prompt evolution | ❌ Suggestions only | 🟡 |

---

## B. 🔴 CRITICAL SECURITY ISSUES

| # | Issue | File | Impact |
|---|-------|------|--------|
| S1 | **Command injection in CUA browser** — `execSync(\`curl "${url}"\`)` — `$(cmd)` bypasses | `cua-browser.ts:167` | Remote code execution |
| S2 | **API key in Google URL** — `?key=${apiKey}` in logs | `llm-provider.ts:277` | API key exposure |
| S3 | **run_code executes with FULL env** — includes all API keys | `tool-executor.ts:554` | Credential leak |
| S4 | **Dashboard binds 0.0.0.0** — memory exposed to LAN | `dashboard/server.ts:27` | Data leak |
| S5 | **No path traversal on persona in API** | `server.ts:131` | Directory traversal |
| S6 | **Rate limiter unbounded Map** — OOM under attack | `server.ts:20` | DoS |
| S7 | **ReDoS in HITL rules** — `new RegExp(userInput)` | `hitl-manager.ts:269` | CPU hang |
| S8 | **ReDoS in Policy Engine** — `new RegExp(userInput)` | `policy-engine.ts:197` | CPU hang |
| S9 | **CORS `*` wildcard** on API + dashboard | `server.ts`, `dashboard/server.ts` | CSRF |
| S10 | **IPv6 bypass in IP allowlist** | `auth-manager.ts:84` | Allowlist bypass |

---

## C. 🟡 HIGH-PRIORITY CODE ISSUES

| # | Issue | File |
|---|-------|------|
| C1 | **SDK stream() race condition** | `sdk/index.ts:118-157` |
| C2 | **AgentService non-thread-safe** — currentPersona overwritten | `agent-service.ts:37` |
| C3 | **Duplicate A2AAdapterConfig interface** | `a2a-adapter.ts:52 vs 240` |
| C4 | **initOptionalModules errors swallowed** | `agent-engine.ts:76-88` |
| C5 | **INIT_MARKER wastes LLM API call** | `cli-handler.ts:211` |
| C6 | **Streaming cost: chars/4 underestimate** | `agent-engine.ts:389` |
| C7 | **Plugin hooks pre/post_llm_call never invoked** | `agent-engine.ts` + `plugin-system.ts` |
| C8 | **GitContext spawned every ReAct iteration** | `agent-brain.ts:170-180` |
| C9 | **Token estimation: toolsUsed.length * 1000** | `agent-brain.ts:88` |
| C10 | **Knowledge graph naive entity extraction** | `knowledge-graph.ts:141-161` |
| C11 | **O(n²) co-occurrence relations** | `knowledge-graph.ts:171-175` |
| C12 | **MCP StdioTransport resolves before handshake** | `mcp-adapter.ts:105-107` |
| C13 | **Anthropic tool results as user messages** | `llm-provider.ts:193` |
| C14 | **Telemetry interval never unref'd** | `telemetry.ts:72` |
| C15 | **Debounce writes lose data** | `knowledge-graph.ts:218`, `auth-manager.ts:176` |
| C16 | **/history CLI broken** | `cli-handler.ts:265` |
| C17 | **Rust bindings only ARM64 paths** | `rust-bindings-adapter.ts:47-50` |

---

## D. ARCHITECTURE VIOLATIONS

| # | Violation |
|---|-----------|
| A1 | Domain layer depends on Zod (`domain/personas/types.ts`) |
| A2 | AgentBrain imports from tools layer (GitContext, Telemetry, SecurityGuardrails) |
| A3 | AgentEngine imports tool-executor directly (external→tools adapter) |
| A4 | Singleton anti-pattern everywhere (auth, policy, hitl, cost, slm, rag) |
| A5 | SDK barrel exports 20+ internals |
| A6 | Duplicate auth logic (cli-handler.ts + auth-command.ts) |

---

## E. OWASP AGENTIC AI TOP 10 COMPLIANCE

| OWASP Risk | Status | Notes |
|------------|--------|-------|
| ASI01 — Agent Goal Hijack | ⚠️ Weak | 63-line regex guardrails |
| ASI02 — Tool Misuse | ⚠️ Partial | No sandbox |
| ASI03 — Privilege Abuse | ✅ Good | Scoped API keys |
| ASI04 — Supply Chain | ⚠️ Partial | Plugin runs in-process |
| ASI05 — Code Execution | 🔴 Vulnerable | run_code full env, CUA injection |
| ASI06 — Memory Poisoning | ⚠️ Weak | No staleness detection |
| ASI07 — Inter-Agent Comm | ✅ Good | HMAC-SHA256 |
| ASI08 — Cascading Failures | ⚠️ Partial | Budget caps, no circuit breaker |
| ASI09 — Trust Exploitation | ⚠️ Partial | Basic output guard |
| ASI10 — Rogue Agents | ✅ Good | Policy engine, audit log |

---

## F. COMPETITIVE POSITION

### Ahead of competitors:
- Cost-aware planning (CostPlanner + SLM Router concept)
- SSRF protection built-in
- Self-improving system (memory + reflection + skills + self-mod)
- Clean Architecture layering
- Rust core performance potential

### Behind competitors:
- Tool sandboxing (OpenAI SDK has microVM)
- Prompt injection defense (OpenAI SDK has guardrails)
- Real OpenTelemetry (Mastra has it)
- Graph-based workflows (LangGraph core feature)
- Voice/realtime agents (OpenAI SDK native)
- Multi-agent agent factory (CrewAI, LangGraph)

---

## G. FIX PRIORITY PLAN

### 🔴 CRITICAL (10 items) — FIX NOW
1. S1: Fix command injection in CUA browser
2. S2: Move Google API key from URL to header
3. S3: Sandbox run_code — strip sensitive env vars
4. S4: Default dashboard to 127.0.0.1
5. S5: Add path traversal validation in API
6. S6: Cap rate limiter Map size
7. S7/S8: Validate regex patterns (ReDoS)
8. C3: Remove duplicate A2AAdapterConfig
9. Google/Ollama: Pass tools parameter
10. SLM Router: Wire up actual SLM calls or mark experimental

### 🟡 HIGH (15 items) — FIX THIS MONTH
1. C1: Fix SDK stream race condition
2. C2: Make AgentService stateless/per-request
3. C4: Log init errors instead of swallowing
4. C5: Remove INIT_MARKER LLM waste
5. C6: Fix streaming cost estimation
6. C7: Wire plugin pre/post_llm_call hooks
7. C8: Cache GitContext per-session
8. C10/C11: Improve entity extraction + limit co-occurrence
9. C12: Wait for MCP handshake
10. C13: Proper Anthropic tool_result format
11. C14: unref() telemetry interval
12. C15: Flush debounced writes on exit
13. C16: Fix /history CLI
14. C17: Rust bindings all platforms
15. LLM Judge scoring math fix

### 🟢 MEDIUM (10 items) — NEXT QUARTER
1. Real Anthropic SSE streaming
2. Agent factory for orchestration
3. Real OpenTelemetry (OTLP exporter)
4. Workflow execution engine
5. LLM-based context summarization
6. LLM-based reflection
7. IPv6 IP allowlist
8. Fix Rust bindings all platforms
9. Prompt caching
10. Eval CI/CD integration

---

## H. STATS

```
TypeScript:  55 files, 13,186 lines
Rust:        14 files, 0 clippy warnings, 9/9 tests pass
npm:         0 vulnerabilities
Git:         clean, commit 22cdee7
Tests:       6 files (vitest crashes on Termux ARM — Illegal instruction)
```
