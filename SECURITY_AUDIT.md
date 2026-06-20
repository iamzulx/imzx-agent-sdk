# imzx-agent-sdk v0.6.0 — Full Security Audit Report

**Audit Date**: 2026-06-20  
**Auditor**: Hermes Agent  
**Scope**: Full codebase (51 TypeScript files, 14 Rust files, 1 Python file)

---

## CRITICAL (Must Fix Before Production)

### C1: No Authentication on Dashboard API ✅
**File**: `interfaces/dashboard/server.ts`  
**Risk**: Dashboard exposes ALL agent data (memory entries, skills, telemetry, graph) with NO auth or rate limiting. Anyone who knows the port (default 3100) gets full read access.  
**Impact**: Memory data leakage, credential exposure (memory stores API key corrections), full agent behavior visibility  
**Fix**: Add API key check (same as REST API), or at minimum localhost-only binding

### C2: No Authentication on A2A Protocol ✅
**File**: `adapters/external/a2a-adapter.ts`  
**Risk**: A2A server accepts tasks from ANY source. No auth, no origin validation, no signature verification. Attackers can send arbitrary tasks to be executed by the agent.  
**Impact**: Remote code execution via task delegation, agent hijacking  
**Fix**: Add Bearer token auth, origin validation, task type allowlist, rate limiting

### C3: Command Injection in GitContext ✅
**File**: `adapters/tools/git-context.ts` lines 149-158  
**Risk**: Git commit message and branch name use string interpolation into shell command:
```typescript
this.exec(`commit -m "${message.replace(/"/g, '\\"')}"`);
this.exec(`checkout -b "${name.replace(/"/g, '\\"')}"`);
this.exec(`add ${files.map((f) => `"${f}"`).join(' ')}`);
```
While quotes are escaped, backticks `$()` are NOT escaped. Input like `test$(whoami)` would execute.  
**Impact**: Arbitrary command execution via git commit messages or branch names  
**Fix**: Use `execFileSync('git', ['commit', '-m', message])` instead of string interpolation

### C4: XSS in Dashboard HTML ✅
**File**: `interfaces/dashboard/server.ts` lines 133-159  
**Risk**: Dashboard renders API response data directly into HTML via `innerHTML` and DOM manipulation. If memory entries contain malicious content (e.g., user stores `<script>alert(1)</script>` as a preference), it executes in the browser.  
**Impact**: XSS attack, cookie/session theft, arbitrary JS execution in dashboard context  
**Fix**: Use `textContent` instead of `innerHTML`, or sanitize HTML before insertion. The `h()` helper uses `createTextNode` which is safe, but `el.innerHTML=''` on the parent element could be an issue if combined with other patterns.

### C5: Arbitrary Code Execution via Plugin Dynamic Import ✅
**File**: `adapters/tools/plugin-system.ts` line 340  
**Risk**: `mod = await import(pathToFileURL(entryPath).href)` — ANY JavaScript file can be loaded as a plugin. If attacker can write to `.imzx/plugins/` or manipulate `node_modules/`, they can execute arbitrary code.  
**Impact**: Remote code execution via malicious plugin  
**Fix**: Add plugin signature verification, content hash validation, sandbox ALL plugin code execution (not just tools), restrict plugin directories to specific paths

### C6: Python SDK Auto-Starts Server Without Auth ✅
**File**: `interfaces/sdk/python/imzx.py` lines 76-84  
**Risk**: `ImzxAgent(auto_start=True)` starts `imzx serve` subprocess WITHOUT setting API key. Server is accessible to anyone on the network with no authentication.  
**Impact**: Any Python script using this SDK exposes agent to unauthenticated access  
**Fix**: Require API key when auto_start=True, or bind to localhost only

---

## HIGH (Should Fix Soon)

### H1: CORS Default to Wildcard ✅
**File**: `interfaces/api/server.ts` line 80  
**Risk**: `process.env.IMZX_CORS_ORIGIN || '*'` — CORS allows ALL origins by default. Combined with the REST API, this means any website can make requests to the agent.  
**Impact**: Cross-site request forgery (CSRF), data exfiltration via malicious websites  
**Fix**: Default to `localhost` or require explicit configuration

### H2: No Input Size Limit on HTTP Requests ✅
**File**: `interfaces/api/server.ts` line 274, `adapters/external/a2a-adapter.ts`  
**Risk**: No `Content-Length` limit on incoming HTTP requests. Attackers can send arbitrarily large payloads causing memory exhaustion.  
**Impact**: Denial of service (OOM), memory exhaustion  
**Fix**: Add max body size check (e.g., 10MB) before parsing JSON

### H3: No Rate Limiting on Dashboard ✅
**File**: `interfaces/dashboard/server.ts`  
**Risk**: Dashboard has no rate limiting. Any client can spam `/api/memory`, `/api/stats`, etc.  
**Impact**: DoS, resource exhaustion  
**Fix**: Add rate limiting (same as REST API — 60 req/min per IP)

### H4: No Rate Limiting on A2A Protocol ✅
**File**: `adapters/external/a2a-adapter.ts`  
**Risk**: A2A server accepts unlimited tasks.  
**Impact**: DoS, resource exhaustion, agent task flooding  
**Fix**: Add rate limiting per source IP

### H5: No Rate Limiting on MCP Server ✅
**File**: `adapters/tools/mcp-server-mode.ts`  
**Risk**: MCP server (stdio) — less critical since it's local, but if exposed via network, no rate limit.  
**Impact**: Low (stdio transport is local by design)

### H6: Memory Entries Can Contain Arbitrary Data ✅
**File**: `adapters/memory/persistent-memory.ts`  
**Risk**: Memory stores user input directly without sanitization. If user input contains malicious content and it's later rendered in dashboard or injected into system prompt, it could cause issues.  
**Impact**: Prompt injection via stored memory, XSS if rendered unsanitized  
**Fix**: Sanitize memory entries on storage, validate max size per entry

### H7: Plugin npm install Without Verification ✅
**File**: `adapters/tools/plugin-system.ts` line 578  
**Risk**: `execFileSync('npm', ['install', packageName, '--prefix', pluginDir])` — installs ANY npm package without verification. Could install malicious package.  
**Impact**: Supply chain attack via malicious npm package  
**Fix**: Add package verification (checksum, known-good registry), require explicit user confirmation

### H8: Telemetry Data Contains Sensitive Info ✅
**File**: `adapters/tools/telemetry.ts`  
**Risk**: Telemetry spans store LLM messages (including system prompts with API keys), tool arguments (file paths, commands), and task inputs. All stored as plaintext in `.imzx/telemetry/`.  
**Impact**: Credential leakage via telemetry files, sensitive data exposure  
**Fix**: Redact sensitive fields (API keys, tokens, passwords) before storing telemetry

---

## MEDIUM (Should Fix)

### M1: REST API Default CORS to Wildcard
**File**: `interfaces/api/server.ts` — see H1  
**Fix**: Default to `http://localhost:3100` (dashboard) or empty string

