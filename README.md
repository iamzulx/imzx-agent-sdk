# 🤖 imzx Agent SDK

**imzx** is a high-performance framework for creating AI Assistants (Agents). It utilizes a **Clean Architecture** pattern to provide a scalable, testable, and production-ready environment for building autonomous agents.

---

## 🌟 Quick Start Guide for Beginners

If you are not a programmer, don't worry! You can still run and use imzx by following these simple steps.

### 1. Initial Setup (Installation)
Before starting, make sure you have the following installed:
- **Python** (Version 3.10 or newer)
- **Node.js** (Latest LTS version)
- **Git**

**Automatic Installation:**
Open your terminal/command prompt in the project folder and type:
```bash
chmod +x setup.sh && ./setup.sh
```
*This script will handle all the technical installation, including Rust bindings, for you automatically.*

---

### 2. Connecting to AI (Adding LLM)
To make your assistant work, you need to provide an "API Key" from an AI provider (e.g., Anthropic/Claude).

1. Look for a file named `.env.example` in the root folder (or create a new `.env` file).
2. Open the `.env` file and enter your API key:
   `ANTHROPIC_API_KEY=your_api_key_here`
3. Save the file.

---

### 3. Creating Assistant Personalities (Adding Personas)
You can define who your assistant should be. All "personalities" are stored in the `personas/` folder.

**How to create a new persona:**
1. Open the `personas/` folder.
2. Create a new file ending in `.json` (e.g., `math-tutor.json`).
3. Fill it using this format:
   ```json
   {
     "description": "Patient Math Tutor",
     "prompt": "You are a very patient math teacher. Explain complex concepts in simple language and provide everyday examples."
   }
   ```
4. Save the file. Your assistant now has a new personality!

---

### 4. How to Run Your Assistant
The framework is now optimized for root-level execution.

**Using TypeScript (Recommended):**
```bash
npm start "Hello, who are you?" your-persona-name
```
*(Replace `your-persona-name` with the name of the JSON file you created, without the .json extension)*

**Using Python:**
```bash
cd app/python-cli
./venv/bin/python main.py "Hello, who are you?" your-persona-name
```

---

## 🚀 Key Features
- **Clean Architecture**: Decoupled layers for maximum maintainability.
- **Ultra Fast**: Powered by a Rust core for maximum performance.
- **Smart Selection**: Automatically chooses the most cost-effective or fastest AI model.
- **Strong Memory**: Capable of remembering long conversations using an advanced memory system.

## 📂 Project Structure (Clean Architecture)
- `domain/`: Core business rules and persona definitions.
- `application/`: Orchestration and use cases.
- `adapters/`: Infrastructure (Rust FFI, File system).
- `interfaces/`: User interfaces (CLI).
- `core/`: The high-performance Rust engine.
- `personas/`: Assistant personality configurations.
- `.env`: Secret API keys.
