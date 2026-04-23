#!/bin/bash
set -e

# Colors for pretty output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting interactive setup for imzx...${NC}"

# Function to ask for input
ask_input() {
    local prompt=$1
    local var_name=$2
    local default_val=$3
    local input

    if [ -z "$default_val" ]; then
        read -p "$(echo -e "${YELLOW}$prompt: ${NC}")" input
    else
        read -p "$(echo -e "${YELLOW}$prompt [$default_val]: ${NC}")" input
        input=${input:-$default_val}
    fi
    eval "$var_name=\"$input\""
}

# 1. Setup TypeScript/Python environments
echo -e "\n${BLUE}📦 Installing dependencies...${NC}"

# Check for Python
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}❌ Python3 not found. Please install Python before continuing.${NC}"
    exit 1
fi

# Setup Python environment
echo "Setting up Python environment..."
cd app/python-cli
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt --quiet
pip install pytest --quiet
echo -e "${GREEN}✅ Python setup complete.${NC}"
cd ../..

# Setup TypeScript
if command -v npm &> /dev/null; then
    echo "Setting up TypeScript environment..."
    cd app/typescript-cli
    # We use --ignore-scripts to prevent premature build and --legacy-peer-deps to avoid zod version conflicts
    npm install --ignore-scripts --legacy-peer-deps --quiet
    echo -e "${GREEN}✅ TypeScript CLI dependencies installed.${NC}"
    cd ../..

    # Build the Rust-TS bindings
    echo "Building TypeScript bindings..."
    cd bindings/typescript
    # Again, use --ignore-scripts and --legacy-peer-deps
    npm install --ignore-scripts --legacy-peer-deps --quiet
    npx neon build
    echo -e "${GREEN}✅ TypeScript bindings build complete.${NC}"
    cd ../..
else
    echo -e "${YELLOW}⚠️  npm not found. Skipping TypeScript setup.${NC}"
fi

# 2. API Key Configuration
echo -e "\n${BLUE}🔑 Configuring API Keys...${NC}"
if [ -f .env ]; then
    read -p "$(echo -e "${YELLOW}Found existing .env file. Overwrite it? (y/N): ${NC}")" overwrite
    if [[ ! "$overwrite" =~ ^[Yy]$ ]]; then
        echo "Skipping .env configuration."
    else
        rm .env
    fi
fi

ask_input "Enter your ANTHROPIC_API_KEY" API_KEY
if [ -n "$API_KEY" ]; then
    echo "ANTHROPIC_API_KEY=$API_KEY" > .env
    echo -e "${GREEN}✅ .env file created successfully.${NC}"
else
    echo -e "${YELLOW}⚠️  No API Key provided. You will need to create a .env file manually later.${NC}"
fi

# 3. Persona Templates
echo -e "\n${BLUE}🎭 Setting up Persona Templates...${NC}"
mkdir -p personas/templates

# Create some default templates
cat <<EOF > personas/templates/coding-pro.json
{
  "description": "Senior Software Engineer",
  "prompt": "You are an expert software engineer. Provide clean, efficient, and well-documented code. Prioritize security and best practices."
}
EOF

cat <<EOF > personas/templates/creative-writer.json
{
  "description": "Creative Storyteller",
  "prompt": "You are a master storyteller. Use vivid imagery, engaging pacing, and deep character development in your writing."
}
EOF

cat <<EOF > personas/templates/study-buddy.json
{
  "description": "Patient Tutor",
  "prompt": "You are a patient tutor. Use the Feynman technique: explain complex concepts as if I were a 10-year-old. Ask questions to check my understanding."
}
EOF

echo "✅ Templates created in personas/templates/"

read -p "$(echo -e "${YELLOW}Would you like to copy these templates to your main personas folder? (y/N): ${NC}")" copy_templates
if [[ "$copy_templates" =~ ^[Yy]$ ]]; then
    cp personas/templates/*.json personas/
    echo -e "${GREEN}✅ Templates copied to personas/${NC}"
else
    echo "Skipping template copy."
fi

echo -e "\n${GREEN}✨ Setup complete! You are ready to run imzx.${NC}"
echo -e "TS: cd app/typescript-cli && npm start"
echo -e "PY: cd app/python-cli && ./venv/bin/python main.py <prompt> [persona]"
