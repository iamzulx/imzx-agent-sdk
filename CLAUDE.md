# Project: imzx

A dual-language (TypeScript & Python) Claude Agent SDK framework.

## Quick Start

### TypeScript
- **Install**: `cd imzx/typescript && npm install`
- **Run Example**: `cd imzx/typescript && npm start`
- **Typecheck**: `cd imzx/typescript && npm run typecheck`
- **Development**: `cd imzx/typescript && npm run dev`

### Python
- **Install**: `cd imzx/python && pip install -r requirements.txt`
- **Run Example**: `cd imzx/python && python coding.py`

## Project Structure

- `imzx/typescript/`: TypeScript implementation.
  - `src/`: Source code including:
    - `hello.ts`: Minimal "Hello World"
    - `basic.ts`: Agent with common features
    - `coding.ts`: Specialized coding agent
- `imzx/python/`: Python implementation.
  - `hello.py`: Minimal "Hello World"
  - `basic.py`: Agent with common features
  - `coding.py`: Specialized coding agent

## Coding Standards

- **TypeScript**:
  - Use ESM (`type: "module"`)
  - Strict type checking enabled
  - Use `for await...of` for streaming agent responses
- **Python**:
  - Use modern Python 3 syntax
  - Use `asyncio` patterns where applicable

## Security & Robustness

- **Input Sanitization**: Always sanitize user-provided strings (e.g., agent names, file paths) using allow-lists and `std::fs::canonicalize` to prevent Path Traversal attacks.
- **Path Jailing**: All filesystem operations must be constrained to the project root using a `root_dir` check.
- **Token Management**: Always use the `Tokenizer` in `MemoryManager` for accurate token counting. Never use raw byte or character lengths.
- **Runtime Efficiency**: Use the global `RUNTIME` singleton for all async operations in FFI layers to avoid overhead.
- **LlmProvider Pattern**: When adding new LLM support, implement the `LlmProvider` trait to maintain provider agnosticism.
- **Error Handling**: Ensure all FFI boundaries handle errors gracefully and update the Agent State to `Error` on failure.
- **Privacy**: Never use `println!` or `console.log` for user-sensitive data in the core logic.

... (rest of the file)

Create a `.env` file in the root directory with your API key:
`ANTHROPIC_API_KEY=your_api_key_here`
