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

# 1. Setup TypeScript environment
echo -e "\n${BLUE}📦 Installing dependencies...${NC}"

if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm not found. Please install Node.js before continuing.${NC}"
    exit 1
fi

echo "Setting up TypeScript environment..."
npm install --ignore-scripts --quiet
echo -e "${GREEN}✅ Project dependencies installed.${NC}"

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
    umask 077
    echo "ANTHROPIC_API_KEY=$API_KEY" > .env
    chmod 600 .env
    echo -e "${GREEN}✅ .env file created successfully.${NC}"
else
    echo -e "${YELLOW}⚠️  No API Key provided. You will need to create a .env file manually later.${NC}"
fi

# 3. Persona Templates
echo -e "\n${BLUE}🎭 Setting up Persona Templates...${NC}"
mkdir -p domain/personas/templates

# Create some default templates
cat <<EOF > domain/personas/templates/coding-pro.json
{
  "description": "Senior Software Engineer",
  "prompt": "You are an expert software engineer. Provide clean, efficient, and well-documented code. Prioritize security and best practices."
}
EOF

cat <<EOF > domain/personas/templates/creative-writer.json
{
  "description": "Creative Storyteller",
  "prompt": "You are a master storyteller. Use vivid imagery, engaging pacing, and deep character development in your writing."
}
EOF

cat <<EOF > domain/personas/templates/study-buddy.json
{
  "description": "Patient Tutor",
  "prompt": "You are a patient tutor. Use the Feynman technique: explain complex concepts as if I were a 10-year-old. Ask questions to check my understanding."
}
EOF

echo "✅ Templates created in domain/personas/templates/"

read -p "$(echo -e "${YELLOW}Would you like to copy these templates to your main personas folder? (y/N): ${NC}")" copy_templates
if [[ "$copy_templates" =~ ^[Yy]$ ]]; then
    cp domain/personas/templates/*.json domain/personas/
    echo -e "${GREEN}✅ Templates copied to domain/personas/${NC}"
else
    echo "Skipping template copy."
fi

echo -e "\n${GREEN}✨ Setup complete! You are ready to run imzx.${NC}"
echo -e "TS: npm start \"Hello\" general-purpose"
