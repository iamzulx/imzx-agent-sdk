# imzx-agent-sdk Security Roadmap

**Audit Date**: 2026-06-18
**Completion Date**: 2026-06-18
**Scope**: Full codebase (~25 files, TypeScript + Rust + Bash)
**Total Findings**: 15 (1 CRITICAL, 5 HIGH, 5 MEDIUM, 4 LOW)
**Status**: ✅ ALL 15 FINDINGS RESOLVED

---

## Phase 1 — Critical & Quick Wins

### 1.1 [H1] setup.sh eval() Injection → Instant RCE
- **Status**: Done
- **File**: `setup.sh:26`
- **Problem**: `eval "$var_name=\"$input\""` executes user input as bash code
- **Fix**: Replace with `printf -v "$var_name" '%s' "$input"`
- **Effort**: 1 line change
- **Reference**: https://www.shellcheck.net/wiki/SC2294

### 1.2 [C1] Prompt Injection → Arbitrary Tool Execution
- **Status**: Done
- **Files**: `core/src/agent.rs:189-213`, `core/src/tools.rs`
- **Problem**: LLM output parsed as `Action:` / `Action Input:` and directly executed without agent-level validation
- **Fix**:
  1. Parse LLM tool output into typed `enum ToolCall` (not raw strings)
  2. Add `ToolCallValidator` trait with pre-execution hook
  3. Add `UntrustedObservation` wrapper to sanitize tool outputs before feeding back to memory/LLM
  4. Strip/escape `Action:` patterns in observation content
- **Effort**: Medium — structural change to agent loop + tool registry
- **References**:
  - OWASP LLM01 Prompt Injection: https://genai.owasp.org/llmrisk/llm01-prompt-injection/
  - Anthropic Building Effective Agents: https://www.anthropic.com/engineering/building-effective-agents
  - Guardrails AI pattern: https://github.com/guardrails-ai/guardrails
  - Lilian Weng ReAct safety: https://lilianweng.github.io/posts/2023-06-23-agent/

---

## Phase 2 — HIGH Severity Fixes

