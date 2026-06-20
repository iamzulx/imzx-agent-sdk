#!/usr/bin/env bash
cd ~/ffff/imzx-agent-sdk
git add -A
git commit -m "feat: 9 production features — HITL, Judge, Cost, Policy, Topology, Lifecycle, SLM, CUA, RAG"
git push origin main
echo "Done. Pushed to GitHub."
