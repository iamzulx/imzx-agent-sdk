import os
import asyncio
import json
from dotenv import load_dotenv
import imzx_core

load_dotenv()

# Fix: Navigate 3 levels up from app/python-cli/main.py to reach project root
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PERSONA_DIR = os.getenv('PERSONA_DIR', os.path.join(BASE_DIR, 'personas'))

async def run():
    import sys
    args = sys.argv[1:]

    if len(args) < 1:
        print('Usage: python main.py <prompt> [agent_name]')
        sys.exit(1)

    prompt = args[0]
    agent_name = args[1] if len(args) > 1 else 'general-purpose'

    try:
        # 1. Load and Validate Persona
        persona_path = os.path.join(PERSONA_DIR, f"{agent_name}.json")
        with open(persona_path, 'r') as f:
            persona_data = json.load(f)

        if 'description' not in persona_data or 'prompt' not in persona_data:
            raise ValueError(f"Invalid persona format in {persona_path}")

        print(f"[imzx] Loaded persona: {agent_name}")

        # 2. Initialize Agent via Rust Bindings
        print(f"[imzx] Initializing agent: {agent_name}...")
        agent = imzx_core.PyAgent(
            agent_name,
            persona_data['description'],
            persona_data['prompt']
        )
        print(f"Status: Agent initialized via Rust Core")

        # 3. Run Agent via Rust Bindings
        print(f"[imzx] Querying: '{prompt}'")
        response = agent.run(prompt)

        print('\n--- Agent Response ---')
        print(response)
        print('----------------------\n')

    except FileNotFoundError:
        print(f"[ERROR] Persona '{agent_name}.json' not found in {PERSONA_DIR}")
        sys.exit(1)
    except Exception as e:
        print(f"[ERROR] {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(run())
