# imzx Agent SDK

A high-performance agent framework with a Rust core and Python/TypeScript bindings.

## 🚀 Architecture
The project is a high-performance agent framework with a Rust core and Python/TypeScript bindings.

- **`core/`**: The heart of the system. Implements the Agent State Machine, Tool Registry, and Semantic Memory Management. Uses an estimation-based token pruning system to prevent context overflow.
- **`bindings/`**: FFI bridge layers. 
    - Python: Uses **PyO3** for native module integration.
    - TypeScript: Uses **Neon** for high-speed Node.js bindings.
- **`app/`**: The orchestrator layer (CLI tools) with integrated security sanitization to prevent path traversal attacks.
- **`personas/`**: Agent configuration files.

## 🛠️ Build Instructions

### Core & Bindings
Build the Rust core and bindings (recommended on non-Termux environments for full SIMD/BF16 support):
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

## 🛡️ Advanced Memory
The system implements semantic retrieval using cosine similarity on local embeddings, allowing agents to maintain long-term context across vast conversation histories.
