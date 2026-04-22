#!/bin/bash
set -e

echo "🚀 Starting project setup for imzx..."

# 1. Setup TypeScript
echo "📦 Setting up TypeScript environment..."
cd imzx/typescript
npm install
echo "✅ TypeScript setup complete."

# 2. Setup Python
echo "📦 Setting up Python environment..."
cd ../python
# We'll use a virtual environment for isolation
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pip install pytest
echo "✅ Python setup complete."

# 3. Global configuration
echo "⚙️  Configuring project-wide files..."
if [ ! -f imzx/CLAUDE.md ]; then
    echo "⚠️  CLAUDE.md not found. You might want to create one."
fi

echo "✨ Setup complete! You can now run agents from the CLI."
echo "TS: cd imzx/typescript && npm start"
echo "PY: cd imzx/python && ./venv/bin/python cli.py <prompt> <persona>"
