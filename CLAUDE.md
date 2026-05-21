# Project: imzx

A high-performance Claude Agent SDK framework implementing Clean Architecture (Hexagonal) for maximum scalability and maintainability.

## 🚀 Quick Start

### Installation
From the project root:
```bash
# Automatic setup (installs Node dependencies and persona templates)
chmod +x setup.sh && ./setup.sh
```

### Running the Agent
The project uses a root-level `package.json` for streamlined execution:
```bash
# Run the agent with a prompt and persona
npm start "Hello, how are you?" general-purpose
```

### Configuration
Create a `.env` file in the root directory:
`ANTHROPIC_API_KEY=your_api_key_here`

## 🏗️ Project Structure (Clean Architecture)

- `domain/`: Core business logic, entities (Personas), and ports (Interfaces).
- `application/`: Orchestration services and use cases.
- `adapters/`: Infrastructure implementations (Rust FFI, File System).
- `interfaces/`: Presentation layers (CLI Handler).
- `core/`: High-performance Rust engine (Core logic).
- `bindings/`: Rust $\leftrightarrow$ TypeScript FFI bridge.
- `domain/personas/`: JSON persona configurations and persona domain types.

## 🛠️ Coding Standards

### TypeScript
- **Architecture**: Strictly follow the Dependency Rule (Inner layers do not depend on outer layers).
- **Modules**: Use ESM (`type: "module"`).
- **Types**: Strict type checking enabled; use Zod for runtime validation.

### Rust
- **Performance**: Use the global `RUNTIME` singleton for async operations in FFI layers.
- **Safety**: Handle all FFI boundaries gracefully; update Agent State to `Error` on failure.

## 🛡️ Security & Robustness
- **Path Traversal**: All filesystem operations must use sanitized IDs (regex: `^[a-zA-Z0-9_-]+$`) and be constrained to the project root.
- **Token Management**: Always use the `Tokenizer` in `MemoryManager` for accurate token counting.
- **Privacy**: Never use `println!` or `console.log` for user-sensitive data in the core logic.
- **Secrets**: Never hardcode API keys; use `.env` files and `.gitignore`.

## 📖 Documentation
- For detailed architectural diagrams and flow, see `docs/architecture.md`.
