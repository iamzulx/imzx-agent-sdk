# imzx-agent-sdk — Comprehensive Development Plan

**Generated**: 2026-06-20  
**Current Version**: v0.5.0  
**Based on**: Full codebase analysis + 2026 AI agent framework competitive landscape research

---

## EXECUTIVE SUMMARY

imzx-agent-sdk adalah **TypeScript-first self-improving AI agent framework** dengan Clean Architecture. Saat ini sudah memiliki foundation yang kuat: ReAct loop, 10 tools, persistent memory, self-reflection, skill system, knowledge graph, security guardrails, CLI + REST API + SDK.

**Unique positioning**: Satu-satunya framework yang natively menggabungkan self-improving (memory + reflection + skills + self-modification) dalam satu package TypeScript. Kompetitor terdekat (Mastra, OpenAI Agents SDK, LangGraph TS) tidak punya ini.

**Critical gaps** vs industri 2026:
1. CLI tidak bisa jalan sebagai single command (`imzx`)
2. Tidak ada A2A protocol support
3. Tidak ada durable execution / checkpointing
4. Knowledge graph in-memory only (hilang saat restart)
5. Embeddings pakai hash-based (bukan real vector)
6. Tidak ada evaluation framework
7. Plugin system masih skeleton

---

## PHASE 1 — Single Command CLI (v0.6.0) [PRIORITAS TERTINGGI]

**Mengapa**: Tanpa `imzx` sebagai single command, developer experience buruk. Harus `npx tsx interfaces/cli/cli-handler.ts run "Hello"` — ini deal-breaker untuk adoption.

### 1.1 Fix npm bin entry [ROADMAP sudah ada]
- `package.json` bin: `"imzx": "./bin/imzx.mjs"`
- Shebang `#!/usr/bin/env node` + tsx loader
- After `npm install -g .` → `imzx run "Hello"` works

### 1.2 Flatten CLI commands [ROADMAP sudah ada]
- `imzx run`, `imzx chat`, `imzx serve`, `imzx config`, `imzx personas`, `imzx mcp`
- Argument parsing (minimist atau commander)

### 1.3 Streaming UX polish [ROADMAP sudah ada]
- Token-by-token output (bukan buffered)
- Spinner animation (ora/spinner)
- Color-coded: tool calls (cyan), errors (red), thinking (dim)
- Progress bar untuk multi-step tasks

### 1.4 npm publish [ROADMAP sudah ada]
- `npm publish --access public` ke @iamzulx/imzx
- Version bump ke 0.6.0

---

## PHASE 2 — Persistent Intelligence (v0.7.0) [PRIORITAS TINGGI]

**Mengapa**: Knowledge graph, memory, dan skills hilang saat restart. Ini mengalahkan purpose "self-improving agent".

### 2.1 Persistent Knowledge Graph
- **Saat ini**: In-memory Map, hilang saat process exit
- **Target**: JSON persistence ke `.imzx/knowledge-graph.json`
- **Inspirasi**: Mem0 graph memory, SAGE paper (Peking University)
- **Effort**: ~2 jam (tambah save/load mirip PersistentMemory)

### 2.2 Real Embeddings (replace hash-based LocalEmbedder)
- **Saat ini**: Hash-based pseudo-embedding (bukan semantic)
- **Target**: 
  - Option A: OpenAI embeddings API (`text-embedding-3-small`) — mudah tapi butuh API key
  - Option B: Local embedding via `@xenova/transformers` (all-MiniLM-L6-v2, ~80MB)
  - Option C: TF-IDF + cosine similarity (zero-dependency, seperti RAG MCP server di Hermes)
- **Rekomendasi**: Option C dulu (zero-dep), lalu upgrade ke Option B
- **Effort**: ~4-6 jam

### 2.3 Vector Search untuk Memory
- **Saat ini**: Keyword matching + recency scoring
- **Target**: Hybrid search (keyword + vector similarity) seperti RRF pattern
- **Depends on**: 2.2 (embeddings)
- **Effort**: ~3 jam

### 2.4 Conversation Checkpoint (Durable Execution)
- **Saat ini**: State save/restore di agent-engine.ts (manual)
- **Target**: Auto-checkpoint setiap N iterations, crash recovery
- **Inspirasi**: LangGraph PostgresSaver, Pydantic AI durable execution
- **Pattern**: Write-ahead log ke `.imzx/checkpoints/`
- **Effort**: ~4 jam

