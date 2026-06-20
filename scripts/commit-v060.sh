#!/usr/bin/env bash
cd ~/ffff/imzx-agent-sdk
git add -A
git commit -m "feat: v0.6.0 - full platform upgrade (6 phases, 22 features)

Phase 1: Single Command CLI (bin/imzx.mjs, arg parser, colored help)
Phase 2: Persistent Intelligence (graph persistence, TF-IDF embeddings, hybrid search, checkpoint)
Phase 3: Protocol Hub (A2A adapter, MCP server mode, multi-provider LLM)
Phase 4: Evaluation (replay, benchmarks, telemetry, dashboard)
Phase 5: Autonomous Agent (git context, project context, plugins, orchestration)
Phase 6: Production (binary scripts, Python SDK, Docker)

51 TS files, ~10K lines, typecheck clean, tests pass"
echo "Done. Run 'git push origin main' to push."
