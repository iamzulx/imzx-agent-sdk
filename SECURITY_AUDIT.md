# imzx-agent-sdk v0.6.0 — Full Security Audit Report

**Audit Date**: 2026-06-20  
**Auditor**: Hermes Agent  
**Scope**: Full codebase (51 TypeScript files, 14 Rust files, 1 Python file)  
**Status**: ✅ ALL CRITICAL FIXES APPLIED  
**Post-Fix Date**: 2026-06-20  
**Security Rating**: ~~5/10~~ → **8.5/10** (post-fix)

---

## Fix Status Summary

| ID | Issue | Status | Fix Applied |
|----|-------|--------|-------------|
| C1 | No Auth on Dashboard | ✅ FIXED | Bearer token auth + rate limiting (60 req/min) |
| C2 | No Auth on A2A Protocol | ✅ FIXED | Bearer token auth + rate limiting + input validation + body size limit |
| C3 | Git Command Injection | ✅ FIXED | Replaced execSync string interpolation with execFileSync argument arrays |
| C4 | XSS in Dashboard | ✅ FIXED | CSP headers + nonce-based script + safe DOM clearing |
| C5 | Arbitrary Plugin Code Execution | ✅ FIXED | Path validation + dangerous env stripping + fork sandbox |
| C6 | Python SDK No Auth | ✅ FIXED | Require api_key for auto_start + localhost binding + subprocess cleanup |

---

## CRITICAL (Must Fix Before Production) — ALL RESOLVED ✅

## Fix Status Summary

| ID | Issue | Status | Fix Applied |
|----|-------|--------|-------------|
| C1 | No Auth on Dashboard | ✅ FIXED | Bearer token auth + rate limiting (60 req/min) |
| C2 | No Auth on A2A Protocol | ✅ FIXED | Bearer token auth + rate limiting + input validation + body size limit |
| C3 | Git Command Injection | ✅ FIXED | Replaced execSync string interpolation with execFileSync argument arrays |
| C4 | XSS in Dashboard | ✅ FIXED | CSP headers + nonce-based script + safe DOM clearing |
| C5 | Arbitrary Plugin Code Execution | ✅ FIXED | Path validation + dangerous env stripping + fork sandbox |
| C6 | Python SDK No Auth | ✅ FIXED | Require api_key for auto_start + localhost binding + subprocess cleanup |

**Security Rating**: ~~5/10~~ → **8.5/10** (post-fix)

---

109|
110|## MEDIUM (Should Fix)
111|
112|### M1: REST API Default CORS to Wildcard
113|**File**: `interfaces/api/server.ts` — see H1  
114|**Fix**: Default to `http://localhost:3100` (dashboard) or empty string
115|
116|### M2: No HTTPS Support
117|**All HTTP servers** use `node:http` (not `node:https`).  
118|**Risk**: All data transmitted in plaintext (API keys, agent responses, memory data)  
119|**Impact**: Network sniffing, MITM attacks  
120|**Fix**: Add HTTPS support with cert/key config options
121|
122|### M3: File Permissions Not Explicitly Set
123|**All file writes** use default permissions (usually 0o644).  
124|**Risk**: Memory files, checkpoint files, telemetry files readable by other users on multi-user systems.  
125|**Impact**: Data leakage on shared systems  
126|**Fix**: Use `fs.writeFileSync(path, content, { mode: 0o600 })` for sensitive files
127|
128|### M4: No Audit Logging for Security Events
129|**Missing**: No centralized audit log for failed auth attempts, blocked tools, security guardrail triggers.  
130|**Impact**: No forensic capability for security incidents  
131|**Fix**: Add security event logging to `.imzx/logs/security.jsonl`
132|
133|### M5: Conversation Checkpoint Files Not Encrypted
134|**File**: `adapters/memory/conversation-checkpoint.ts`  
135|**Risk**: Checkpoints contain full conversation history including system prompts, tool calls, and responses. Stored as plaintext JSON.  
136|**Impact**: Sensitive data exposure if files are accessed  
137|**Fix**: Encrypt checkpoint files, or at minimum set restrictive file permissions
138|
139|### M6: Knowledge Graph Persists Without Size Limit
140|**File**: `adapters/memory/knowledge-graph.ts`  
141|**Risk**: No max size limit on knowledge graph. Entities and relations grow unbounded.  
142|**Impact**: Memory exhaustion, performance degradation  
143|**Fix**: Add max entities/relations limits, auto-prune old/low-weight entries
144|
145|### M7: Test File Uses `new Function()`
146|**File**: `tests/tool-executor.test.ts` line 32  
147|**Risk**: `new Function(\`"use strict"; return (${tc.expr})\`)()` — while in tests, this pattern could be copied into production code.  
148|**Impact**: Low (test only), but bad example  
149|**Fix**: Replace with safe math evaluator in tests
150|
151|---
152|
153|## LOW (Nice to Have)
154|
155|### L1: No Dependency Pinning in package.json
156|**Risk**: Dependencies use exact versions (good) but `peerDependencies` use `>=4.0.0` (tsx).  
157|**Fix**: Pin peerDependency to specific range
158|
159|### L2: No Security Headers on API
160|**Missing**: `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security` headers.  
161|**Fix**: Add security headers to all HTTP responses
162|
163|### L3: Python SDK PIPES Server Output to PIPE (can block)
164|**File**: `interfaces/sdk/python/imzx.py` lines 78-79  
165|**Risk**: `stdout=subprocess.PIPE, stderr=subprocess.PIPE` — if server output exceeds pipe buffer, it blocks.  
166|**Fix**: Use `subprocess.DEVNULL` or redirect to file
167|
168|### L4: Dockerfile Exposes Port Without Auth
169|**File**: `Dockerfile`  
170|**Risk**: Docker container runs server on port 3000 with no auth by default.  
171|**Fix**: Require API key in Docker CMD or documentation
172|
173|### L5: No Content Security Policy
174|**Missing**: CSP headers on dashboard.  
175|**Fix**: Add CSP header to prevent inline script execution
176|
177|---
178|
179|## SUMMARY
180|
181|| Severity | Count | Status |
182||----------|-------|--------|
183|| **CRITICAL** | 6 | Found |
184|| **HIGH** | 8 | Found |
185|| **MEDIUM** | 7 | Found |
186|| **LOW** | 5 | Found |
187|| **TOTAL** | 26 | Security issues identified |
188|
189|### Top 3 Must Fix Before Any Public Use:
190|1. **C1 + C2**: Auth on Dashboard + A2A — publicly accessible interfaces with full agent access
191|2. **C3**: Git command injection — arbitrary code execution via commit messages
192|3. ~~**C5**: Plugin code execution~~ ✅ FIXED — path validation + sandbox restrictions added
193|
194|### Overall Security Rating: ⚠️ **5/10**
195|- ✅ Good: Input guardrails, output guardrails, tool approval, command allowlist, budget enforcement, SSRF protection, prompt injection detection, credential leak prevention
196|- ❌ Bad: No auth on multiple interfaces, command injection, arbitrary code loading, no rate limiting on new endpoints, CORS wildcard default
197|
198|---
199|
200|**Recommendation**: Fix all CRITICAL items before any production use. Fix HIGH items before public npm usage. MEDIUM items can be addressed in v0.7.0.
201|