---

## PHASE 3 — Protocol Hub (v0.8.0) [PRIORITAS TINGGI]

**Mengapa**: MCP sudah table stakes. A2A adalah differentiator besar — hanya Google ADK yang native support.

### 3.1 MCP Server Mode
- **Saat ini**: MCP client adapter ada, tapi tidak bisa expose tools AS MCP server
- **Target**: `imzx mcp serve` — expose 10 tools sebagai MCP server
- **Inspirasi**: Claude Agent SDK MCP integration
- **Effort**: ~3 jam

### 3.2 A2A Protocol Support
- **Saat ini**: Tidak ada
- **Target**: Implement `@a2aproject/a2a-js` protocol
- **Capabilities**: Agent discovery (Agent Card), task delegation, streaming
- **Unique**: Hanya Google ADK yang native — imzx bisa jadi yang kedua
- **Effort**: ~6-8 jam

### 3.3 Multi-Provider LLM Support Enhancement
- **Saat ini**: OpenAI-compatible API, auto-detect dari env vars
- **Target**: 
  - Anthropic native API (bukan hanya via OpenRouter)
  - Google Gemini API
  - Local model support (Ollama, llama.cpp server)
  - Model routing berdasarkan task complexity
- **Effort**: ~4 jam

---

## PHASE 4 — Evaluation & Observability (v0.9.0) [PRIORITAS SEDANG]

**Mengapa**: Tidak ada standardized agent evaluation framework. Ini gap besar di industri.

### 4.1 Agent Evaluation Framework
- **Saat ini**: AgentEvaluator ada tapi basic (3-level: tool, task, session)
- **Target**: 
  - Deterministic replay (simpan semua LLM calls, replay untuk testing)
  - Cost/latency/accuracy measurement per task type
  - Benchmark suite (SWE-bench style tasks)
- **Inspirasi**: Google ADK evaluation tools, LangSmith
- **Effort**: ~8 jam

### 4.2 OpenTelemetry Integration
- **Saat ini**: JSONL logger (agent-logger.ts) + trace collector (trace-collector.ts)
- **Target**: OTLP export ke Jaeger/Grafana/any OTel collector
- **Metrics**: Token usage, tool latency, success rate, cost per task
- **Effort**: ~4 jam

### 4.3 Web UI Dashboard
- **Saat ini**: REST API only
- **Target**: Simple dashboard (Hono + vanilla JS) untuk:
  - Real-time agent activity
  - Memory/skills browser
  - Performance charts
  - Configuration
- **Effort**: ~6 jam

---

## PHASE 5 — Autonomous Agent (v1.0.0) [PRIORITAS SEDANG]

**Mengapa**: Ini yang membedakan dari "hanya another API wrapper" — agent yang benar-benar autonomous.

### 5.1 Git-Aware Agent
- Auto-detect git repo, read diff/branch/status
- Auto-commit dengan descriptive messages
- PR/MR creation dari CLI
- **Effort**: ~4 jam

### 5.2 Project Context Loading
- Auto-read CLAUDE.md, AGENTS.md, .cursorrules dari project root
- Inject project context ke system prompt
- Respect .gitignore patterns
- **Effort**: ~3 jam

### 5.3 Plugin System (Real Implementation)
- **Saat ini**: Skeleton di plugin-system.ts
- **Target**: 
  - `imzx plugin install <npm-package>`
  - Plugin manifest: tools, hooks, persona presets
  - Hot-reload tanpa restart
- **Effort**: ~6 jam

### 5.4 Multi-Agent Orchestration
- **Saat ini**: 6 strategies defined (Router, Hierarchical, Consensus, Chaining, Evaluator-Optimizer, Parallelization) tapi belum wired ke real execution
- **Target**: Working multi-agent workflows
- **Inspirasi**: CrewAI role-based teams, LangGraph graph-based
- **Effort**: ~8 jam

---

## PHASE 6 — Production Polish (v1.1.0+) [PRIORITAS RENDAH]

