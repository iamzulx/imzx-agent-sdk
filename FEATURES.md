# 🚀 imzx Core Features

`imzx` is designed to be a production-ready Agent SDK that balances intelligence, performance, and absolute security.

## 🧠 1. Intelligent Orchestration
- **Dynamic LLM Routing**: Automatically selects the best provider based on real-time performance (latency) and cost. If a provider slows down, the system automatically shifts traffic to a faster one.
- **Planner-Worker Pattern**: Instead of simple reactions, the agent follows a structured cycle:
    - **Planning**: A high-intelligence model creates a step-by-step execution plan.
    - **Execution**: Efficient worker models execute the specific steps.
    - **Review**: The system validates the result against the original goal.
- **Weighted Scoring**: Customizable weights to prioritize either **Cost** (saving money) or **Latency** (speed).

## 🛡️ 2. Enterprise-Grade Security
- **Zero-Trust Shell**: Uses a strict **Allow-list** for shell commands. No arbitrary code execution is permitted.
- **Path Jailing & Blacklisting**: Prevents the agent from accessing files outside the project root and blocks access to sensitive files like `.env` or `.git`.
- **SSRF Protection**: The Web Scraper is prohibited from accessing local or private IP addresses, preventing internal network reconnaissance.
- **Environment Isolation**: Sub-processes are run in a clean environment to prevent leakage of system secrets.

## 💾 3. Advanced Memory System
- **Semantic Memory**: Uses GPT-2 tokenization and cosine similarity to retrieve the most relevant context from long-term history.
- **Real Tokenization**: Accurate token counting prevents context window overflows and allows for precise cost estimation.
- **Context Augmentation**: Automatically blends short-term history with long-term semantic memories for high-fidelity responses.

## 🛠️ 4. Powerful Toolset
- **Safe Web Scraper**: Extracts clean, usable text from the web while maintaining security.
- **Secure Database Access**: Read-only database connectivity for querying project data.
- **FileSystem Tool**: Securely read, write, and list files within a jailed environment.
- **Flexible Personas**: Easily define agent personalities via JSON files for specialized tasks.

## 📊 5. Observability & DX
- **Cost Dashboard**: Real-time tracking of token usage and estimated USD costs per session.
- **Interactive Setup**: A guided wizard that handles environment configuration and API key setup.
- **Persona CLI**: Manage your AI assistants' personalities directly from the terminal.
