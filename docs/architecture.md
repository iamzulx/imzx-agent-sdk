# imzx Agent Framework Architecture

The `imzx` framework is designed as a dual-language (TypeScript & Python) wrapper around the Claude Agent SDK, providing a structured and production-ready environment for building autonomous agents.

## Core Components

### 1. Agent Persona System
Agents are defined by JSON-based "personas" stored in the `personas/` directory. Each persona contains:
- `description`: A brief summary of the agent's role.
- `prompt`: The detailed system prompt that guides the agent's behavior.

The framework validates these personas at runtime using **Pydantic** (Python) and **Zod** (TypeScript) to ensure they adhere to the required schema.

### 2. Dual-Language Implementation
The framework provides near-identical functionality in both TypeScript and Python:
- **Python implementation** leverages modern Python 3 features and `asyncio` for high-performance, non-blocking agent interaction.
- **TypeScript implementation** uses ESM and `for await...of` for efficient streaming of agent responses.

### 3. Tool Integration
Agents are equipped with a set of "tools" (filesystem, search, etc.) that allow them to interact with the real world. The framework follows the principle of least privilege and uses safe execution patterns (like `execFile` in TS and `subprocess.run` with argument lists in Python) to prevent command injection.

### 4. Observability & Logging
Professional-grade logging is integrated throughout the framework using:
- **Python**: The standard `logging` module.
- **TypeScript**: `pino`, a high-performance logger.

This allows for granular control over log levels and provides structured logs that are easy to ingest into observability platforms.

## Data Flow

1. **User Input**: A user provides a prompt and an agent name (persona) via the CLI.
2. **Initialization**: The CLI loads the corresponding persona from the JSON file and validates it.
3. **Agent Execution**: The framework initializes the agent with the validated persona and the requested tools.
4. **Streaming Response**: The agent's response is streamed back to the user in real-time.
