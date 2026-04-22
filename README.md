# imzx Agent SDK

A high-performance agent framework with a Rust core and Python/TypeScript bindings.

## 🚀 Architecture
The project is a professional-grade agent framework designed for maximum performance and scalability.

- **`core/`**: The heart of the system. 
    - **Global Runtime**: Uses a singleton Tokio runtime to minimize FFI overhead.
    - **Semantic Memory**: Implements a sophisticated memory management system with real tokenization (GPT-2) and cosine similarity for long-term context retrieval.
    - **LlmProvider**: A trait-based system allowing pluggable LLM providers (currently supports Anthropic via `rig-core`).
- **`bindings/`**: High-speed FFI bridge layers. 
    - Python: Uses **PyO3** for native module integration.
    - TypeScript: Uses **Neon** for high-speed Node.js bindings.
- **`app/`**: The orchestrator layer (CLI tools) with integrated security sanitization to prevent path traversal attacks.
- **`personas/`**: Agent configuration files.

## 🛠️ Build Instructions

### Core & Bindings
Build the Rust core and bindings:
\`\`\`bash
# Build TS Bindings
cd bindings/typescript/core
cargo build --release

# Build Python Bindings
cd bindings/python
maturin develop
\`\`\`

### Running the CLI
\`\`\`bash
# TypeScript CLI
cd app/typescript-cli
npm install
npm start

# Python CLI
cd app/python-cli
pip install -r requirements.txt
python main.py
\`\`\`

## 📂 Project Structure
- `core/`: Rust core logic (Source of Truth).
- `bindings/`: Python and TS bridge layers.
- `app/`: Application implementations.
- `personas/`: Agent configuration files.

## 🛡️ Production-Ready Features
- **Real Tokenization**: Accurate token counting to prevent context window overflow.
- **Non-Blocking Runtime**: Optimized FFI bridge for low-latency responses.
- **Security Hardened**: Input sanitization for all user-provided parameters.
