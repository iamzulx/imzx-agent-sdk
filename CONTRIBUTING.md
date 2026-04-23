# Contributing to imzx Agent Framework

Thank you for your interest in improving the imzx Agent Framework! We welcome contributions from developers of all skill levels.

## 🚀 Getting Started

### 1. Find an Issue
Check the GitHub issues tab for "good first issue" or "help wanted" tags. If you have an idea for a new feature or found a bug, feel free to open a new issue.

### 2. Set Up Your Environment
- Fork the repository.
- Clone your fork locally.
- Run the interactive setup wizard:
  ```bash
  chmod +x setup.sh && ./setup.sh
  ```

### 3. Development Workflow
- **Rust Core**: If you are modifying the engine, ensure you run `cargo build` in the `core/` directory.
- **Python/TypeScript Bindings**: After core changes, re-run the setup script to refresh the FFI layers.
- **Code Style**:
    - **Rust**: Use `cargo fmt`.
    - **Python**: Adhere to PEP 8.
    - **TypeScript**: Use ESM and strict typing.
- **Security First**: **CRITICAL!** Always ensure new features do not bypass our security model. Never allow raw shell execution or unvalidated path access.
- **Testing**: Every new feature or bug fix must include corresponding unit tests.

### 4. Submit a Pull Request
- Create a descriptive branch name (e.g., `feat/add-google-search-tool`).
- Ensure all tests pass locally.
- Provide a clear description of your changes in the PR.

## 🧩 Contribution Areas

- **New Personas**: Add specialized JSON profiles in `personas/`.
- **New Tools**: Implement new tools in `core/src/tools.rs`.
- **Documentation**: Improve the `README.md`, `FEATURES.md`, or `PATHNOTES.md`.
- **Core Engine**: Optimize the Rust-based routing or memory management.

## 🤝 Code of Conduct
We strive to maintain a welcoming and inclusive environment for all contributors. Please be respectful and constructive in your communication.