### M2: No HTTPS Support
**All HTTP servers** use `node:http` (not `node:https`).  
**Risk**: All data transmitted in plaintext (API keys, agent responses, memory data)  
**Impact**: Network sniffing, MITM attacks  
**Fix**: Add HTTPS support with cert/key config options

### M3: File Permissions Not Explicitly Set
**All file writes** use default permissions (usually 0o644).  
**Risk**: Memory files, checkpoint files, telemetry files readable by other users on multi-user systems.  
**Impact**: Data leakage on shared systems  
**Fix**: Use `fs.writeFileSync(path, content, { mode: 0o600 })` for sensitive files

### M4: No Audit Logging for Security Events
**Missing**: No centralized audit log for failed auth attempts, blocked tools, security guardrail triggers.  
**Impact**: No forensic capability for security incidents  
**Fix**: Add security event logging to `.imzx/logs/security.jsonl`

### M5: Conversation Checkpoint Files Not Encrypted
**File**: `adapters/memory/conversation-checkpoint.ts`  
**Risk**: Checkpoints contain full conversation history including system prompts, tool calls, and responses. Stored as plaintext JSON.  
**Impact**: Sensitive data exposure if files are accessed  
**Fix**: Encrypt checkpoint files, or at minimum set restrictive file permissions

### M6: Knowledge Graph Persists Without Size Limit
**File**: `adapters/memory/knowledge-graph.ts`  
**Risk**: No max size limit on knowledge graph. Entities and relations grow unbounded.  
**Impact**: Memory exhaustion, performance degradation  
**Fix**: Add max entities/relations limits, auto-prune old/low-weight entries

### M7: Test File Uses `new Function()`
**File**: `tests/tool-executor.test.ts` line 32  
**Risk**: `new Function(\`"use strict"; return (${tc.expr})\`)()` — while in tests, this pattern could be copied into production code.  
**Impact**: Low (test only), but bad example  
**Fix**: Replace with safe math evaluator in tests

---

## LOW (Nice to Have)

### L1: No Dependency Pinning in package.json
**Risk**: Dependencies use exact versions (good) but `peerDependencies` use `>=4.0.0` (tsx).  
**Fix**: Pin peerDependency to specific range

### L2: No Security Headers on API
**Missing**: `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security` headers.  
**Fix**: Add security headers to all HTTP responses

### L3: Python SDK PIPES Server Output to PIPE (can block)
**File**: `interfaces/sdk/python/imzx.py` lines 78-79  
**Risk**: `stdout=subprocess.PIPE, stderr=subprocess.PIPE` — if server output exceeds pipe buffer, it blocks.  
**Fix**: Use `subprocess.DEVNULL` or redirect to file

### L4: Dockerfile Exposes Port Without Auth
**File**: `Dockerfile`  
**Risk**: Docker container runs server on port 3000 with no auth by default.  
**Fix**: Require API key in Docker CMD or documentation

### L5: No Content Security Policy
**Missing**: CSP headers on dashboard.  
**Fix**: Add CSP header to prevent inline script execution

---

## SUMMARY

| Severity | Count | Status |
|----------|-------|--------|
| **CRITICAL** | 6 | Found |
| **HIGH** | 8 | Found |
| **MEDIUM** | 7 | Found |
| **LOW** | 5 | Found |
| **TOTAL** | 26 | Security issues identified |

### Top 3 Must Fix Before Any Public Use:
1. **C1 + C2**: Auth on Dashboard + A2A — publicly accessible interfaces with full agent access
2. **C3**: Git command injection — arbitrary code execution via commit messages
3. **C5**: Plugin code execution — arbitrary JS loading without sandbox

### Overall Security Rating: ⚠️ **5/10**
- ✅ Good: Input guardrails, output guardrails, tool approval, command allowlist, budget enforcement, SSRF protection, prompt injection detection, credential leak prevention
- ❌ Bad: No auth on multiple interfaces, command injection, arbitrary code loading, no rate limiting on new endpoints, CORS wildcard default

---

**Recommendation**: Fix all CRITICAL items before any production use. Fix HIGH items before public npm usage. MEDIUM items can be addressed in v0.7.0.
