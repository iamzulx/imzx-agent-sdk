# imzx-agent-sdk Architecture

## Overview

imzx-agent-sdk is a **self-improving** AI Agent framework built with Clean Architecture. The agent learns from every interaction — remembering user preferences, reflecting on task outcomes, extracting reusable skills, and optimizing its own performance over time.

## Layer Architecture

```
                    +-----------------------------------------+
                    |           Interfaces Layer               |
                    |  CLI (8 cmds) | REST API | SDK           |
                    +-------------------+---------------------+
                                        | calls
                    +-------------------v---------------------+
                    |         Application Layer                |
                    |  AgentService (orchestrator)             |
                    +-------------------+---------------------+
                                        | delegates
          +-----------------------------+-----------------------------+
          |                             |                             |
+---------v----------+    +-------------v-----------+    +-----------v----------+
|   Adapters Layer   |    |    Adapters Layer       |    |   Adapters Layer     |
|  External          |    |    Memory (Brain)       |    |   Tools              |
|  - AgentEngine     |    |  - AgentBrain           |    |  - ToolExecutor (10) |
|  - LlmProvider     |    |  - PersistentMemory     |    |  - Prompts           |
|  - RustBindings    |    |  - ReflectionEngine     |    |  - AgentLogger       |
|  - McpClient       |    |  - SkillManager         |    |                      |
+--------------------+    |  - SelfModifier         |    +-----------+----------+
          |               +---------------------------+                |
          |                             |                              |
          +-----------------------------+------------------------------+
                                        |
                    +-------------------v---------------------+
                    |           Domain Layer                   |
                    |  Persona | AgentEnginePort              |
                    +-----------------------------------------+
```

## Self-Improving Loop

```
Task Start
  |
  v
AgentBrain.processUserMessage()
  |-- Detect preferences ("jangan pakai X")
  |-- Detect corrections ("salah, seharusnya Y")
  v
AgentBrain.buildEnhancedPrompt()
  |-- Inject: persistent memory (prefs, corrections, knowledge)
  |-- Inject: reflections (lessons from past tasks)
  |-- Inject: relevant skills (proven workflows)
  |-- Inject: performance context (success rate, trend)
  v
ReAct Loop (think -> tool call -> observe -> repeat)
  |-- AgentBrain.onToolUse() tracks each tool
  |-- Budget enforcement (token + USD limits)
  |-- Context compaction (auto at 80% limit)
  |-- Error recovery (3x retry, exponential backoff)
  v
Task Complete
  |
  v
AgentBrain.onTaskEnd()
  |-- ReflectionEngine: evaluate outcome, extract lessons
  |-- SelfModifier: record metric, analyze trend
  |-- SkillManager: auto-extract skill if multi-tool success
  |-- PersistentMemory: save session summary
  v
Next Task (agent is smarter)
```

## Memory Types

| Type | Category | Persistence | Example |
|------|----------|-------------|---------|
| User Preferences | `user` | Cross-session | "Prefers concise responses" |
| Corrections | `correction` | Cross-session (high priority) | "Don't use TypeScript, use JavaScript" |
| Knowledge | `knowledge` | Cross-session | "Project uses Rust 1.95.0" |
| Sessions | `session` | Cross-session | "Task X succeeded with tools A, B, C" |
| Reflections | `session` | Cross-session | "What worked: multi-tool workflow" |
| Lessons | `knowledge` | Cross-session | "Always read file before editing" |
| Skills | `.imzx/skills/` | Cross-session | "express-rest-api: steps, gotchas, template" |

## Data Flow: Single Prompt

```
User: "Fix the bug in auth.py"
  |
  v
CLI.handleRun()
  -> AgentService.execute("general-purpose", prompt, {streaming: true})
    -> RustBindingsAdapter.initialize() -> AgentEngine.initialize()
      -> buildSystemPrompt() with tool guidance
      -> AgentBrain.buildEnhancedPrompt() injects memory/lessons/skills
    -> AgentEngine.runStreaming(prompt)
      -> LlmProvider.stream(messages, tools)
        -> POST /v1/chat/completions (OpenAI format)
      <- LLM returns tool_calls: [{name: "read_file", args: {path: "auth.py"}}]
      -> ToolExecutor.execute("read_file", {path: "auth.py"})
        -> fs.readFile("auth.py") -> file contents
      <- LLM returns tool_calls: [{name: "edit_file", args: {...}}]
      -> ToolExecutor.execute("edit_file", {...})
        -> User approval prompt (if IMZX_AUTO_APPROVE != true)
        -> fs.writeFile() -> "File edited"
      <- LLM returns text: "Fixed the bug in auth.py line 42"
      -> AgentBrain.onTaskEnd() -> reflection saved, metric recorded
  <- Stream chunks to CLI -> colored terminal output
```

## Security Model

```
Layer 1: Input Validation
  - Persona ID regex (^[a-zA-Z0-9_-]+$)
  - Path sanitization (canonicalize + blocked paths)
  - URL validation (HTTPS-only, private IP block)

Layer 2: Execution Guards
  - ShellTool command allowlist (14 commands)
  - Tool approval (interactive stdin for dangerous tools)
  - Rate limiting (60 req/min per IP on REST API)

Layer 3: Output Sanitization
  - UntrustedObservation (escape Action: patterns)
  - Smart truncation (70% head + 20% tail)
  - Tool result cap (50K chars)

Layer 4: Resource Limits
  - Budget (max tokens + max USD)
  - Max iterations (10)
  - Command timeout (30s)
  - Context compaction (auto at 80%)

Layer 5: Secret Management
  - SecretBox<String> for API keys (Rust)
  - .env file for API keys (TypeScript)
  - Optional API key auth for REST API
```

## Orchestration Strategies

| Strategy | Pattern | Use Case |
|----------|---------|----------|
| Router | Single model, weighted scoring | Default — pick best model |
| Hierarchical | Head plans, Workers execute | Complex multi-step tasks |
| Consensus | Parallel workers, Judge synthesis | High-confidence decisions |
| Chaining | Sequential steps with gates | Predictable pipelines |
| Evaluator-Optimizer | Generate -> Evaluate -> Refine | Quality-critical output |
| Parallelization | Multiple models simultaneously | Speed or diverse perspectives |

## Extension Points

### Adding a New Tool

1. Add definition in `adapters/tools/tool-executor.ts` (getToolDefinitions)
2. Add execution case in `executeTool()`
3. If dangerous: add to `DANGEROUS_TOOLS` set

### Adding a New Memory Category

1. Add type to `MemoryEntry['category']` in `persistent-memory.ts`
2. Add format rules in `formatForPrompt()`
3. Use: `brain.memory.save('new_category', key, content, {tags, importance})`

### Adding a New Reflection Pattern

1. Add detection in `reflection-engine.ts` extract methods
2. Update `formatReflection()` for storage format
3. Brain auto-wires reflection into prompt via `formatForPrompt()`

### Adding a New Skill Category

1. Use: `brain.skills.save({name, description, category, steps, ...})`
2. Skills auto-load via `skills.formatForPrompt(query)` in `buildEnhancedPrompt()`
