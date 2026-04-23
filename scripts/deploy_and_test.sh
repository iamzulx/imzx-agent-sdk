#!/bin/bash

# deploy_and_test.sh
# Automasi: Download artifact dari GitHub -> Pasang ke lokal -> Jalankan Test

set -e

# 1. Konfigurasi Path
PROJECT_ROOT=$(pwd)
TARGET_DIR="$PROJECT_ROOT/core/target/aarch64-linux-android/release"
TEST_SCRIPT="$PROJECT_ROOT/app/python-cli/test_orchestration.py"

echo "🚀 Memulai proses Deployment & Testing Otomatis..."

# 2. Pastikan folder target tersedia
mkdir -p "$TARGET_DIR"

# 3. Download Artifact menggunakan GitHub CLI (gh)
echo "📥 Mengunduh artefak terbaru dari GitHub Actions..."
if ! command -v gh &> /dev/null; then
    echo "❌ Error: 'gh' (GitHub CLI) tidak ditemukan. Silakan instal dengan: pkg install gh"
    exit 1
fi

# Mengambil run terbaru yang sukses dan mengunduh artifact-nya
# Kita cari run yang statusnya 'completed' dan memiliki artifact 'imzx-core-android-aarch64'
RUN_ID=$(gh run list --status completed --limit 1 --json databaseId --jq '.[0].databaseId')

if [ -z "$RUN_ID" ]; then
    echo "❌ Error: Tidak ditemukan GitHub Action run yang sukses."
    exit 1
fi

echo "✅ Mengunduh artifact dari Run ID: $RUN_ID..."
gh run download "$RUN_ID" -n "imzx-core-android-aarch64" --dir "$TARGET_DIR"

# 4. Verifikasi file .so
if [ ! -f "$TARGET_DIR/libimzx_core.so" ]; then
    echo "❌ Error: File libimzx_core.so tidak ditemukan di $TARGET_DIR setelah download."
    exit 1
fi

echo "✅ Library berhasil dipasang di $TARGET_DIR"

# 5. Jalankan Pengujian
echo "🧪 Menjalankan skrip pengujian orchestration..."
echo "--------------------------------------------------"
python3 "$TEST_SCRIPT"
echo "--------------------------------------------------"

echo "🎉 Selesai! Cek hasil test di atas."
