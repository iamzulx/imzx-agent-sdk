# 📝 PATHNOTES - Project Evolution

This file tracks the major architectural changes and updates implemented in the `imzx` Agent SDK.

## [2026-04-23] - The Evolution Update

### 🛡️ Fase 0: Security Hardening & Sandboxing
- **Shell Lockdown**: Replaced raw `sh -c` execution with a strict **Allow-list** approach. Only safe commands (e.g., `ls`, `git status`) can be executed.
- **Input Sanitization**: Implemented protection against shell metacharacters (`;`, `|`, `&`) to prevent command injection.
- **Path Jailing**: Enhanced `FileSystemTool` to prevent access to sensitive files like `.env`, `.git`, and system files (`passwd`, `shadow`) using a blacklist.
- **Environment Isolation**: Added `env_clear()` to shell executions to prevent leakage of system environment variables.

### 🛠️ Fase 1: Developer Experience (DX)
- **Interactive Setup Wizard**: Replaced the silent `setup.sh` with a guided wizard for API key configuration and dependency installation.
- **Persona CLI Manager**: Added subcommands to `main.py` to manage agent personalities (`persona list`, `persona add`, `persona delete`) without manual JSON editing.
- **Template Library**: Created a library of pre-made professional personas in `personas/templates/`.

### 🧠 Fase 2: Intelligence & Real-time Routing
- **Dynamic Metric Tracking**: Implemented a real-time latency monitor that tracks the moving average of provider response times.
- **Adaptive Routing**: Updated the `Orchestrator` to use these real-time metrics, automatically routing requests to the fastest provider.
- **Planner-Worker Orchestration**: Evolved the agent loop from simple ReAct to a **Planning $\rightarrow$ Execution $\rightarrow$ Review** cycle.
- **Smarter Planning**: Introduced a `Planner` role that generates a JSON-based execution plan for complex tasks.

### 🚀 Fase 3: Advanced Tooling & Observability
- **Safe Web Scraper**: Added a tool to extract clean text from URLs with built-in **SSRF Protection** to prevent internal network scanning.
- **Secure Database Tool**: Added a read-only SQLite connector that enforces `SELECT`-only queries.
- **Cost & Token Dashboard**: Implemented a session tracking system that monitors total tokens used and estimates USD costs in real-time.
