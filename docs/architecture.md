# imzx-agent-sdk Architecture

## Overview

imzx-agent-sdk is a production-ready AI Agent framework built with Clean Architecture (Hexagonal) principles. The system separates business rules from infrastructure through four distinct layers with strict dependency direction.

## Layer Architecture

```
                    ┌─────────────────────────────────┐
                    │         Interfaces Layer         │
                    │  CLI · REST API · SDK            │
                    └──────────────┬──────────────────┘
                                   │ calls
                    ┌──────────────▼──────────────────┐
                    │       Application Layer          │
                    │  AgentService · UseCases         │
                    └──────────────┬──────────────────┘
                                   │ delegates
                    ┌──────────────▼──────────────────┐
                    │        Adapters Layer            │
                    │  AgentEngine · LlmProvider       │
                    │  ToolExecutor · MCP · RustBridge │
                    └──────────────┬──────────────────┘
                                   │ implements
                    ┌──────────────▼──────────────────┐
                    │         Domain Layer             │
                    │  Persona · AgentEnginePort       │
                    └─────────────────────────────────┘
```

**Dependency Rule**: Dependencies point inward only. Domain has zero external dependencies.

## Data Flow

### Single Prompt Execution

```
User Input
  → CliHandler.handle()
    → AgentService.execute(persona, prompt)
      → GetPersonaUseCase.execute()        [Domain]
        → FilePersonaRepository.findById()  [Adapter]
      → RustBindingsAdapter.initialize()    [Adapter]
        → Try NAPI (Rust core)
        → Fallback: AgentEngine (TypeScript)
      → AgentEngine.run(prompt)
        → LlmProvider.complete(messages, tools)  [LLM API]
        → Parse tool calls from response
        → ToolExecutor.execute(name, args)        [Tool]
        → Loop: feed result back to LLM
        → Return final answer
    → Format response
  → Display to user
```

### ReAct Loop (AgentEngine)

```
┌──────────────────────────────────────────────┐
│                 ReAct Loop                    │
│                                               │
│  1. Send prompt + tools to LLM               │
│  2. LLM responds with text OR tool calls     │
│  3. If text only → return as final answer    │
│  4. If tool call → execute tool              │
│  5. Feed tool result back to LLM             │
│  6. Go to step 2 (max 10 iterations)         │
│                                               │
│  Hooks fire at each step:                     │
│  - PreToolUse (validate/block/transform)      │
│  - PostToolUse (log/audit)                    │
│  - OnIteration (monitor)                      │
│  - OnBudgetWarning (cost guard)               │
└──────────────────────────────────────────────┘
```

## Rust Core Modules

### Module Dependency Graph

```
lib.rs (NAPI-RS / PyO3 bindings)
  └── agent.rs (ReAct loop)
        ├── tools.rs (ToolCall, ToolRegistry, UntrustedObservation)
        ├── llm.rs (LlmProvider, ModelRegistry, OpenRouterProvider)
        ├── hooks.rs (HookRegistry, HookEvent, AuditHook, RateLimiter, CostGuard)
        ├── context_manager.rs (ContextManager, Priority, CompactionStrategy)
        ├── memory.rs (MemoryManager)
        ├── embedding.rs (LocalEmbedder)
        └── orchestration.rs (Orchestrator, 6 strategies)
              └── strategy.rs (WeightedScorer)

subagent.rs (SubagentOrchestrator)
  ├── agent.rs
  └── llm.rs

streaming.rs (StreamCollector, TokenStream)
  └── (standalone, used by agent.rs)
```

### Key Types

| Module | Key Types | Purpose |
|--------|-----------|---------|
| agent.rs | `Agent`, `AgentState`, `BudgetConfig`, `SessionStats` | Core agent with state machine |
| tools.rs | `ToolCall`, `ToolCallValidator`, `UntrustedObservation`, `ToolRegistry` | Secure tool execution |
| llm.rs | `LlmProvider` (trait), `ModelRegistry`, `OpenRouterProvider` | LLM abstraction |
| hooks.rs | `Hook` (trait), `HookRegistry`, `HookEvent`, `HookResult` | Middleware system |
| context_manager.rs | `ContextManager`, `ContextEntry`, `Priority`, `CompactionStrategy` | Token budgeting |
| subagent.rs | `Subagent`, `SubagentOrchestrator`, `SubagentTask`, `SubagentResult` | Child agents |
| streaming.rs | `StreamChunk`, `StreamCollector`, `TokenStream` | SSE streaming |
| orchestration.rs | `Orchestrator`, `OrchestrationStrategy`, `ExecutionPlan`, `ComplexityLevel` | Coordination |

## Security Model

### Defense in Depth

```
Layer 1: Input Validation
  - Persona ID regex (^[a-zA-Z0-9_-]+$)
  - Path sanitization (canonicalize + starts_with)
  - URL validation (HTTPS-only, private IP block)

Layer 2: Execution Guards
  - ShellTool command allowlist (exact match)
  - ToolCallValidator (pre-execution hook)
  - RateLimiterHook (calls per minute)

Layer 3: Output Sanitization
  - UntrustedObservation (escape Action: patterns)
  - [UNTRUSTED OBSERVATION] markers
  - Tool result truncation (50K chars)

Layer 4: Resource Limits
  - BudgetConfig (max tokens + max USD)
  - CostGuardHook (budget threshold blocking)
  - Max iterations (10)
  - Command timeout (30s)

Layer 5: Secret Management
  - SecretBox<String> for API keys
  - Zeroize on Drop
  - Error body redaction
```

## Extension Points

### Adding a New Tool

1. Add tool definition in `adapters/tools/tool-executor.ts` (getToolDefinitions)
2. Add execution case in `executeTool()` function
3. For Rust: implement `Tool` trait in `core/src/tools.rs`, register in `ToolRegistry::new()`

### Adding a New LLM Provider

1. Implement `LlmProvider` trait in `core/src/llm.rs`
2. Register in `ModelRegistry`
3. For TypeScript: modify `LlmProvider` class in `adapters/external/llm-provider.ts`

### Adding a New Hook

1. Implement `Hook` trait in `core/src/hooks.rs`
2. Register via `agent.hooks.register(Arc::new(MyHook::new()))`

### Adding a New Orchestration Strategy

1. Add variant to `OrchestrationStrategy` enum in `core/src/orchestration.rs`
2. Implement logic in `Orchestrator::get_execution_plan()`
3. Add to `Orchestrator::route_selection()` if model selection needed