### 6.1 Cross-Platform Binary
- Bundle dengan pkg/nexe untuk single binary
- Output: imzx-linux-x64, imzx-linux-arm64, imzx-macos-arm64, imzx-win-x64
- Android/Termux support (ARM64 binary)

### 6.2 Python SDK pip package
- `pip install imzx-agent-sdk`
- Wrapper around REST API

### 6.3 Docker Container
- Pre-configured MCP servers
- One-command deploy

### 6.4 Voice/Realtime Agent
- WebRTC integration
- Model-agnostic voice abstraction

---

## COMPETITIVE POSITIONING

```
                    TypeScript-First
                         ↑
                         |
            imzx-agent-sdk ★
                    (self-improving)
                         |
    Mastra ←────────────┼────────────→ LangGraph TS
    (Vercel-native)      |              (Python port)
                         |
                         ↓
                    Python-First
    
    ★ = UNIQUE POSITION: Only TS framework with 
        built-in self-improving (memory+reflection+skills+self-mod)
```

### Feature Matrix vs Kompetitor

| Feature | imzx | Mastra | OpenAI TS | LangGraph TS | Claude SDK |
|---------|------|--------|-----------|--------------|------------|
| TypeScript-first | ✅ | ✅ | ✅ | ❌ (port) | ✅ |
| Self-improving memory | ✅ | ❌ | ❌ | ❌ | ❌ |
| Knowledge graph | ✅ | ❌ | ❌ | ❌ | ❌ |
| Built-in tools (10) | ✅ | ✅ | ✅ | ❌ | ✅ |
| CLI interface | ✅ | ✅ | ❌ | ❌ | ✅ |
| REST API | ✅ | ✅ | ❌ | ❌ | ❌ |
| Budget/cost tracking | ✅ | ❌ | ❌ | ❌ | ❌ |
| MCP support | ✅ | ✅ | ✅ | ✅ | ✅ |
| A2A protocol | ❌ | ❌ | ❌ | ❌ | ❌ |
| Durable execution | ❌ | ❌ | ❌ | ✅ | ❌ |
| Evaluation framework | ❌ | ❌ | ✅ | ❌ | ❌ |
| Plugin system | 🔧 | ✅ | ❌ | ❌ | ❌ |
| Single binary | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## RECOMMENDED EXECUTION ORDER

```
Phase 1 (v0.6.0) → Single Command CLI [1-2 hari]
  ↓
Phase 2 (v0.7.0) → Persistent Intelligence [2-3 hari]
  ↓
Phase 3 (v0.8.0) → Protocol Hub (MCP server + A2A) [3-4 hari]
  ↓
Phase 4 (v0.9.0) → Evaluation & Observability [3-4 hari]
  ↓
Phase 5 (v1.0.0) → Autonomous Agent [4-5 hari]
  ↓
Phase 6 (v1.1.0+) → Production Polish [ongoing]
```

**Total estimated**: 15-20 hari untuk v1.0.0

---

## KEY REFERENCES

1. **LangGraph** — Graph-based state machines, checkpointing, time-travel debugging
2. **OpenAI Agents SDK** — 5 primitives (Agents, Handoffs, Guardrails, Sessions, Tracing)
3. **Claude Agent SDK** — Hooks, skills, subagents (powers Claude Code itself)
4. **Google ADK** — Native A2A support, TypeScript SDK, evaluation tools
5. **Mastra** — Only other TS-first framework (Vercel/Next.js opinionated)
6. **Mem0** — Persistent memory architecture (vector + graph)
7. **Reflexion** (Princeton/MIT) — Self-reflection pattern
8. **HyperAgents** (Meta/Oxford 2026) — Self-modifying agents
9. **SAGE** (Peking University 2026) — Self-evolving graph memory
10. **OWASP Agentic Top 10** (2026) — Security guardrails standard

---

## WHAT TO DO NEXT

**Immediate actions (hari ini):**
1. Fix `bin/imzx` entry — bikin `bin/imzx.mjs` dengan shebang + tsx loader
2. Test `npm install -g .` → `imzx run "Hello"` 
3. Persistent KnowledgeGraph — tambah save/load JSON

**This week:**
1. Phase 1 complete (single command CLI)
2. Phase 2.1 + 2.2 (persistent graph + real embeddings)
3. npm publish v0.6.0

**Mau mulai dari mana?**