### 2.1 [H5] API Key Plaintext Storage & Error Leak
- **Status**: Done
- **Files**: `core/src/llm.rs:78-79`, `core/src/llm.rs:123-126`, `setup.sh:52-57`
- **Problem**: API key stored as plain `String`, no zeroize on drop, error body may leak key
- **Fix**:
  1. Replace `api_key: String` with `api_key: SecretBox<String>` (secrecy crate)
  2. Implement `Drop` with zeroize
  3. Redact error body before propagation (don't include response text in errors)
  4. Fix `.env` race window (umask before open, not after)
- **Effort**: Low
- **Cargo.toml additions**: `secrecy = "0.10"`, `zeroize = "1"`
- **References**:
  - secrecy crate: https://docs.rs/secrecy/latest/secrecy/
  - zeroize crate: https://docs.rs/zeroize/latest/zeroize/

### 2.2 [H3] WebScraper DNS Rebinding
- **Status**: Done
- **File**: `core/src/tools.rs:253-258`
- **Problem**: DNS resolve → IP check → HTTP request has a time gap; attacker DNS server can rebind hostname to private IP after check
- **Fix**: Implement custom `reqwest::dns::Resolve` trait that validates IPs at resolve time (inside reqwest connection pipeline), eliminating the gap entirely
- **Effort**: Medium
- **References**:
  - reqwest PR #1653 (custom DNS): https://github.com/seanmonstar/reqwest/pull/1653
  - reqwest Issue #1515 (IP limiting): https://github.com/seanmonstar/reqwest/issues/1515
  - Resolve trait: https://github.com/seanmonstar/reqwest/blob/master/src/dns/resolve.rs

### 2.3 [H4] FileSystemTool TOCTOU Race Condition
- **Status**: Done
- **File**: `core/src/tools.rs:42-85`
- **Problem**: `canonicalize()` → then `read/write` — symlink can be swapped between validation and execution
- **Fix**:
  1. Use `OpenOptions::custom_flags(O_NOFOLLOW | O_CLOEXEC)` to prevent symlink following
  2. Or adopt `cap-std` crate for capability-based filesystem (atomic check+open)
  3. Verify path via `/proc/self/fd/N` readlink AFTER open
- **Effort**: Low-Medium
- **References**:
  - cap-std: https://docs.rs/cap-std
  - nix::fcntl::openat: https://docs.rs/nix
  - openat crate: https://docs.rs/openat

### 2.4 [H2] ShellTool Argument Injection
- **Status**: Done
- **File**: `core/src/tools.rs:138-177`
- **Problem**: Allowlist uses `starts_with` matching — `git log --malicious-flag` passes validation
- **Fix**:
  1. Define `ShellPolicy` struct per command with exact allowed arguments
  2. Strict exact-match on argument count and values
  3. Block all flags not explicitly allowlisted
  4. Remove `cargo run` from allowlist (can compile+execute arbitrary code)
- **Effort**: Low

---

## Phase 3 — MEDIUM Severity Fixes

### 3.1 [M1] TsAgent Silent Error Swallowing
- **Status**: Done
- **File**: `core/src/lib.rs:82-84`
- **Fix**: Return `Result<String, String>` from NAPI binding, propagate Rust errors to TypeScript

### 3.2 [M2] HTTP Allowed in WebScraper
- **Status**: Done
- **File**: `core/src/tools.rs:244`
- **Fix**: Reject `http://`, only allow `https://`

### 3.3 [M3] Memory Content Injection (Secondary Prompt Injection)
- **Status**: Done
- **Files**: `core/src/memory.rs:25-33`, `core/src/agent.rs:217-221`
- **Fix**:
  1. Wrap tool observations with `[UNTRUSTED]` tag
  2. Escape `Action:` / `Action Input:` patterns in stored content
  3. Use structured markers: `<<<OBSERVATION_START>>>` / `<<<OBSERVATION_END>>>`

### 3.4 [M4] No Rate Limiting / Budget Cap
- **Status**: Done
- **File**: `core/src/agent.rs`
- **Fix**: Add `budget_usd: f64` and `max_tokens: u64` fields to Agent, halt when exceeded

### 3.5 [M5] ShellTool PATH Hardcoded
- **Status**: Done
- **File**: `core/src/tools.rs:168`
- **Fix**: Detect system PATH at initialization or expose as configuration

---

## Phase 4 — LOW Severity Fixes

### 4.1 [L1] Unpinned Dependencies
- **Status**: Done
- **Files**: `core/Cargo.toml`, `package.json`
- **Fix**: Pin exact versions, commit `Cargo.lock`

### 4.2 [L2] Empty CI Pipeline
- **Status**: Done
- **File**: `.github/workflows/main.yml`
- **Fix**: Add `cargo test` + `cargo clippy` + `cargo audit` + `npm test`

### 4.3 [L3] Calculator Tool Misleading Results
- **Status**: Done
- **File**: `core/src/tools.rs:188-191`
- **Fix**: Return clear error for unimplemented expressions

### 4.4 [L4] Duplicate LlmProvider Trait
- **Status**: Done
- **Files**: `core/src/llm.rs`, `core/src/provider/mod.rs`
- **Fix**: Consolidate to single trait in `llm.rs`, update all imports

---

## Positive Findings (Already Good)

- Path traversal protection: regex + canonicalize + starts_with (3 layers)
- SSRF protection: private IP blocking + no-redirect policy
- Shell allowlist: env_clear() + restricted PATH + command whitelist
- Zod validation: PersonaSchema at domain boundary
- .gitignore: secrets properly excluded
- setup.sh: umask 077 for .env

---

## References

| Topic | URL |
|-------|-----|
| OWASP LLM Top 10 2025 | https://genai.owasp.org/llmrisk/llm01-prompt-injection/ |
| Anthropic Agents Guide | https://www.anthropic.com/engineering/building-effective-agents |
| Guardrails AI | https://github.com/guardrails-ai/guardrails |
| ReAct Safety (Lilian Weng) | https://lilianweng.github.io/posts/2023-06-23-agent/ |
| reqwest DNS resolver | https://github.com/seanmonstar/reqwest/pull/1653 |
| cap-std (TOCTOU fix) | https://docs.rs/cap-std |
| secrecy crate | https://docs.rs/secrecy/latest/secrecy/ |
| zeroize crate | https://docs.rs/zeroize/latest/zeroize/ |
| ShellCheck SC2294 | https://www.shellcheck.net/wiki/SC2294 |
| OWASP Command Injection | https://cheatsheetseries.owasp.org/cheatsheets/OS_Command_Injection_Defense_Cheat_Sheet.html |