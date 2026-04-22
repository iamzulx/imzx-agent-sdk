# imzx Agent Framework

A professional-grade, dual-language (TypeScript & Python) framework for building autonomous AI agents using the Claude Agent SDK.

## 🚀 Features

- **Dual-Language Support**: Full implementations in both TypeScript and Python.
- **Agent Personas**: Dynamic, JSON-based persona management for easy customization.
- **Robust Tooling**: Real-world filesystem, search, and write capabilities.
- **CLI Interface**: Easy-to-use command line for interacting with agents.
- **Production-Ready**: Includes automation scripts, testing suites, and CI/CD examples.

## 🛠️ Getting Started

### Prerequisites

- Node.js (v18+)
- Python (3.10+)
- Claude Code CLI installed and configured.

### Installation

Run the unified setup script:

```bash
chmod +x setup.sh
./setup.sh
```

### Running Agents

#### TypeScript
```bash
cd imzx/typescript && npm start
```

#### Python
```bash
cd imzx/python && ./venv/bin/python cli.py "Your prompt here" persona-name
```

## 📂 Project Structure

- `imzx/typescript/`: TypeScript implementation and tests.
- `imzx/python/`: Python implementation and tests.
- `imzx/personas/`: JSON files defining agent personas.
- `imzx/CLAUDE.md`: Project context for Claude Code.

## 🧪 Testing

### TypeScript
```bash
cd imzx/typescript && npx vitest run
```

### Python
```bash
cd imzx/python && pytest
```

## 🛡️ Security & Best Practices

- Uses `execFileNoThrow` to prevent command injection.
- Implements strict type checking and error handling.
- Follows the principle of least privilege in tool definitions.

## 🤝 Contributing

Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.
