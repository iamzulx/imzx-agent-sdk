"""
test_orchestration.py
Pengujian untuk strategi orchestration (Router, Hierarchical, Consensus).
"""

import sys
import os
import asyncio
from pathlib import Path

# Path ke library Rust yang di-build oleh GitHub Actions
LIB_PATH = Path(__file__).parent.parent.parent / "core" / "target" / "aarch64-linux-android" / "release" / "libimzx_core.so"

def setup_env():
    if not LIB_PATH.exists():
        print(f"[ERROR] Library tidak ditemukan di: {LIB_PATH}")
        print("Pastikan Anda sudah menjalankan scripts/deploy_and_test.sh")
        sys.exit(1)

    # Tambahkan direktori library ke PYTHONPATH agar bisa diimport
    sys.path.insert(0, str(LIB_PATH.parent))

async def test_router():
    print("[TEST] Router strategy ...")
    try:
        import imzx_core
        agent = imzx_core.PyAgent(
            name="test-agent-router",
            description="Router test agent",
            prompt="Anda adalah agen routing cerdas."
        )
        response = await agent.run("Apa saja langkah-langkah memasak nasi goreng?")
        print(f"[ROUTER] Response: {response[:100]}...")
        print("[PASS] Router strategy OK")
    except Exception as e:
        print(f"[FAIL] Router strategy Error: {e}")

async def test_hierarchical():
    print("[TEST] Hierarchical strategy ...")
    try:
        import imzx_core
        agent = imzx_core.PyAgent(
            name="test-agent-hierarchical",
            description="Hierarchical test agent",
            prompt="Anda adalah agen hierarchical dengan pengaturan tugas."
        )
        response = await agent.run("Buat rencana proyek dua minggu untuk pengembangan perangkat lunak.")
        print(f"[HIERARCHICAL] Response: {response[:100]}...")
        print("[PASS] Hierarchical strategy OK")
    except Exception as e:
        print(f"[FAIL] Hierarchical strategy Error: {e}")

async def test_consensus():
    print("[TEST] Consensus strategy ...")
    try:
        import imzx_core
        agent = imzx_core.PyAgent(
            name="test-agent-consensus",
            description="Consensus test agent",
            prompt="Anda adalah agen consensus dengan beberapa worker."
        )
        response = await agent.run("Analisis kelebihan dan kekurangan blockchain untuk aplikasi keuangan.")
        print(f"[CONSENSUS] Response: {response[:100]}...")
        print("[PASS] Consensus strategy OK")
    except Exception as e:
        print(f"[FAIL] Consensus strategy Error: {e}")

async def main():
    setup_env()
    print("=" * 60)
    print("Running Orchestration Strategy Tests")
    print("=" * 60)
    await test_router()
    await test_hierarchical()
    await test_consensus()
    print("\nTesting complete. Periksa log di atas untuk hasil detail.")

if __name__ == "__main__":
    asyncio.run(main())
