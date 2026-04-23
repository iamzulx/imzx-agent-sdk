#!/bin/bash
set -e

echo "🚀 Starting project setup for imzx..."

# 1. Build Rust Core & Bindings
echo "🦀 Building Rust Core and FFI Bindings..."
# Build TS Bindings
cd bindings/typescript/core
cargo build --release
cd ../../../

# Build Python Bindings
cd bindings/python
maturin develop
cd ../../

echo "✅ Core and Bindings build complete."

# 2. Setup TypeScript
echo "📦 Setting up TypeScript environment..."
cd app/typescript-cli
npm install
echo "✅ TypeScript setup complete."
cd ../..

# 3. Setup Python
echo "📦 Setting up Python environment..."
cd app/python-cli
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pip install pytest
echo "✅ Python setup complete."
cd ../..

# 4. Global configuration
echo "⚙️  Configuring project-wide files..."
if [ ! -f CLAUDE.md ]; then
    echo "⚠️  CLAUDE.md not found."
fi

echo "✨ Setup complete! You can now run agents from the CLI."
echo "TS: cd app/typescript-cli && npm start"
echo "PY: cd app/python-cli && ./venv/bin/python main.py <prompt> <persona>"
