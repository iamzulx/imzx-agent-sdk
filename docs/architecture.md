# imzx Agent Framework Architecture

The `imzx` framework is a production-ready SDK for building autonomous agents. It utilizes a **Clean Architecture (Hexagonal)** pattern to ensure a strict separation between business rules, application logic, and infrastructure.

## 🏗️ Architectural Overview

The project is divided into four distinct layers. Dependencies flow only inward: **Interfaces $\rightarrow$ Application $\rightarrow$ Domain $\leftarrow$ Adapters**.

### 1. Domain Layer (`/domain`)
The heart of the system. This layer is completely independent of any external framework or library.
- **Entities**: Core types like `Persona`.
- **Ports**: Interface contracts (e.g., `PersonaRepository`, `AgentEnginePort`) that define *what* the system needs without specifying *how* it's done.
- **Use Cases**: Pure business logic (e.g., `GetPersonaUseCase`) that implements the primary system rules.

### 2. Application Layer (`/application`)
The orchestration layer. It coordinates the flow of data between the domain and the infrastructure.
- **Services**: `AgentService` manages the lifecycle of an agent request, from persona retrieval to final execution.
- **DTOs**: Data Transfer Objects for clean communication between layers.

### 3. Adapter Layer (`/adapters`)
The infrastructure implementation. This layer handles all "dirty" details.
- **Persistence**: `FilePersonaRepository` implements the `PersonaRepository` port using the local filesystem.
- **External**: `RustBindingsAdapter` implements the `AgentEnginePort` by bridging to the high-performance Rust core via FFI.
- **Logging**: Integration with `pino` for structured observability.

### 4. Interface Layer (`/interfaces`)
The presentation layer. This is the only entry point for the user.
- **CLI**: `CliHandler` manages command-line arguments and output formatting.
- **Future**: This layer can be expanded to include REST APIs or GUI interfaces without touching the core logic.

---

## 🔄 Data Execution Flow

1. **User Request**: User invokes the CLI with a prompt and agent name.
2. **Presentation**: `CliHandler` validates input and calls `AgentService.execute()`.
3. **Orchestration**: `AgentService` calls `GetPersonaUseCase` to retrieve the agent's identity.
4. **Persistence**: `FilePersonaRepository` reads the JSON persona from disk.
5. **Execution**: `AgentService` sends the persona and prompt to `RustBindingsAdapter`.
6. **Core**: The Rust core processes the request and returns a response.
7. **Output**: The response flows back through the layers to the CLI for display.

## 🛠️ Tech Stack
- **Language**: TypeScript (Application) & Rust (Core Engine)
- **Validation**: Zod (Runtime type safety)
- **Bridge**: Rust FFI / NAPI-RS
- **Logging**: Pino
- **Architecture**: Clean Architecture / Hexagonal
