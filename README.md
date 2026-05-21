# 🤖 imzx Agent SDK

**imzx** is a high-performance framework for creating AI Assistants (Agents). It utilizes a **Clean Architecture** pattern to provide a scalable, testable, and production-ready environment.

---

## 🌟 Quick Start Guide for Beginners (Non-Programmers)

If you are not a programmer, don't worry! You can still run and use imzx by following these simple steps.

### 1. Initial Setup (Installation)
Before starting, make sure you have the following installed:
- **Node.js** (Latest LTS version)
- **Git**

**Automatic Installation:**
Open your terminal/command prompt in the project folder and type:
```bash
chmod +x setup.sh && ./setup.sh
```
*This script will install the Node dependencies and create starter persona templates for you automatically.*

---

### 2. Connecting to AI (Adding LLM)
To make your assistant work, you need to provide an "API Key" from an AI provider (e.g., Anthropic/Claude).

1. Look for a file named `.env.example` in the root folder.
2. Copy/Duplicate that file and rename it to `.env`.
3. Open the `.env` file with a text editor (like Notepad) and enter your API key:
   `ANTHROPIC_API_KEY=your_api_key_here`
4. Save the file.

---

### 3. Creating Assistant Personalities (Adding Personas)
You can define who your assistant should be. All "personalities" are stored in the `domain/personas/` folder.

**How to create a new persona:**
1. Open the `domain/personas/` folder.
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
Run the TypeScript CLI from the project root:
```bash
npm start "Hello, who are you?" your-persona-name
```
*(Replace `your-persona-name` with the name of the JSON file you created in `domain/personas/`, without the `.json` extension. Omit it to use `general-purpose`.)*

---

## 🚀 Key Features for Users
- **Clean Architecture**: Highly modular and scalable design.
- **Ultra Fast**: Powered by a Rust core for maximum performance.
- **Smart Selection**: Automatically chooses the most cost-effective or fastest AI model (LLM Routing).
- **Strong Memory**: Capable of remembering long conversations using an advanced memory system.
- **Secure**: Built-in protections to ensure the AI cannot access private files on your computer.

## 📂 Simple Folder Structure
- `domain/`: Core agent logic and persona definitions.
- `application/`: Orchestration and use cases.
- `adapters/`: Connections to Rust engine and File System.
- `interfaces/`: Command Line Interface (CLI).
- `core/`: High-performance Rust engine.
- `bindings/`: Rust $\leftrightarrow$ TypeScript bridge.
- `.env`: Where you store your secret API keys.
