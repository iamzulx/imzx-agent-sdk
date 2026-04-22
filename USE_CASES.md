# imzx Agent SDK Use Cases

This document provides real-world scenarios for using the imzx Agent SDK.

## 🚀 Use Case 1: Automated Code Reviewer
**Goal**: Automatically review pull requests for common bugs, style violations, and security vulnerabilities.

### Setup
Use the `code-reviewer` agent persona.
```bash
# Python
cd app/python-cli && python main.py "Review the changes in this PR for security vulnerabilities" code-reviewer

# TypeScript
cd app/typescript-cli && npm start "Review the changes in this PR for security vulnerabilities" code-reviewer
```

### Expected Result
The agent uses the filesystem tools to read the modified files, analyzes them against security best practices, and provides a detailed report with line-by-line suggestions.

---

## 🚀 Use Case 2: Domain-Specific Knowledge Assistant
**Goal**: Create an agent that is an expert in a specific technical domain (e.g., Kubernetes, AWS, or a proprietary internal API).

### Setup
1. Create a new persona JSON in `personas/k8s-expert.json`:
   ```json
   {
     "description": "K8s Expert",
     "prompt": "You are a world-class Kubernetes engineer. Provide precise, production-ready YAML and architectural advice."
   }
   ```
2. Run the agent:
   ```bash
   # Python
   cd app/python-cli && python main.py "How do I implement a Blue-Green deployment for a stateful set?" k8s-expert

   # TypeScript
   cd app/typescript-cli && npm start "How do I implement a Blue-Green deployment for a stateful set?" k8s-expert
   ```

### Expected Result
The agent provides a deep-dive technical explanation and the necessary YAML manifests, tailored to the "K8s Expert" persona.

---

## 🚀 Use Case 3: Project Documentation Auditor
**Goal**: Ensure that the project documentation is consistent with the actual code implementation.

### Setup
Use the `general-purpose` agent with a prompt focusing on audit.
```bash
# Python
cd app/python-cli && python main.py "Audit the README.md against the current file structure and identify any inconsistencies" general-purpose

# TypeScript
cd app/typescript-cli && npm start "Audit the README.md against the current file structure and identify any inconsistencies" general-purpose
```

### Expected Result
The agent lists all files in the project and compares them to the documentation, flagging missing files or outdated paths.
