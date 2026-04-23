# 🤖 imzx Agent SDK

**imzx** is a high-performance framework for creating AI Assistants (Agents). You can easily build various types of assistants, such as a coding expert, a legal consultant, or a personal productivity assistant.

---

## 🌟 Quick Start Guide for Beginners (Non-Programmers)

If you are not a programmer, don't worry! You can still run and use imzx by following these simple steps.

### 1. Initial Setup (Installation)
Before starting, make sure you have the following installed:
- **Python** (Version 3.10 or newer)
- **Node.js** (If you wish to use the TypeScript version)
- **Git**

**Automatic Installation:**
Open your terminal/command prompt in the project folder and type:
```bash
chmod +x setup.sh && ./setup.sh
```
*This script will handle all the technical installation for you automatically.*

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
You can choose the Python version (simpler) or the TypeScript version.

**Using Python:**
```bash
cd app/python-cli
./venv/bin/python main.py "Hello, who are you?" your-persona-name
```
*(Replace `your-persona-name` with the name of the JSON file you created in the personas folder, without the .json extension)*

**Using TypeScript:**
```bash
cd app/typescript-cli
npm start "Hello, who are you?" your-persona-name
```

---

## 🚀 Key Features for Users
- **Ultra Fast**: Powered by a Rust core for maximum performance.
- **Smart Selection**: Automatically chooses the most cost-effective or fastest AI model (LLM Routing).
- **Strong Memory**: Capable of remembering long conversations using an advanced memory system.
- **Secure**: Built-in protections to ensure the AI cannot access private files on your computer.

## 📂 Simple Folder Structure
- `app/`: Where you run the assistant programs.
- `personas/`: Where you store various assistant personalities (JSON files).
- `.env`: Where you store your secret API keys.
- `core/`: (For Programmers) The main engine that powers all features.
